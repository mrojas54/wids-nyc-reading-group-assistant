"""Scripts the slash commands run by file path must import from a cold start.

`uv run scripts/<name>.py` puts scripts/ on sys.path, not the repo root, so a
script that imports the `scripts` package needs its own sys.path line. pytest's
conftest adds the repo root for in-process tests, which hides a missing line;
these run each script in a fresh interpreter, from outside the repo, instead.
"""
from __future__ import annotations

import os
import subprocess
import sys
from pathlib import Path

import pytest

REPO_ROOT = Path(__file__).resolve().parent.parent


def _run_by_path(script: str, args: list[str], stdin: str, cwd: Path) -> subprocess.CompletedProcess[str]:
    env = {k: v for k, v in os.environ.items() if k != "PYTHONPATH"}
    return subprocess.run(
        [sys.executable, str(REPO_ROOT / "scripts" / script), *args],
        input=stdin,
        capture_output=True,
        text=True,
        cwd=cwd,
        env=env,
        timeout=60,
    )


@pytest.mark.parametrize("script, args, stdin", [
    # /wids-make-companion and /wids-zotero-retry
    ("zotero_push.py", ["--help"], ""),
    # /wids-find-paper pipes a JSON payload on stdin; `{}` fails validation,
    # which is fine: the point is that it got past its imports.
    ("find_paper_suggest.py", [], "{}"),
])
def test_script_imports_when_run_by_path(script, args, stdin, tmp_path):
    proc = _run_by_path(script, args, stdin, tmp_path)
    assert "ModuleNotFoundError" not in proc.stderr, proc.stderr
