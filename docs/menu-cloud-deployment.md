# 菜单上云部署与恢复

本手册适用于当前本地实现。腾讯云后台由小主操作；上传 ZIP、云端初始化、小程序发布与真机验收须分别记录，不能以本地测试代替上线。

## 上线前检查

执行会新增公开读取流量，上传图片会产生存储与数据万象费用；先备份再部署，保留现有心愿夹路由与数据。

1. 备份 `gift-folder/index.json`、`gift-folder/decor/index.json`、图片和旧 SCF 包。
2. COS 继续私有读写，确认版本控制未开启或已暂停。**不要开启桶版本控制**：心愿夹及菜单禁止覆盖写锁依赖此设置。
3. 确认该桶已绑定数据万象，SCF 与 COS 同地域。本次包含尚未上线的持久化 WebP 缩略图，必须先部署兼容后端。
4. `ALLOWED_OPENIDS` 保持两人，`OPENID_DISCOVERY=false`；不更换 AppID，不记录完整 OpenID 日志。

## SCF 权限、配置与触发器

沿用现有函数、函数 URL、`index.main_handler` 和环境变量，不需要数据库、新桶或额外菜单密钥。菜单固定使用 `menu/`，原 `COS_PREFIX=gift-folder` 不变。

| 配置 | 本次操作 |
| --- | --- |
| CAM 运行角色 | 保留心愿夹授权，新增目标桶 `menu/*` 的 `cos:GetObject`、`cos:HeadObject`、`cos:PutObject`、`cos:PostObject`、`cos:DeleteObject` |
| 桶列举 | 桶级 `cos:GetBucket` 只允许菜单前缀；CAM 条件中的 `/` 必须 URL 编码，使用 `"string_equal": { "cos:prefix": "menu%2F" }`；不授权账号下全部桶 |
| 数据万象 | 绑定同一桶，允许读取原图和持久化写入缩略图；真机确认产出 WebP |
| 函数 URL | 保持公网开放，应用层保护管理与心愿夹接口，只放行已发布菜单 |
| 超时 | 保持 60 秒，观察图片处理与清理耗时 |
| 新 Timer | 名称必须为 `MenuImageCleanupDaily`，每天低峰执行一次，目标仍是现有处理函数 |
| 旧 Timer | 保留 `GiftImageCleanupDaily`，不改成菜单触发器 |
| 微信合法域名 | SCF 为 `request`；COS 为 `uploadFile`、`downloadFile`；域名未变时核验即可 |

不要把桶改为公开。公开菜单由 SCF 解析已发布版本，图片接口只允许当前公开菜单实际引用的资产；历史与草稿不开放匿名读取。

草稿写入请求体上限 1 MiB，心愿夹维持 8 KiB。菜单写请求使用独立锁，忙碌返回 409；不要为了消除提示直接删除锁。

## 部署顺序

1. 按 [RUNBOOK](../memory/RUNBOOK.md) 测试、校验与打包，核对 ZIP 包含 `src/menu/` 和两类持久化缩略图路由。
2. 腾讯云 SCF 控制台上传新 ZIP 并完成部署。
3. 检查 `/health`，匿名请求 `/menu`：未初始化时应返回 `MENU_NOT_PUBLISHED`，不能是“接口不存在”。验证心愿夹旧客户端和礼品、装修两条缩略图链路。
4. 旧 Excel 转换和首次迁移工具已淘汰。两名白名单用户之一进入菜单管理页，创建内容、保存草稿、预览并发布首个菜单。
5. 核对 `menu/draft.json`、`menu/current.json`、首个快照和图片。
6. 使用体验版完成下述真机验收，再发布新版小程序。菜单后端或初始化未成功时不要发布新前端。
7. 设置费用预算、SCF 错误/调用量、COS 下行流量告警，观察两类 Timer 日志。阈值按实际用量设置，告警不是自动费用上限。


## 接口与存储

