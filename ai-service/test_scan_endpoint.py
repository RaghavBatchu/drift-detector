"""Tests for Commit 3 (/scan endpoint) and Commit 1 (mine_repo fixes).

Run: python3 -m pytest test_scan_endpoint.py -v

Fixtures
--------
All git repos are built in-process with GitPython — no network, no
subprocess, no external dependencies beyond what's already in requirements.txt.
Each fixture is scoped to the test that needs it; tmp_path (pytest builtin)
handles cleanup automatically.
"""
import os
import textwrap

import git
import pytest
from fastapi.testclient import TestClient

from app.main import app
from mine_repo import mine, MineError, COMMIT_SCAN_CAP, CONFIG_BARE_NAMES

client = TestClient(app)

# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------

def _init_repo(path: str) -> git.Repo:
    """Create a bare-minimum git repo with a committed user identity."""
    repo = git.Repo.init(path)
    repo.config_writer().set_value("user", "name", "tester").release()
    repo.config_writer().set_value("user", "email", "test@example.com").release()
    return repo


def _commit(repo: git.Repo, files: dict[str, str], message: str) -> git.Commit:
    """Write *files* (path → content) into the repo and make a commit."""
    for rel_path, content in files.items():
        abs_path = os.path.join(repo.working_dir, rel_path)
        os.makedirs(os.path.dirname(abs_path), exist_ok=True)
        with open(abs_path, "w") as fh:
            fh.write(textwrap.dedent(content))
        repo.index.add([rel_path])
    return repo.index.commit(message)


# ---------------------------------------------------------------------------
# /scan — happy path
# ---------------------------------------------------------------------------

class TestScanHappyPath:
    """POST /scan with a local-path repo that has a rule-triggering change."""

    @pytest.fixture()
    def risky_repo(self, tmp_path):
        """
        Two-commit repo:
          C1 (root)  — benign nginx.conf
          C2         — adds cidr_blocks = ["0.0.0.0/0"]  → triggers NET-001
        """
        repo = _init_repo(str(tmp_path))
        _commit(repo, {"nginx/nginx.conf": "worker_processes 1;\n"}, "init: add nginx conf")
        _commit(
            repo,
            {"terraform/security_group.tf": 'cidr_blocks = ["0.0.0.0/0"]\n'},
            "feat: open security group (risky!)",
        )
        return str(tmp_path)

    def test_response_shape(self, risky_repo):
        r = client.post("/scan", json={"repo_url": risky_repo, "scan_id": "test-happy"})
        assert r.status_code == 200
        d = r.json()
        assert {"drift_score", "risk_trend", "summary", "findings",
                "analyzed_changes", "repo_id", "engine_info"} <= d.keys()

    def test_repo_id_round_tripped(self, risky_repo):
        r = client.post("/scan", json={"repo_url": risky_repo, "scan_id": "my-scan-42"})
        assert r.json()["repo_id"] == "my-scan-42"

    def test_expected_finding_present(self, risky_repo):
        r = client.post("/scan", json={"repo_url": risky_repo, "scan_id": "test-finding"})
        findings = r.json()["findings"]
        assert len(findings) >= 1
        rule_ids = [f.get("rule_id") for f in findings]
        assert "NET-001" in rule_ids, f"Expected NET-001 in findings, got: {rule_ids}"

    def test_finding_has_new_integration_fields(self, risky_repo):
        r = client.post("/scan", json={"repo_url": risky_repo, "scan_id": "test-fields"})
        f = r.json()["findings"][0]
        assert "author" in f
        assert "change_summary" in f
        assert "evidence_side" in f
        assert f["evidence_side"] in ("added", "removed")

    def test_findings_sorted_by_risk_descending(self, risky_repo):
        r = client.post("/scan", json={"repo_url": risky_repo, "scan_id": "test-sort"})
        scores = [f["risk_score"] for f in r.json()["findings"]]
        assert scores == sorted(scores, reverse=True)

    def test_drift_score_nonzero_for_risky_repo(self, risky_repo):
        r = client.post("/scan", json={"repo_url": risky_repo, "scan_id": "test-drift"})
        assert r.json()["drift_score"] > 0


# ---------------------------------------------------------------------------
# /scan — failure path
# ---------------------------------------------------------------------------

