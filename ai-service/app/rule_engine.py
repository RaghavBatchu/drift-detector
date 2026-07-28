"""Deterministic rule engine. Layer 1 — never cut."""
import json
import re
from pathlib import Path

RULES_PATH = Path(__file__).parent / "rules.json"

# ---------------------------------------------------------------------------
# File-level skip list — auto-generated or out-of-developer-control files.
# Any file whose path matches one of these patterns is skipped entirely;
# no rule is evaluated against it.  This prevents false positives caused
# by machine-generated content that developers cannot modify (e.g. integrity
# hashes in lock files that happen to contain substrings like "pass").
# ---------------------------------------------------------------------------
SKIP_FILE_PATTERNS: tuple[re.Pattern, ...] = tuple(
    re.compile(p, re.IGNORECASE)
    for p in [
        r"(^|[\\/])pnpm-lock\.yaml$",
        r"(^|[\\/])yarn\.lock$",
        r"(^|[\\/])package-lock\.json$",
        r"(^|[\\/])npm-shrinkwrap\.json$",
        r"(^|[\\/])poetry\.lock$",
        r"(^|[\\/])Pipfile\.lock$",
        r"(^|[\\/])Gemfile\.lock$",
        r"(^|[\\/])Cargo\.lock$",
        r"(^|[\\/])go\.sum$",
        r"(^|[\\/])composer\.lock$",
        r"\.lock$",          # catch-all for any other lockfile conventions
    ]
)


def _is_skipped_file(file_path: str) -> bool:
    """Return True if *file_path* belongs to a category we should never scan."""
    return any(pat.search(file_path) for pat in SKIP_FILE_PATTERNS)


class Rule:
    def __init__(self, raw: dict):
        self.id = raw["id"]
        self.name = raw["name"]
        self.category = raw["category"]
        self.severity = raw["severity"]
        self.base_score = raw["base_score"]
        self.applies_to = raw["applies_to"]          # "added" | "removed"
        self.patterns = [re.compile(p) for p in raw["patterns"]]
        self.unless_added = [re.compile(p) for p in raw.get("unless_added", [])]
        self.exclude_patterns = [re.compile(p) for p in raw.get("exclude_patterns", [])]
        self.description = raw["description"]
        self.remediation = raw["remediation"]

    def match(self, line: str):
        """Return the first matching pattern, or None."""
        for exc in self.exclude_patterns:
            if exc.search(line):
                return None
        for pat in self.patterns:
            if pat.search(line):
                return pat.pattern
        return None


class RuleEngine:
    def __init__(self, rules_path: Path = RULES_PATH):
        raw = json.loads(rules_path.read_text())
        self.rules = [Rule(r) for r in raw["rules"]]

    def evaluate(
        self,
        added_lines: list[str],
        removed_lines: list[str],
        file_path: str = "",
    ):
        """Return list of {rule, evidence} hits for one config change.

        Each rule fires at most once per change, collecting all lines
        that triggered it as evidence.

        Args:
            added_lines:   Lines present in the new version of the file.
            removed_lines: Lines that were deleted from the file.
            file_path:     Relative path of the file being evaluated.
                           Used to skip auto-generated files (lock files,
                           etc.) where matches are always false positives.
        """
        # Skip auto-generated / out-of-developer-control files entirely.
        if file_path and _is_skipped_file(file_path):
            return []

        hits = []
        for rule in self.rules:
            lines = added_lines if rule.applies_to == "added" else removed_lines
            evidence = [ln for ln in lines if ln.strip() and rule.match(ln)]
            if evidence and rule.unless_added and any(
                    p.search(ln) for p in rule.unless_added for ln in added_lines):
                continue  # e.g. a limit was replaced, not removed
            if evidence:
                hits.append({"rule": rule, "evidence": evidence})
        return hits
