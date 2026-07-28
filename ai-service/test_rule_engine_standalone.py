"""
Quick smoke test for the rule engine changes.
Run: py -3 scratch_test_rules.py
No external dependencies required (only stdlib + the local app package logic inlined).
"""
import json, re, sys
from pathlib import Path

ROOT = Path(r"c:\Users\omu21\OneDrive\Desktop\Progata\drift-detector\ai-service")

# ---- inline rule loading ----
rules_path = ROOT / "app/rules.json"
raw_rules = json.loads(rules_path.read_text())["rules"]

SKIP_FILE_PATTERNS = tuple(
    re.compile(p, re.IGNORECASE)
    for p in [
        r"(^|[\/])pnpm-lock\.yaml$",
        r"(^|[\/])yarn\.lock$",
        r"(^|[\/])package-lock\.json$",
        r"(^|[\/])npm-shrinkwrap\.json$",
        r"(^|[\/])poetry\.lock$",
        r"(^|[\/])Pipfile\.lock$",
        r"(^|[\/])Gemfile\.lock$",
        r"(^|[\/])Cargo\.lock$",
        r"(^|[\/])go\.sum$",
        r"(^|[\/])composer\.lock$",
        r"\.lock$",
    ]
)

class Rule:
    def __init__(self, raw):
        self.id = raw["id"]
        self.applies_to = raw["applies_to"]
        self.patterns = [re.compile(p) for p in raw["patterns"]]
        self.unless_added = [re.compile(p) for p in raw.get("unless_added", [])]
        self.exclude_patterns = [re.compile(p) for p in raw.get("exclude_patterns", [])]

    def match(self, line):
        for exc in self.exclude_patterns:
            if exc.search(line):
                return None
        for pat in self.patterns:
            if pat.search(line):
                return pat.pattern
        return None

rules = [Rule(r) for r in raw_rules]

def evaluate(added, removed, file_path=""):
    if file_path and any(p.search(file_path) for p in SKIP_FILE_PATTERNS):
        return []
    hits = []
    for rule in rules:
        lines = added if rule.applies_to == "added" else removed
        evidence = [ln for ln in lines if ln.strip() and rule.match(ln)]
        if evidence and rule.unless_added and any(
                p.search(ln) for p in rule.unless_added for ln in added):
            continue
        if evidence:
            hits.append({"rule_id": rule.id, "evidence": evidence})
    return hits

PASS = 0
FAIL = 0

def check(name, condition, detail=""):
    global PASS, FAIL
    if condition:
        print(f"  \033[32mPASS\033[0m  {name}")
        PASS += 1
    else:
        print(f"  \033[31mFAIL\033[0m  {name}" + (f" â€” {detail}" if detail else ""))
        FAIL += 1

print("\n=== SEC-001 positive ===")
hits = evaluate(['password = "hunter2secret"'], [])
check("hardcoded password fires SEC-001", any(h["rule_id"] == "SEC-001" for h in hits))

print("\n=== SEC-001 Dockerfile ARG exclusions ===")
for line in ["ARG POSTGRES_PASSWORD", "ARG SECRET_KEY", "ARG API_KEY", "  ARG PASSWD"]:
    ids = [h["rule_id"] for h in evaluate([line], [])]
    check(f"ARG decl '{line}' silent", "SEC-001" not in ids, ids)

print("\n=== SEC-001 bare $VAR exclusions ===")
for line in ["ENV PASSWORD=$BUILD_PASSWORD", "ENV API_KEY=$MY_API_KEY", "ENV SECRET_KEY=$SECRET"]:
    ids = [h["rule_id"] for h in evaluate([line], [])]
    check(f"bare $VAR '{line}' silent", "SEC-001" not in ids, ids)

print("\n=== SEC-001 comment line exclusions ===")
for line in ["# password = changeme", "# api_key = AKIAIOSFODNN7EXAMPLE", "  # passwd = hunter2"]:
    ids = [h["rule_id"] for h in evaluate([line], [])]
    check(f"comment '{line}' silent", "SEC-001" not in ids, ids)

print("\n=== ACC-001 positive ===")
hits = evaluate(["USER root"], [])
check("USER root fires ACC-001", any(h["rule_id"] == "ACC-001" for h in hits))

print("\n=== ACC-001 non-root USER exclusions ===")
for line in ["USER appuser", "USER node", "USER 1000", "  USER myservice"]:
    ids = [h["rule_id"] for h in evaluate([line], [])]
    check(f"non-root USER '{line}' silent", "ACC-001" not in ids, ids)

print("\n=== ACC-001 comment exclusions ===")
for line in ["# USER root", "  # user root", "# Previously: USER root was used"]:
    ids = [h["rule_id"] for h in evaluate([line], [])]
    check(f"comment '{line}' silent", "ACC-001" not in ids, ids)

print("\n=== Lock file skip ===")
risky = ['password = "hunter2secret"', 'cidr_blocks = ["0.0.0.0/0"]', "privileged: true"]

for fp in ["pnpm-lock.yaml", "yarn.lock", "frontend/package-lock.json", "poetry.lock", "Gemfile.lock", "go.sum"]:
    hits = evaluate(risky, [], file_path=fp)
    check(f"{fp} skipped entirely", hits == [], hits)

print("\n=== Normal YAML NOT skipped ===")
hits = evaluate(['password = "hunter2secret"'], [], file_path="config/app.yaml")
check("config/app.yaml still scanned", any(h["rule_id"] == "SEC-001" for h in hits))

print(f"\n{'='*50}")
print(f"Results: {PASS} passed, {FAIL} failed")
