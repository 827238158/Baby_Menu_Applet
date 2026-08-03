# 礼品夹 SCF 部署手册

本目录是独立的 Node.js 18 SCF 事件函数。礼品元数据和图片都保存在私有 COS，不使用数据库。`index.json` schema v2 是礼品元数据的唯一真源。

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
gift-folder/thumbnails/{giftId}/{timestamp}_{random}.{ext}
gift-folder/index.json
gift-folder/system/index.lock
```

`gifts/*.json` 是 v1 回滚备份：已有 `index.json` 时以它的礼品集合为准；只有索引不存在时才扫描旧 JSON 重建。升级后日常增删改只写 `index.json`，不再双写礼品 JSON。

首次部署前必须另行备份生产 `gift-folder/index.json` 和 `gift-folder/gifts/` 前缀，不要用本地文件覆盖线上索引。

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
4. 新增、编辑、删除及 POST Object 图片直传正常。
5. 超过 20 条时触底续载，验证键集分页没有重复或跳项。

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
- 礼品列表使用 `index.json` v2 键集分页，每页最多 20 件；写操作通过 `system/index.lock` 串行化，锁冲突会返回 503 而不是相互覆盖。
- 新图片同时保存原图与压缩缩略图：列表只使用缩略图，全屏查看时才签发原图临时 URL。旧图片会回退使用原图，编辑并重新选择图片后会自动升级。
- 所有 JSON 请求体最多 8KB。`/auth/login` 按 `x-scf-remote-addr` 做每暖实例滑动窗口限流；冷启动或切换实例会重置，不是跨实例全局限流。

## 9. 每日孤儿图片清理 Timer

在同一 SCF 函数上创建定时触发器：

- 触发器名：`GiftImageCleanupDaily`
- 频率：每天一次，选择业务低峰时段
- 目标：当前 `index.main_handler`

函数只接受“无 HTTP 方法、`Type === "Timer"`、`TriggerName === "GiftImageCleanupDaily"`”的内部事件。每次在索引锁内扫描原图与缩略图前缀，只删除超过 24 小时且未被 `imageKey` / `thumbnailKey` 引用的对象，单次最多 200 个。删除失败保留到次日重试，日志记录 `scanned` / `candidates` / `deleted` / `failed`。

创建后先用控制台测试事件执行一次，核对不会删除当前索引在用或不足 24 小时的图片。

## 10. 兼容上线顺序

1. 备份生产 `index.json` 和旧 `gifts/` 前缀。
2. 核验 COS 版本控制，已开启则暂停。
3. 增加 `cos:PostObject` 权限，设定不超过 7 天的 `LEGACY_PUT_UPLOAD_UNTIL`，部署兼容版 SCF。
4. 将 COS 域名加入微信 `uploadFile` 合法域名，再发布新版小程序。
5. 两名用户均确认更新且拍照/相册上传正常后，清空兼容时间并部署最终 SCF；核对日志不再有旧 PUT 调用。
6. 创建每日 Timer 并执行一次受控测试。
7. 最终重新打包，核对 ZIP 时间、`cos-nodejs-sdk-v5@3.0.0` 和关键路由后再上传。

腾讯云官方参考：[PUT Object 禁止覆盖与版本控制](https://cloud.tencent.com/document/product/436/71307)、[POST Object 策略签名](https://cloud.tencent.com/document/product/436/54370)、[SCF Timer 触发器事件](https://cloud.tencent.com/document/product/583/9708)。