| 路由 | 权限及作用 |
| --- | --- |
| `GET /menu?version=...` | 匿名；当前公开文档，同版本返回 `unchanged` |
| `GET /menu/assets/{assetId}` | 匿名；当前公开引用图片的短期原图/缩略图 URL |
| `GET /menu/admin/access` | 白名单校验 |
| `GET/PUT /menu/admin/draft` | 读取/保存草稿；PUT 为 `{revision,document}` |
| `GET /menu/admin/preview` | 待预览草稿与修订号 |
| `POST /menu/admin/publish` | `{revision,requestId}`；请求幂等、修订冲突拒绝 |
| `GET /menu/admin/history?cursor=...` | 已发布历史，每页 20 条 |
| `GET /menu/admin/history/{version}` | 读取已发布快照 |
| `POST /menu/admin/restore` | `{revision,version}`；恢复到草稿 |
| `GET /menu/admin/assets/{assetId}` | 草稿或已发布历史图片 |
| `POST /menu/admin/uploads/form-policy` | `{contentType,size}`；获取单对象上传策略 |
| `POST /menu/admin/uploads/complete` | `{assetId,imageKey}`；校验原图并生成缩略图 |

文档结构：`schemaVersion:1`、`shop`、`categories`、`dishes`、`assets`。店铺三个图片字段和菜品 `imageAssetId` 引用 assets 稳定 ID；assets 保存原图/缩略图 Key，不保存签名 URL。价格为字符串 `'0'`。

`menu/draft.json` 保存草稿；`menu/current.json` 指向 `menu/releases/{version}.json`，历史通过 `previousVersion` 串联。发布先写不可变快照，再更新指针。图片在 `menu/images/`、`menu/thumbnails/`，控制数据在 `menu/system/`。

## 失败恢复

**草稿冲突**：保留本地修改，记录差异后重新加载，不自动合并或覆盖。

**发布超时**：先在原预览页重试，复用请求编号；查看公开菜单和历史确认结果。快照成功而指针失败时，同一请求可继续；其间已有其他新版本发布则拒绝倒退。不要手改旧发布 JSON。

**历史恢复**：管理页恢复到草稿，再预览发布。备份和清理保护全部快照，包含尚未挂到当前历史链的失败发布快照。

**初始化失败**：可能留下部分图片或草稿，重复初始化拒绝非空目录。先检查 `current.json`：首发已成功就不再初始化；只有草稿时可在管理页预览发布。仅有部分上传时先备份，确认无运行中的迁移/写操作，由管理员核对本次新增的准确对象后逐项处理，不批量删除整个桶。

**遗留菜单锁**：精确路径 `menu/system/write.lock`，不按时间自动抢占。先停止管理写入与 Timer，确认没有运行中的 SCF 请求或本机迁移；保存锁内容、核对日志及指针/草稿后，才由管理员删除这个对象并恢复任务。不可仅依据创建时间判断失效。

**清理故障**：菜单 Timer 在同一写锁内扫描草稿及全部快照；引用读取异常则停止删除。仅清理超过 24 小时且未引用的图片，每轮最多 200 张；全历史图片始终保留。不扩大心愿夹 Timer 扫描到菜单前缀。

**应用回退**：先回退小程序到原本地菜单/旧双图片上传版本，兼容 SCF 保持在线；云端菜单历史和心愿夹数据保留。修复后再验证新前端。

## 真机验收

- 第三名账号无需登录可浏览，但无法管理、看草稿/历史或上传；两名白名单可编辑，移出白名单后旧令牌失效。
- 两台手机并发保存不会覆盖；草稿变化后旧预览发布被拒绝；发布超时重试不重复生成历史。
- 历史恢复不立即改变公开菜单，再次发布后其他手机刷新同步。
- 分类、上下架、排序、选择/文字规格、标签、三类页面图片、头图位置、微信分享和复制正常。
- 拍照/相册上传、WebP、签名过期、临时下载兜底及断网缓存正常；首次断网无缓存显示重试。
- 云端菜单变空不复活旧菜品；更新清理失效购物车，预览加购不修改真实购物车。
- 心愿夹两分段、原图、旧上传兼容及两类 Timer 正常；历史仍在用图片不被删除。
