# 项目记忆入口

本项目是微信原生小程序家庭菜单展示页：菜单由 Excel 生成本地数据，心愿夹可通过 SCF + 私有 COS 供两名授权用户共享礼品和装修好物。

## 稳定事实

- 技术栈为微信原生小程序 WXML、WXSS、JavaScript、JSON；主页面是 `miniprogram/pages/menu/menu`，菜单聚合入口是 `miniprogram/data/menu-data.js`。
- 日常菜单真源是 `tools/menu-workbook/menu-data.xlsx`，生成后的 `miniprogram/data/*.js` 通常不手改；具体维护流程读 `CUSTOMIZATION.md`。
- 菜单、购物车、数量和合计都是本地展示状态，不接支付或真实订单；现有商品 `price` 保持字符串 `'0'`，规格暂不加价。
- 心愿夹使用独立 SCF + 私有 COS，不使用数据库，仅允许两名 OpenID 白名单用户访问；后端入口为 `serverless/gift-api/index.main_handler`，前端云端配置为 `miniprogram/config/gift-cloud.js`。
- 礼品元数据以 `gift-folder/index.json` schema v2 为唯一真源，装修好物使用 `gift-folder/decor/index.json` schema v2；新建图片和写锁仍按两区命名空间隔离。收藏项可通过 `/collections/items/{id}/move` 保留 ID 和图片 Key 跨区移动，因此清理任务必须合并两份索引保护图片。礼品 `gifts/*.json` 只作 v1 回滚备份。写锁依赖 `x-cos-forbid-overwrite:true`，生产 COS 版本控制必须保持暂停。
- 新版小程序通过 `POST /uploads/form-policy` 和 `wx.uploadFile` 只直传原图，随后由 SCF 调用数据万象 `image_process` 持久化生成 WebP 缩略图；旧图不回填，旧客户端 `asset: thumbnail` 暂时兼容。孤儿图片由 `GiftImageCleanupDaily` 每日清理，安全期为 24 小时，在用原图和缩略图不得删除。
- `project.config.json` 已配置正式小程序 AppID，不要主动替换。
- Git push 不会自动更新腾讯云 SCF；后端源码或生产依赖变更后必须按 `memory/RUNBOOK.md` 重新测试、打包、上传、部署和验证。
- 项目级 Codex Hook 会按提示词定向召回相关 `PITFALLS`/`LOG` 线索、匿名收集高信号失败类型，并在结束时执行最小归档门禁；它不自动撰写记忆，测试和信任说明见 `memory/RUNBOOK.md`。

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
- 重要操作、部署、迁移、恢复和长期决策：读 `memory/LOG.md`。
- 心愿夹后端部署、环境变量、权限或迁移：先读 `serverless/gift-api/README.md`，再按需搜索当前实现。
- 具体实现影响：用 `rg` 搜索源码、样式和调用方；代码搜索决定真实影响面。

## 记忆写入路由

- `memory/CURRENT.md` 只保留当前任务、目标、验收、影响区域、进度、阻塞和下一步；开始新任务时替换旧快照，不堆叠历史。
- 重要操作、部署、迁移、恢复和长期决策写入 `memory/LOG.md`，普通过程不归档。
- 经验证的可复用命令写入 `memory/RUNBOOK.md`；重复踩坑写入 `memory/PITFALLS.md`；UI 规则只写入 `DESIGN.md`。
