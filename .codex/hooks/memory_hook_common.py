# -*- coding: utf-8 -*-
"""Lightweight project memory Hooks shared utilities."""

from __future__ import annotations

import hashlib
import json
import os
import re
import subprocess
import sys
import tempfile
import uuid
from pathlib import Path
from typing import Any


MEMORY_FILES = {
    "current": "memory/CURRENT.md",
    "log": "memory/LOG.md",
    "pitfalls": "memory/PITFALLS.md",
    "runbook": "memory/RUNBOOK.md",
    "design": "DESIGN.md",
}


def read_payload() -> dict[str, Any]:
    raw_bytes = sys.stdin.buffer.read()
    if not raw_bytes.strip():
        return {}
    for encoding in ("utf-8-sig", "gb18030"):
        try:
            payload = json.loads(raw_bytes.decode(encoding))
        except (UnicodeDecodeError, json.JSONDecodeError):
            continue
        return payload if isinstance(payload, dict) else {}
    return {}


def find_project_root(cwd: object) -> Path | None:
    if not cwd:
        return None
    candidate = Path(str(cwd)).expanduser()
    if candidate.is_file():
        candidate = candidate.parent
    try:
        current = candidate.resolve()
    except OSError:
        return None
    while True:
        if (current / "AGENTS.md").is_file() and (current / "memory").is_dir():
            return current
        if current.parent == current:
            return None
        current = current.parent


def read_utf8_checked(path: Path) -> tuple[str, bool]:
    try:
        return path.read_text(encoding="utf-8"), True
    except (OSError, UnicodeError):
        return "", False


def hash_file(path: Path) -> str | None:
    try:
        return hashlib.sha256(path.read_bytes()).hexdigest()
    except OSError:
        return None


def memory_hashes(root: Path) -> dict[str, str | None]:
    return {name: hash_file(root / relative) for name, relative in MEMORY_FILES.items()}


def _run_git(root: Path, *args: str) -> bytes | None:
    try:
        completed = subprocess.run(
            ["git", *args],
            cwd=root,
            capture_output=True,
            check=False,
            timeout=8,
        )
    except (OSError, subprocess.SubprocessError):
        return None
    return completed.stdout if completed.returncode == 0 else None


def workspace_digest(root: Path) -> str | None:
    diff = _run_git(root, "diff", "--binary", "HEAD", "--")
    untracked = _run_git(root, "ls-files", "--others", "--exclude-standard", "-z")
    if diff is None or untracked is None:
        return None

    digest = hashlib.sha256()
    digest.update(diff)
    for raw_name in sorted(name for name in untracked.split(b"\0") if name):
        try:
            relative = raw_name.decode("utf-8", errors="surrogateescape")
            path = root / relative
            data = path.read_bytes() if path.is_file() else b""
        except OSError:
            data = b""
        digest.update(raw_name)
        digest.update(b"\0")
        digest.update(hashlib.sha256(data).digest())
    return digest.hexdigest()


def _safe_identifier(value: object, fallback: str) -> str:
    normalized = re.sub(r"[^A-Za-z0-9_.-]+", "_", str(value or "")).strip("._")
    return normalized[:120] or fallback


def state_path(payload: dict[str, Any]) -> Path:
    configured = os.environ.get("PROJECT_MEMORY_HOOK_STATE_DIR")
    base = Path(configured) if configured else Path(tempfile.gettempdir()) / "project-memory-hooks"
    session_id = _safe_identifier(payload.get("session_id"), "session")
    turn_id = _safe_identifier(payload.get("turn_id"), "turn")
    return base / session_id / f"{turn_id}.json"


def signal_dir(payload: dict[str, Any]) -> Path:
    path = state_path(payload)
    return path.parent / f"{path.stem}.signals"


def write_state(payload: dict[str, Any], state: dict[str, Any]) -> bool:
    path = state_path(payload)
    try:
        path.parent.mkdir(parents=True, exist_ok=True)
        path.write_text(json.dumps(state, ensure_ascii=False), encoding="utf-8")
    except OSError:
        return False
    return True


def load_state(payload: dict[str, Any]) -> dict[str, Any] | None:
    try:
        state = json.loads(state_path(payload).read_text(encoding="utf-8-sig"))
    except (OSError, UnicodeError, json.JSONDecodeError):
        return None
    return state if isinstance(state, dict) else None


def write_signal(payload: dict[str, Any], signal: dict[str, Any]) -> bool:
    directory = signal_dir(payload)
    path = directory / f"{uuid.uuid4().hex}.json"
    try:
        directory.mkdir(parents=True, exist_ok=True)
        path.write_text(json.dumps(signal, ensure_ascii=False), encoding="utf-8")
    except OSError:
        return False
    return True


def load_signals(payload: dict[str, Any]) -> list[dict[str, Any]]:
    directory = signal_dir(payload)
    try:
        paths = tuple(directory.glob("*.json"))
    except OSError:
        return []
    signals: list[dict[str, Any]] = []
    for path in paths:
        try:
            value = json.loads(path.read_text(encoding="utf-8-sig"))
        except (OSError, UnicodeError, json.JSONDecodeError):
            continue
        if isinstance(value, dict):
            signals.append(value)
    return signals


def remove_state(payload: dict[str, Any]) -> None:
    try:
        state_path(payload).unlink(missing_ok=True)
    except OSError:
        pass
    directory = signal_dir(payload)
    try:
        for path in directory.glob("*.json"):
            path.unlink(missing_ok=True)
        directory.rmdir()
    except OSError:
        pass
