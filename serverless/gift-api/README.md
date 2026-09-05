# 心愿夹 SCF 部署手册

本目录是独立的 Node.js 18 SCF 事件函数。礼品和装修好物的元数据、图片都保存在同一个私有 COS，不使用数据库；两者复用同一套白名单和会话鉴权，但使用互相隔离的索引、图片前缀和写锁。`gift-folder/index.json` schema v2 仍是礼品元数据的唯一真源，旧版路由和对象 Key 不变。

## 1. 创建私有 COS 存储桶

1. 在腾讯云 COS 控制台创建存储桶，访问权限选择“私有读写”。
2. 记录完整桶名，例如 `baby-gifts-1250000000`，以及地域，例如 `ap-guangzhou`。
3. SCF 与 COS 选择同一地域。
4. 不要给存储桶或对象开放公共读写权限。
5. 检查“版本控制”：若已开启，上线写锁前先暂停版本控制，不删除历史版本。版本控制开启时 `x-cos-forbid-overwrite:true` 会失效，不能依靠它互斥写入。

程序会自动使用以下对象结构：

```text
gift-folder/gifts/{giftId}.json
gift-folder/images/{giftId}/{timestamp}_{random}.{ext}
gift-folder/thumbnails/{giftId}/{timestamp}_{random}.webp
gift-folder/index.json
gift-folder/system/index.lock
gift-folder/decor/images/{decorId}/{timestamp}_{random}.{ext}
gift-folder/decor/thumbnails/{decorId}/{timestamp}_{random}.webp
gift-folder/decor/index.json
gift-folder/decor/system/index.lock
```

新版小程序只把原图上传到 `images/`；SCF 随后调用数据万象 `image_process`，以 `imageMogr2/auto-orient/thumbnail/800x800>/strip/format/webp/quality/75` 持久化生成同名 WebP 缩略图。历史缩略图保持原样，不批量回填；旧客户端通过 `form-policy` 请求 `asset: thumbnail` 的双上传流程继续兼容。

`gifts/*.json` 是 v1 回滚备份：已有 `index.json` 时以它的礼品集合为准；只有索引不存在时才扫描旧 JSON 重建。升级后日常增删改只写 `index.json`，不再双写礼品 JSON。

首次部署前必须另行备份生产 `gift-folder/index.json` 和 `gift-folder/gifts/` 前缀，不要用本地文件覆盖线上索引。

### 业务路由

原有礼品路由全部保持不变。装修好物新增：

```text
GET    /collections/decor/items
POST   /collections/decor/items
PUT    /collections/decor/items/{id}
DELETE /collections/decor/items/{id}
GET    /collections/decor/items/{id}/image
POST   /collections/decor/uploads/form-policy
DELETE /collections/decor/uploads/orphan
POST   /collections/items/{id}/move
```

持久化缩略图接口：

```text
POST   /uploads/thumbnail
POST   /collections/decor/uploads/thumbnail
```

礼品接口请求体为 `{ "giftId": "...", "imageKey": "..." }`，装修接口请求体为 `{ "itemId": "...", "imageKey": "..." }`，成功统一返回 `{ "thumbnailKey": "..." }`。服务端只接受对应收藏项 ID 下 `images/` 命名空间的原图 Key，缩略图 Key 由原图文件名确定性派生；重复请求发现有效 WebP 已存在时直接复用。数据万象处理失败会返回 `503 THUMBNAIL_PROCESSING_UNAVAILABLE`，新版小程序必须等待孤儿原图清理结束后再提示失败并阻止保存，不能把原图降级为列表缩略图。

新建装修好物的 ID 必须以 `decor_` 开头。移动接口请求体为 `{ "targetCollection": "gift" | "decor" }`，在固定顺序取得两区写锁后先写目标索引、再移除来源；同一请求可安全重试。移动会保留收藏项 ID 和图片 Key，因此移动后的收藏项可以继续引用原命名空间中属于自身 ID 的图片，但仍禁止引用其他收藏项的图片。

上传策略请求使用 `giftId`/`itemId`、`contentType`、`size`、`asset`。新版小程序只请求 `asset: image` 并上传原图；`asset: thumbnail` 只为旧客户端兼容保留。新图片仍写入当前分段的图片目录；编辑已经移动过的收藏项时，服务端接受根目录或 `decor/` 目录中归属同一收藏项 ID 的图片。

## 2. 创建 SCF 运行角色

在 CAM 创建角色，角色载体选择“云函数 SCF”，再使用可按资源授权的自定义策略限制到目标存储桶。需要的 COS 操作只有：

```text
GetBucket
GetObject
HeadObject
PutObject
PostObject
DeleteObject
```

在 CAM 策略中对应为 `cos:GetBucket`、`cos:GetObject`、`cos:HeadObject`、`cos:PutObject`、`cos:PostObject`、`cos:DeleteObject`。资源范围选择目标存储桶及其 `gift-folder/*` 对象。`GetBucket` 用于列出旧礼品和图片前缀，其资源范围需要包含存储桶本身；`HeadObject` 用于保存前校验图片；`PostObject` 供小程序使用 SCF 临时角色凭据签名的表单直传。不要直接使用账号级永久 SecretId/SecretKey。

