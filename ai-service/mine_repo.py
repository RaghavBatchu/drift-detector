"""Reference Git miner — walks a repo's history and emits changes[] in the
frozen JSON contract. Hand this to whoever owns the Git Miner component.

Run:  python3 mine_repo.py <path-or-url> > changes.json
Then: curl -X POST localhost:8001/analyze -H 'Content-Type: application/json' \
           -d "{\"repo_id\": \"demo\", \"changes\": $(cat changes.json)}"
"""
import json
import os
import sys
import tempfile

import git

# File extensions (and exact bare filenames) treated as config files.
# Bare names like "Dockerfile" are matched against os.path.basename(path).
CONFIG_EXTS = (".yaml", ".yml", ".conf", ".tf", ".toml", ".ini", ".cfg", ".json")
CONFIG_BARE_NAMES = frozenset({"Dockerfile"})

# Hard cap on commits walked per request — keeps synchronous calls bounded on
# large real-world repos (e.g. a monorepo with thousands of commits).
COMMIT_SCAN_CAP = 200


class MineError(RuntimeError):
    """Raised for any unrecoverable problem during repo acquisition."""


def _is_config(path: str) -> bool:
    """Return True if *path* represents a config file we want to mine."""
    return path.endswith(CONFIG_EXTS) or os.path.basename(path) in CONFIG_BARE_NAMES


def mine(repo_path: str) -> list[dict]:
    if repo_path.startswith(("http://", "https://", "git@")):
        tmp = tempfile.mkdtemp()
        try:
            repo = git.Repo.clone_from(
                repo_path, tmp,
                depth=COMMIT_SCAN_CAP + 1,  # shallow clone keeps I/O proportional
                kill_after_timeout=60,       # don't hang forever on a slow remote
            )
        except git.exc.GitCommandError as exc:
            raise MineError(
                f"Failed to clone '{repo_path}': {exc.stderr.strip()}"
            ) from exc
        except Exception as exc:
            raise MineError(
                f"Unexpected error cloning '{repo_path}': {exc}"
            ) from exc
    else:
        repo = git.Repo(repo_path)

    commits = list(repo.iter_commits(repo.active_branch))[::-1]  # oldest first
    commits = commits[-COMMIT_SCAN_CAP:]                          # enforce cap

    changes = []

    # --- diff the root commit against the empty tree so its content isn't lost
    if commits:
        root = commits[0]
        for d in root.diff(git.NULL_TREE, create_patch=True):
            # NULL_TREE diff has a/b paths swapped vs. a normal diff; use whichever
            # is set.
            path = d.a_path or d.b_path
            if not path or not _is_config(path):
                continue
            added, removed = [], []
            for line in d.diff.decode(errors="ignore").splitlines():
                if line.startswith("+") and not line.startswith("+++"):
                    # NULL_TREE treats the root commit's lines as *added*
                    added.append(line[1:])
                elif line.startswith("-") and not line.startswith("---"):
                    removed.append(line[1:])
            if added or removed:
                changes.append({
                    "file_path": path,
                    "commit_hash": root.hexsha[:7],
                    "commit_date": root.committed_datetime.isoformat(),
                    "author": root.author.name,
                    "added_lines": added,
                    "removed_lines": removed,
                })

    # --- walk subsequent commits pairwise
    for prev, cur in zip(commits, commits[1:]):
        for d in prev.diff(cur, create_patch=True):
            path = d.b_path or d.a_path
            if not path or not _is_config(path):
                continue
            added, removed = [], []
            for line in d.diff.decode(errors="ignore").splitlines():
                if line.startswith("+") and not line.startswith("+++"):
                    added.append(line[1:])
                elif line.startswith("-") and not line.startswith("---"):
                    removed.append(line[1:])
            if added or removed:
                changes.append({
                    "file_path": path,
                    "commit_hash": cur.hexsha[:7],
                    "commit_date": cur.committed_datetime.isoformat(),
                    "author": cur.author.name,
                    "added_lines": added,
                    "removed_lines": removed,
                })

    return changes


if __name__ == "__main__":
    target = sys.argv[1] if len(sys.argv) > 1 else "synthetic-infra-repo"
    print(json.dumps(mine(target), indent=1))
