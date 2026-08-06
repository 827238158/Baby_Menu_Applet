# -*- coding: utf-8 -*-
"""Regression tests for the reusable project memory Hooks."""

from __future__ import annotations

import json
import unittest

from memory_gate import evaluate_gate, summarize_tool_signals
from memory_router import Category, build_context
from memory_signal_collector import classify_tool_event


CATEGORIES = (
    Category("Python 与环境", ("python", "pip"), ("python", "pip"), "核对解释器。"),
    Category("业务与 AI 流程", ("分类覆盖", "ai 分析", "候选"), ("分类", "候选"), "搜索完整状态链路。"),
)
PITFALLS = """# Pitfalls

## Python 与环境

- 触发：pip 和 Python 混用。
  原因：环境不一致。
  处理：使用同一解释器。
"""
LOG = """# Log

| 日期 | 事项 | 摘要 |
| --- | --- | --- |
| 2026-01-01 | Python 环境修复 | 统一解释器。 |
"""


class RouterTests(unittest.TestCase):
    def test_matching_section_and_log_are_injected(self) -> None:
        context = build_context("修复 Python pip 环境", PITFALLS, LOG, CATEGORIES)
        self.assertIn("## Python 与环境", context)
        self.assertIn("Python 环境修复", context)

    def test_domain_route_hint_is_available_without_archived_section(self) -> None:
        context = build_context("AI 分析后出现分类覆盖", PITFALLS, LOG, CATEGORIES)
        self.assertIn("业务与 AI 流程", context)
        self.assertIn("完整状态链路", context)

    def test_unmatched_prompt_adds_no_context(self) -> None:
        self.assertEqual(build_context("润色一句话", PITFALLS, LOG, CATEGORIES), "")


class SignalCollectorTests(unittest.TestCase):
    def test_success_is_ignored(self) -> None:
        self.assertIsNone(classify_tool_event({
            "tool_name": "Bash",
            "tool_input": {"command": "pytest"},
            "tool_response": "Exit code: 0\n12 passed",
        }))

    def test_successful_error_text_search_is_ignored(self) -> None:
        self.assertIsNone(classify_tool_event({
            "tool_name": "Bash",
            "tool_input": {"command": "rg traceback"},
            "tool_response": "Exit code: 0\nexample contains traceback",
        }))

    def test_dependency_failure_is_anonymous_and_strong(self) -> None:
        signal = classify_tool_event({
            "tool_name": "Bash",
            "tool_input": {"command": "python app.py --token secret-value"},
            "tool_response": "Exit code: 1\nModuleNotFoundError: No module named demo",
        })
        self.assertIsNotNone(signal)
        self.assertTrue(signal["strong"])
        self.assertNotIn("secret-value", json.dumps(signal, ensure_ascii=False))

    def test_single_transient_failure_is_not_promoted(self) -> None:
        signal = {"fingerprint": "same", "markers": ["超时"], "strong": False}
        self.assertEqual(summarize_tool_signals([signal]), [])
        self.assertIn("同一工具操作重复失败", summarize_tool_signals([signal, signal]))


class GateTests(unittest.TestCase):
    def test_workspace_change_requires_current_review(self) -> None:
        missing = evaluate_gate(
            baseline_digest="before",
            current_digest="after",
            before_memory={"current": "1", "log": "1", "pitfalls": "1"},
            after_memory={"current": "1", "log": "1", "pitfalls": "1"},
            prompt="修改页面文案",
            last_message="已完成。",
        )
        self.assertTrue(any("CURRENT.md" in item for item in missing))

    def test_high_signal_failure_requires_pitfall_review(self) -> None:
        missing = evaluate_gate(
            baseline_digest="before",
            current_digest="after",
            before_memory={"current": "1", "log": "1", "pitfalls": "1"},
            after_memory={"current": "2", "log": "1", "pitfalls": "1"},
            prompt="修复启动异常",
            last_message="已修复。",
            tool_signals=[{"fingerprint": "x", "markers": ["依赖或环境"], "strong": True}],
        )
        self.assertTrue(any("PITFALLS.md" in item for item in missing))

    def test_completed_memory_updates_pass(self) -> None:
        missing = evaluate_gate(
            baseline_digest="before",
            current_digest="after",
            before_memory={"current": "1", "log": "1", "pitfalls": "1"},
            after_memory={"current": "2", "log": "2", "pitfalls": "2"},
            prompt="修复部署 Hook",
            last_message="已修复并通过。",
            tool_signals=[{"fingerprint": "x", "markers": ["依赖或环境"], "strong": True}],
        )
        self.assertEqual(missing, [])


if __name__ == "__main__":
    unittest.main()