class TestScanFailurePath:
    def test_invalid_url_returns_400(self):
        r = client.post("/scan", json={
            "repo_url": "https://github.com/this-org/this-repo-does-not-exist-xyz123",
            "scan_id": "fail-test",
        })
        assert r.status_code == 400
        assert "detail" in r.json()

    def test_non_git_local_path_returns_400_or_500(self, tmp_path):
        """A local path that's not a git repo should raise an error, not silently succeed."""
        r = client.post("/scan", json={
            "repo_url": str(tmp_path),
            "scan_id": "not-a-git-repo",
        })
        # MineError → 400; an unhandled git.InvalidGitRepositoryError → 500
        # Either is acceptable as long as it's not a 200 with garbage data.
        assert r.status_code in (400, 500)

    def test_error_detail_is_a_string(self):
        r = client.post("/scan", json={
            "repo_url": "https://invalid.example.com/no-such-repo.git",
            "scan_id": "fail-detail",
        })
        assert r.status_code == 400
        assert isinstance(r.json()["detail"], str)
        assert len(r.json()["detail"]) > 0


# ---------------------------------------------------------------------------
# mine_repo.py — Commit 1 unit tests
# ---------------------------------------------------------------------------

class TestMineRepoRootCommit:
    """Commit 1 fix: root commit must not be silently dropped."""

    def test_root_commit_content_included(self, tmp_path):
        """
        Single-commit repo — mine() must return at least one change.
        Before the fix, zip(commits, commits[1:]) yielded nothing for a
        1-commit repo, so the initial config content was invisible.
        """
        repo = _init_repo(str(tmp_path))
        _commit(repo, {"infra/main.tf": 'cidr_blocks = ["0.0.0.0/0"]\n'}, "root commit")

        changes = mine(str(tmp_path))
        assert len(changes) >= 1, "Root commit content must be captured"
        paths = [c["file_path"] for c in changes]
        assert any("main.tf" in p for p in paths)

    def test_root_commit_added_lines_nonempty(self, tmp_path):
        """Root commit lines appear in added_lines (NULL_TREE diff direction)."""
        repo = _init_repo(str(tmp_path))
        _commit(repo, {"settings.yaml": "debug: true\n"}, "init")

        changes = mine(str(tmp_path))
        assert any(c["added_lines"] for c in changes), \
            "Root commit diff should produce added_lines"


class TestMineRepoCommitCap:
    """Commit 1 fix: COMMIT_SCAN_CAP limits the number of commits walked."""

    def test_cap_respected(self, tmp_path):
        """
        Build a repo with (CAP + 5) commits each touching a config file.
        mine() must return at most CAP change records.
        """
        repo = _init_repo(str(tmp_path))
        n = COMMIT_SCAN_CAP + 5
        for i in range(n):
            _commit(repo, {"app.yaml": f"version: {i}\n"}, f"commit {i}")

        changes = mine(str(tmp_path))
        assert len(changes) <= COMMIT_SCAN_CAP, (
            f"Expected at most {COMMIT_SCAN_CAP} changes, got {len(changes)}"
        )

    def test_cap_value_is_200(self):
        """Ensure the cap hasn't been accidentally lowered."""
        assert COMMIT_SCAN_CAP == 200


class TestMineRepoDockerfile:
    """Commit 1 fix: bare 'Dockerfile' must be recognised as a config file."""

    def test_dockerfile_is_in_bare_names(self):
        assert "Dockerfile" in CONFIG_BARE_NAMES

    def test_dockerfile_changes_are_captured(self, tmp_path):
        repo = _init_repo(str(tmp_path))
        _commit(repo, {"Dockerfile": "FROM python:3.12-slim\n"}, "add Dockerfile")
        _commit(
            repo,
            {"Dockerfile": "FROM python:3.12-slim\nRUN apt-get install -y curl\n"},
            "update Dockerfile",
        )

        changes = mine(str(tmp_path))
        dockerfile_changes = [c for c in changes if "Dockerfile" in c["file_path"]]
        assert len(dockerfile_changes) >= 1, \
            "Dockerfile changes should be captured by mine()"

    def test_dockerfile_root_commit_captured(self, tmp_path):
        """Even the first Dockerfile (root commit) should appear in results."""
        repo = _init_repo(str(tmp_path))
        _commit(repo, {"Dockerfile": "FROM ubuntu:22.04\n"}, "initial Dockerfile")

        changes = mine(str(tmp_path))
        assert any("Dockerfile" in c["file_path"] for c in changes), \
            "Root-commit Dockerfile must be captured"


class TestMineRepoMineError:
    """Commit 1 fix: clone failures must raise MineError, not a raw traceback."""

    def test_invalid_https_url_raises_mine_error(self):
        with pytest.raises(MineError):
            mine("https://github.com/nobody/this-repo-does-not-exist-xyz123.git")

    def test_mine_error_is_runtime_error_subclass(self):
        assert issubclass(MineError, RuntimeError)
