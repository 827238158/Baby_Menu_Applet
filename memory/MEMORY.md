# 项目记忆入口

本项目是微信原生小程序家庭菜单：通过 SCF + 私有 COS 公开读取，两名白名单用户管理共享草稿并发布；心愿夹保持两人私有共享。线上状态以 CURRENT 为准。

## 稳定事实

- 技术栈为微信原生小程序 WXML、WXSS、JavaScript、JSON；公开页 pages/menu/menu、管理页 pages/menu-admin/menu-admin、独立菜品编辑页 pages/menu-dish-editor/menu-dish-editor、预览页 pages/menu-preview/menu-preview，共用 services/menu-page.js 和公开页 WXML/WXSS。
- 上云后菜单唯一真源是 COS menu/；日常从管理页维护。旧 Excel 转换和首次迁移工具已淘汰，Excel 与图片只作本机备份且不受 Git 跟踪。
- 菜单资料云端维护，购物车、数量和合计仍是本地展示状态，无支付或真实订单，price 保持字符串 '0'。预览购物车不写真实缓存。
- 心愿夹使用独立 SCF + 私有 COS，不使用数据库，仅允许两名 OpenID 白名单用户访问；后端入口为 `serverless/gift-api/index.main_handler`，前端云端配置为 `miniprogram/config/gift-cloud.js`。
- 礼品元数据以 `gift-folder/index.json` schema v2 为唯一真源，装修好物使用 `gift-folder/decor/index.json` schema v2；新建图片和写锁仍按两区命名空间隔离。收藏项可通过 `/collections/items/{id}/move` 保留 ID 和图片 Key 跨区移动，因此清理任务必须合并两份索引保护图片。礼品 `gifts/*.json` 只作 v1 回滚备份。写锁依赖 `x-cos-forbid-overwrite:true`，生产 COS 版本控制必须保持暂停。
- 新版小程序通过 `POST /uploads/form-policy` 和 `wx.uploadFile` 只直传原图，随后由 SCF 调用数据万象 `image_process` 持久化生成 WebP 缩略图；旧图不回填，旧客户端 `asset: thumbnail` 暂时兼容。孤儿图片由 `GiftImageCleanupDaily` 每日清理，安全期为 24 小时，在用原图和缩略图不得删除。
- `project.config.json` 已配置正式小程序 AppID，不要主动替换。
- Git push 不会自动更新腾讯云 SCF；后端源码或生产依赖变更后必须按 `memory/RUNBOOK.md` 重新测试、打包、上传、部署和验证。
- 项目级 Codex Hook 会按提示词定向召回相关 `PITFALLS`/`LOG` 线索、匿名收集高信号失败类型，并在结束时执行最小归档门禁；它不自动撰写记忆，测试和信任说明见 `memory/RUNBOOK.md`。

- 菜单后端在 serverless/gift-api/src/menu/，与心愿夹共用函数及白名单。草稿带修订号，先保存不可变快照再切换 current；全历史及图片保留，恢复先到草稿。
- 菜单锁 menu/system/write.lock 不自动抢占；MenuImageCleanupDaily 独立保护草稿和全部快照，清理超过 24 小时的未引用图片，扫描异常停止删除。

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
- 菜单权限、创建、发布/回退、锁和清理：读 docs/menu-cloud-deployment.md。
- 具体实现影响：用 `rg` 搜索源码、样式和调用方；代码搜索决定真实影响面。

## 记忆写入路由

- `memory/CURRENT.md` 只保留当前任务、目标、验收、影响区域、进度、阻塞和下一步；开始新任务时替换旧快照，不堆叠历史。
- 重要操作、部署、迁移、恢复和长期决策写入 `memory/LOG.md`，普通过程不归档。
- 经验证的可复用命令写入 `memory/RUNBOOK.md`；重复踩坑写入 `memory/PITFALLS.md`；UI 规则只写入 `DESIGN.md`。