持久化缩略图上线前，还要在数据万象控制台确认目标 COS 存储桶已绑定数据万象。SCF 通过现有临时角色凭据读取原图、写入并校验 WebP；若绑定关系或 `GetObject`、`HeadObject`、`PutObject` 权限缺失，缩略图接口会失败。删除处理失败的残留对象和前端清理孤儿原图还需要 `DeleteObject`。

SCF 绑定运行角色后，会自动注入：

```text
TENCENTCLOUD_SECRETID
TENCENTCLOUD_SECRETKEY
TENCENTCLOUD_SESSIONTOKEN
```

## 3. 安装依赖并打包

在项目根目录运行：

```powershell
Set-Location serverless\gift-api
npm ci --omit=dev
tar.exe -a -c -f gift-api.zip index.js src node_modules package.json
```

ZIP 根目录必须直接包含 `index.js`，不能再套一层 `gift-api` 文件夹。这里使用 `tar.exe`，避免 Windows `Compress-Archive` 把 ZIP 内目录分隔符写成反斜杠。

### 更新已存在的 SCF 函数

修改 `index.js`、`src/`、`package.json` 或生产依赖后，Git push 不会自动更新腾讯云 SCF。需要重新测试、打包，并在 SCF 控制台上传新的 `gift-api.zip` 完成部署。

上传前确认 ZIP 修改时间晚于相关源码；新增路由时，还要检查 ZIP 内确实包含对应代码。部署后必须从真机实际调用新路由，不能只以控制台显示“部署成功”作为验收。

## 4. 创建事件函数

在 SCF 控制台从头创建函数：

- 函数类型：事件函数
- 运行环境：Node.js 18
- 建议名称：`baby-menu-gift-api`
- 地域：与 COS 相同
- 执行方法：`index.main_handler`
- 内存：128MB
- 超时：60秒（兼顾每日孤儿图片扫描与分批删除）
- 运行角色：第2步创建的最小权限角色
- 代码提交：上传 `gift-api.zip`

添加环境变量：

| 名称 | 值 |
| --- | --- |
| `WX_APP_ID` | 当前微信小程序 AppID |
| `WX_APP_SECRET` | 小程序 AppSecret，只在 SCF 控制台填写 |
| `ALLOWED_OPENIDS` | 两个 OpenID，以英文逗号分隔 |
| `SESSION_SECRET` | 至少32位随机字符串 |
| `COS_BUCKET` | 完整桶名，包含账号 APPID 后缀 |
| `COS_REGION` | COS 地域 |
| `COS_PREFIX` | `gift-folder` |
| `OPENID_DISCOVERY` | 正常使用时为 `false` |
| `LEGACY_PUT_UPLOAD_UNTIL` | 兼容阶段才填 ISO 时间或毫秒时间戳，且不得超过部署日后 7 天；最终版留空 |

`LEGACY_PUT_UPLOAD_UNTIL` 只用于短期兼容旧小程序的 `POST /uploads/presign` PUT 上传。每次调用都会写警告日志；两名用户确认升级后立即留空并部署最终包，后续再从代码移除旧路由。

## 5. 创建函数 URL

在函数详情的“函数 URL”中创建公网 URL：

- 公网访问：开启
- 授权类型：开放
- CORS：可关闭，小程序请求不依赖浏览器 CORS

函数 URL 必须开放，是因为业务鉴权由 `wx.login`、OpenID 白名单和会话令牌完成。访问：

```text
GET https://你的函数URL/health
```

应返回：

```json
{"data":{"status":"ok"}}
```

随后把不带末尾 `/` 的函数 URL 填入：

```text
miniprogram/config/gift-cloud.js
```

部署或更新完成后，依次验证：

1. `GET /health` 正常响应。
2. 礼品列表和缩略图正常加载。
3. 点击礼品图片进入全屏预览，`GET /gifts/{id}/image` 能返回并展示对应原图。
4. 礼品和装修好物分别上传一张新图，确认只直传原图，随后两个缩略图接口都能返回对应 `.webp` Key。
5. 检查持久化对象为 WebP、最长边不超过 800px、方向正确且不含 EXIF；数据万象控制台“基础图片处理”应出现对应使用量。
6. 新增、编辑、删除及 POST Object 图片直传正常。
7. 超过 20 条时触底续载，验证键集分页没有重复或跳项。

当前原图接口已于 2026-07-29 上传并部署，真机功能验证正常。

## 6. 首次收集两个 OpenID

此操作会把完整 OpenID 写入 SCF 日志，属于敏感个人标识，只应短时间启用。

