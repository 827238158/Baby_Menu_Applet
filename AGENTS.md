# Agent 开发指南

本项目是微信原生小程序家庭菜单展示页：公开读取云端菜单，两名白名单用户管理共享草稿并发布，心愿夹保持私有。不是完整点单系统。

## 沟通规则

- 默认使用中文交流，并称呼用户为“小主”。
- 回答要清晰、直接，不要过度正式。
- 不确定的结论必须明确说明“不确定”或“需要验证”。
- 不要编造文件路径、命令输出、软件版本、接口返回结果或项目结构。
- 代码生成时关键步骤加中文注释。
- 遇到风险操作时，先说明风险，再给出建议。

## 每次任务的读取规则

未来 Agent 开始任务前，先输出 `Need:` 列表，说明本次需要读取哪些记忆或源码。

默认读取集：

```text
AGENTS.md
memory/MEMORY.md
memory/CURRENT.md
```

按任务追加读取：

- UI、布局、视觉、组件：读 `DESIGN.md`。
- 启动、生成、检查、构建、预览：读 `memory/RUNBOOK.md`。
- 编码、环境、Excel、图片、微信小程序限制等反复踩坑：读 `memory/PITFALLS.md`。
- 菜单维护细节：读 `CUSTOMIZATION.md`，再按需检查 `tools/menu-workbook/menu-data.xlsx` 和生成脚本。
- 实现影响面：用 `rg` 搜索代码中的符号、页面、样式、调用方和测试；文档只提供意图和边界，代码搜索决定真实影响面。

## 项目边界

- 仅菜单管理和心愿夹复用微信白名单会话，不新增面向公众的登录功能、支付或真实订单。
- 购物车、数量和合计都是本地前端状态。
- 用户最终操作是复制已选菜单文本。
- 除非用户明确要求，不要新增真实下单、云开发、后端接口、支付流程或 npm 构建流程。
- 当前项目不做真实交易，现有商品 `price` 统一保持字符串 `'0'`。
- 规格选项暂时不影响价格，不要增加规格加价逻辑，除非用户明确要求。

## 技术栈

- 微信原生小程序：WXML、WXSS、JavaScript、JSON。
- 主入口页面：`miniprogram/pages/menu/menu`。
- 线上菜单请求入口：`miniprogram/services/menu-api.js`；旧迁移资料位于 `tools/menu-workbook/`，不进入小程序代码包。
- 使用微信开发者工具导入仓库根目录预览。

## 关键文件

```text
tools/menu-workbook/menu-data.xlsx
tools/generate-menu-data.js
tools/generate-menu-data.py
tools/menu-workbook/generated/
tools/menu-workbook/assets/
miniprogram/pages/menu/menu.js
miniprogram/pages/menu/menu.wxml
miniprogram/pages/menu/menu.wxss
miniprogram/pages/menu-admin/
miniprogram/pages/menu-preview/
miniprogram/services/menu-api.js
serverless/gift-api/src/menu/
tools/menu-cloud/
docs/menu-cloud-deployment.md
miniprogram/assets/
CUSTOMIZATION.md
README.md
DESIGN.md
memory/
```

## 菜单数据维护

- 日常使用小程序菜单管理，云端为唯一真源；保存共享草稿后预览发布，历史恢复先替换草稿再发布。
- 菜单后端独立放在 `serverless/gift-api/src/menu/`；保持原部署入口，COS 使用独立 `menu/` 前缀，不能混入心愿夹索引或清理。
- 全部发布快照及其图片保留，菜单锁不自动抢占；部署与恢复先读 `docs/menu-cloud-deployment.md`。
- `tools/menu-workbook/` 下的 Excel、生成 JS 和图片是旧迁移源；除非明确修复迁移资料，不手改或重新生成。
- 旧工作簿包含 Shop、Categories、Dishes。旧 imageFile 只填文件名，不能填 Windows 绝对路径。
- 修复旧源时按 RUNBOOK“旧菜单数据生成”执行；首次上云使用 `tools/menu-cloud/`，禁止覆盖非空菜单命名空间。
- 旧 generate-menu-data.js 寻找 Python，generate-menu-data.py 读取 Excel，menu-data.js 聚合排序；这些脚本不会更新云端。

## 记忆更新规则

- 稳定项目事实和读取路由：更新 `memory/MEMORY.md`。
- 当前任务状态、验收、进度、阻塞和下一步：更新 `memory/CURRENT.md`；它只保留当前快照，开始新任务时替换旧任务内容，不追加前序任务历史。
- 重要长期变更、迁移、发布、恢复事件：更新 `memory/LOG.md`；普通过程进度不要写入 `LOG.md`。
- 常见坑的触发、原因、恢复方式：更新 `memory/PITFALLS.md`。
- 启动、生成、检查、构建、预览命令：更新 `memory/RUNBOOK.md`。
- UI 和交互规则：更新 `DESIGN.md`，不要重复写进 README 或记忆文件。

## 常用检查

生成、语法检查、测试、打包、部署后验证和手动验收命令统一维护在 `memory/RUNBOOK.md`；执行前按任务读取对应章节。

## 编码注意

项目包含中文。PowerShell 终端偶尔会把中文显示成乱码，不要仅凭终端显示判断文件损坏。检查 JS 语法时优先让 Node 直接读取文件路径，避免用管道传中文文件内容。
