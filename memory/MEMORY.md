# 项目记忆入口

本项目是微信原生小程序菜单展示页，用 Excel 维护菜单数据，再生成本地前端数据文件。

## 稳定事实

- 技术栈：微信原生小程序 WXML、WXSS、JavaScript、JSON。
- 主页面：`miniprogram/pages/menu/menu`。
- 聚合数据入口：`miniprogram/data/menu-data.js`。
- 日常菜单维护入口：`tools/menu-workbook/menu-data.xlsx`。
- 日常生成命令：`node tools\generate-menu-data.js`。
- 项目边界：不接后端、数据库、登录、支付或真实订单。
- 当前 `project.config.json` 的 `touristappid` 不要主动替换。
- 项目级 Codex Hook 会在项目发生改动但 `memory/CURRENT.md` 未更新时阻止任务结束；Hook 不自动撰写记忆。

## 默认读取集

```text
AGENTS.md
memory/MEMORY.md
memory/CURRENT.md
```

## 读取路由

- UI、布局、视觉、组件、交互：读 `DESIGN.md`。
- 启动、生成、检查、构建、预览：读 `memory/RUNBOOK.md`。
- 编码、环境、Excel、图片、微信小程序限制等常见问题：读 `memory/PITFALLS.md`。
- 菜单表字段、标签、规格、日常维护步骤：读 `CUSTOMIZATION.md`。
- 重要历史变更：读 `memory/LOG.md`。
- 具体实现影响：用 `rg` 搜索源码、样式和调用方；代码搜索决定真实影响面。

## 记忆写入路由

- 每次开始新任务：先更新 `memory/CURRENT.md` 的任务、目标、验收标准、已知影响区域和下一步。
- 执行中完成关键步骤、发现阻塞、改变方案或扩大影响面：及时更新 `memory/CURRENT.md`。
- 每次任务结束前：更新 `memory/CURRENT.md` 的最终进度、验证结果、剩余风险或后续动作。
- 当前任务状态写入 `memory/CURRENT.md`。
- 长期有效事件写入 `memory/LOG.md`。
- 可复用命令写入 `memory/RUNBOOK.md`。
- 重复踩坑写入 `memory/PITFALLS.md`。
- UI 规则写入 `DESIGN.md`。
