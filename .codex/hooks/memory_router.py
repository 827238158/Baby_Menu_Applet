# -*- coding: utf-8 -*-
"""UserPromptSubmit Hook: inject only relevant project memory clues."""

from __future__ import annotations

import json
from collections.abc import Iterable
from dataclasses import dataclass
from pathlib import Path
from typing import Any

from memory_hook_common import (
    find_project_root,
    memory_hashes,
    read_payload,
    read_utf8_checked,
    workspace_digest,
    write_state,
)


MAX_SECTIONS = 3
MAX_LOG_ROWS = 3
MAX_CONTEXT_CHARS = 5500


@dataclass(frozen=True)
class Category:
    section: str
    keywords: tuple[str, ...]
    log_keywords: tuple[str, ...]
    route_hint: str = ""


def load_categories(path: Path) -> tuple[list[Category], bool]:
    try:
        value = json.loads(path.read_text(encoding="utf-8-sig"))
        rows = value.get("categories") if isinstance(value, dict) else None
        if not isinstance(rows, list):
            return [], False
        categories = []
        for row in rows:
            if not isinstance(row, dict) or not row.get("section"):
                continue
            categories.append(Category(
                section=str(row["section"]),
                keywords=tuple(str(item) for item in row.get("keywords", []) if item),
                log_keywords=tuple(str(item) for item in row.get("log_keywords", []) if item),
                route_hint=str(row.get("route_hint") or ""),
            ))
        return categories, bool(categories)
    except (OSError, UnicodeError, json.JSONDecodeError):
        return [], False


def match_categories(prompt: str, categories: Iterable[Category]) -> list[Category]:
    normalized = prompt.casefold()
    scored: list[tuple[int, int, Category]] = []
    for index, category in enumerate(categories):
        score = sum(1 for keyword in category.keywords if keyword.casefold() in normalized)
        if score:
            scored.append((score, -index, category))
    scored.sort(reverse=True, key=lambda item: (item[0], item[1]))
    return [category for _, _, category in scored[:MAX_SECTIONS]]


def parse_sections(markdown: str) -> dict[str, str]:
    sections: dict[str, list[str]] = {}
    current: str | None = None
    for line in markdown.splitlines():
        if line.startswith("## "):
            current = line[3:].strip()
            sections[current] = [line]
        elif current is not None:
            sections[current].append(line)
    return {name: "\n".join(lines).strip() for name, lines in sections.items()}


def matching_log_rows(markdown: str, categories: Iterable[Category]) -> list[str]:
    keywords = {
        keyword.casefold()
        for category in categories
        for keyword in category.log_keywords
    }
    rows = []
    for line in markdown.splitlines():
        normalized = line.casefold()
        if line.startswith("| 20") and any(keyword in normalized for keyword in keywords):
            rows.append(line)
    return rows[-MAX_LOG_ROWS:]


def build_context(
    prompt: str,
    pitfalls_markdown: str,
    log_markdown: str,
    categories: Iterable[Category],
) -> str:
    matched = match_categories(prompt, categories)
    if not matched:
        return ""

    sections = parse_sections(pitfalls_markdown)
    blocks = [sections[category.section] for category in matched if category.section in sections]
    route_hints = [
        f"- **{category.section}**：{category.route_hint}"
        for category in matched
        if category.route_hint
    ]
    if route_hints:
        blocks.append("## 本轮检索提示\n" + "\n".join(route_hints))
    log_rows = matching_log_rows(log_markdown, matched)
    if log_rows:
        blocks.append("## 相关重要历史\n" + "\n".join(log_rows))
    if not blocks:
        return ""

    context = (
        "【项目记忆定向检索】\n"
        "以下是按当前提示命中的历史线索或检索位置，不代替代码与环境验证；"
        "当前用户指令优先。\n\n"
        + "\n\n".join(blocks)
    )
    return context[:MAX_CONTEXT_CHARS]


def main() -> None:
    payload = read_payload()
    root = find_project_root(payload.get("cwd"))
    prompt = str(payload.get("prompt") or "")
    if root is None:
        print(json.dumps({
            "continue": True,
            "systemMessage": "项目记忆 Hook 未定位项目根目录；本轮请由 AI 手工执行记忆检索与结束审计。",
        }, ensure_ascii=False))
        return

    baseline_digest = workspace_digest(root)
    state_ok = write_state(payload, {
        "root": str(root),
        "prompt": prompt,
        "workspace_digest": baseline_digest,
        "memory_hashes": memory_hashes(root),
    })
    pitfalls, pitfalls_ok = read_utf8_checked(root / "memory" / "PITFALLS.md")
    log, log_ok = read_utf8_checked(root / "memory" / "LOG.md")
    categories, routes_ok = load_categories(root / ".codex" / "hooks" / "memory_routes.json")

    warnings = []
    if baseline_digest is None:
        warnings.append("无法建立 Git 工作区基线")
    if not state_ok:
        warnings.append("无法保存本轮记忆审计状态")
    if not pitfalls_ok or not log_ok:
        warnings.append("PITFALLS 或 LOG 读取失败")
    if not routes_ok:
        warnings.append("记忆路由配置读取失败")

    output: dict[str, Any] = {"continue": True}
    if warnings:
        output["systemMessage"] = (
            "项目记忆 Hook 本轮降级：" + "；".join(warnings) + "。请由 AI 手工补做相关检查。"
        )
    context = build_context(prompt, pitfalls, log, categories)
    if context:
        output["hookSpecificOutput"] = {
            "hookEventName": "UserPromptSubmit",
            "additionalContext": context,
        }
    print(json.dumps(output, ensure_ascii=False, separators=(",", ":")))


if __name__ == "__main__":
    main()