1. 暂时设置 `OPENID_DISCOVERY=true`，`ALLOWED_OPENIDS` 可以先留空。
2. 发布体验版，让两名用户分别进入一次礼品夹。
3. 在 SCF 日志中搜索 `[OPENID_DISCOVERY]`，取得两个 OpenID。
4. 将两个 OpenID 写入 `ALLOWED_OPENIDS`。
5. 立即把 `OPENID_DISCOVERY` 改回 `false`，并清理或缩短相关日志保留时间。
6. 两人重新进入礼品夹，确认可以正常访问。

发现模式只记录 OpenID，不会让未在白名单中的账号通过业务鉴权。

## 7. 配置微信合法域名

在微信公众平台的小程序“开发管理 > 开发设置 > 服务器域名”中配置：

- `request` 合法域名：SCF 函数 URL 域名。
- `uploadFile` 合法域名：COS 存储桶访问域名，用于 POST Object 表单直传。
- `downloadFile` 合法域名：COS 存储桶访问域名，用于图片加载失败后的临时下载兜底。

只填写域名，不填写路径和签名参数。真机请求必须通过合法域名校验，不能依赖开发者工具里的“不校验合法域名”选项。

## 8. 安全与费用建议

- COS 始终保持私有。
- SCF 不配置预置并发，内存保持 128MB，超时设为 60 秒以容纳 Timer 扫描和清理。
- CLS 日志只保留排障需要的最短时间，关闭 OpenID 发现模式后避免记录身份信息。
- 在费用中心设置预算告警，并为 SCF、COS 请求量和外网下行流量设置监控告警。
- 更新函数代码前先运行 `npm test` 和 `npm run check`。
- 礼品列表使用根目录 `index.json` v2 键集分页，装修好物使用 `decor/index.json` v2 键集分页，每页最多 20 件。普通写入分别使用自己的锁；跨分类移动固定按礼品锁、装修锁顺序同时加锁。
- 新版小程序只上传原图，SCF 通过数据万象持久化生成最长边 800px、质量 75、自动回正且移除 EXIF 的 WebP 缩略图；列表只使用缩略图，全屏查看时才签发原图临时 URL。旧图片和旧缩略图不批量回填，重新选择图片后才使用新链路。
- 所有 JSON 请求体最多 8KB。`/auth/login` 按 `x-scf-remote-addr` 做每暖实例滑动窗口限流；冷启动或切换实例会重置，不是跨实例全局限流。

## 9. 每日孤儿图片清理 Timer

在同一 SCF 函数上创建定时触发器：

- 触发器名：`GiftImageCleanupDaily`
- 频率：每天一次，选择业务低峰时段
- 目标：当前 `index.main_handler`

函数只接受“无 HTTP 方法、`Type === "Timer"`、`TriggerName === "GiftImageCleanupDaily"`”的内部事件。每次分别扫描两个图片命名空间，但删除前会合并两份索引的引用集合，保护移动后仍留在原命名空间的图片；只删除超过 24 小时且未被任一索引引用的对象，每个命名空间单次最多 200 个。删除失败保留到次日重试，日志同时记录总计和 `gift` / `decor` 分项统计。

创建后先用控制台测试事件执行一次，核对不会删除当前索引在用或不足 24 小时的图片。

## 10. 兼容上线顺序

1. 备份生产两份 `index.json` 和礼品、装修好物的 `images/`、`thumbnails/` 前缀。
2. 核验 COS 版本控制保持暂停，确认目标桶已绑定数据万象；复核 SCF 角色具备 `GetBucket`、`GetObject`、`HeadObject`、`PutObject`、`PostObject`、`DeleteObject`，以及 SCF/COS 对应的微信 `request`、`uploadFile`、`downloadFile` 合法域名。
3. 先部署同时支持新缩略图接口和旧客户端 `asset: thumbnail` 的兼容版 SCF；不要先发布新版小程序。
4. 用一次性测试图片分别调用礼品和装修好物链路，检查 WebP 格式、最长边、方向、EXIF、对象 Key，以及数据万象“基础图片处理”用量；再确认失败时不写收藏项并清理原图。
5. 后端验证通过后再发布只上传原图的新版小程序；两名用户分别真机验证相册、拍照编辑、新增、换图、列表缩略图和全屏原图。
6. 观察 SCF 错误日志、COS 对象、基础图片处理用量与外网流量；确认每日 Timer 仍保护两份索引引用的原图和缩略图。
7. 若新版异常，先回退小程序到旧双上传版本，保持兼容版 SCF 在线；旧客户端恢复后再决定是否回退后端。

`POST /uploads/presign` 的短期 PUT 兼容窗口仍按 `LEGACY_PUT_UPLOAD_UNTIL` 管理，与本次保留的 `asset: thumbnail` POST Object 兼容能力是两件事，不要混淆。

腾讯云官方参考：[PUT Object 禁止覆盖与版本控制](https://cloud.tencent.com/document/product/436/71307)、[POST Object 策略签名](https://cloud.tencent.com/document/product/436/54370)、[SCF Timer 触发器事件](https://cloud.tencent.com/document/product/583/9708)。
