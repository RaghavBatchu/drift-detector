"""Deterministic rule engine. Layer 1 — never cut."""
import json
import re
from pathlib import Path

RULES_PATH = Path(__file__).parent / "rules.json"


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

    def evaluate(self, added_lines: list[str], removed_lines: list[str]):
        """Return list of {rule, evidence} hits for one config change.

        Each rule fires at most once per change, collecting all lines
        that triggered it as evidence.
        """
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
