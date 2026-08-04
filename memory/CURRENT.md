# 当前任务

## 本轮任务

优化“心愿夹”双分段体验，并增加收藏项跨分类移动能力。

## 目标与验收

- 分段切换不再触发页面纵向滚动，只保留选中胶囊左右滑动。
- 头图和分段控件常驻屏幕，礼品列表在内部独立滚动并分别保存两区滚动位置。
- 礼品与装修好物共用独立的 `collection-item-card` 小程序组件。
- 编辑收藏项时可以保留 ID、图片、名称和简介移动到另一分段，移动请求支持幂等重试。
- 旧 `/gifts` 路由和现有两份 COS 索引保持兼容，不自动迁移或改写线上数据。

## 影响区域

- `miniprogram/components/collection-item-card/`
- `miniprogram/pages/gifts/`、`miniprogram/services/gift-api.js`
- `serverless/gift-api/src/`、`serverless/gift-api/test/`、`minitest/`
- `DESIGN.md`、`README.md`、`serverless/gift-api/README.md`、`memory/`

## 当前状态

- 本地实现已完成：固定头图区、列表 `scroll-view`、分段独立滚动位置、通用卡片组件和移动编辑入口均已加入。
- 后端新增 `POST /collections/items/{id}/move`；固定按礼品锁、装修锁顺序加锁，目标先写、来源后删，重复请求可收敛。
- 移动保留原图片 Key；普通旧图删除、孤儿删除和每日 Timer 均跨两份索引保护仍被引用的图片。
- 小程序侧 43 项测试、后端 22 项测试、相关 JS 语法检查、后端 `npm run check`、生产依赖审计和 `git diff --check` 均通过。
- 已重建 `serverless/gift-api/gift-api.zip`（2026-08-04 22:57:12，1,340,718 字节），包内已确认 `src/app.js` 与 `moveCollectionItem` 新路由存在。
- 用户已上传新版 SCF；线上 `/health` 返回 200，头图数量正确，确认原礼品索引和数据未丢失。
- 用户截图显示微信开发者工具实际错误为 `Component is not found in path`，此前只定位滚动高度并不完整；原礼品数量正确，数据仍未丢失。
- 已将卡片组件注册改为页面相对路径 `../../components/collection-item-card/collection-item-card`，并保留列表明确高度修复；新增测试校验组件引用及四个组件文件。
- 修正后小程序侧 44 项测试、组件 JSON/JS 检查和 `git diff --check` 通过；需要在开发者工具清缓存并重新编译验证。
- 当前改动已在分支 `codex/gift-decor-segments` 创建本地提交；该分支尚未设置远端上游。

## 阻塞与下一步

- 需重新编译小程序，在微信开发者工具和真机确认原礼品卡片恢复、固定头图占高、长列表滚动、分段位置恢复、移动后的图片预览和窄屏布局。
- 发布仍需先部署新版 SCF，再发布小程序；否则装修和移动新路由会返回 404。
- 推送目标为 `origin/codex/gift-decor-segments`；因外传安全审批被拦截，需用户明确授权将本次源码、配置和文档提交推送到 `git@github.com:827238158/Baby_Menu_Applet.git` 后再执行。
