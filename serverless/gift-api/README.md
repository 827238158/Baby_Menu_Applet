# 礼品夹 SCF 部署手册

本目录是独立的 Node.js 18 SCF 事件函数。礼品 JSON 和图片都保存在私有 COS，不使用数据库。

## 1. 创建私有 COS 存储桶

1. 在腾讯云 COS 控制台创建存储桶，访问权限选择“私有读写”。
2. 记录完整桶名，例如 `baby-gifts-1250000000`，以及地域，例如 `ap-guangzhou`。
3. SCF 与 COS 选择同一地域。
4. 不要给存储桶或对象开放公共读写权限。

程序会自动使用以下对象结构：

```text
gift-folder/gifts/{giftId}.json
gift-folder/images/{giftId}/{timestamp}_{random}.{ext}
gift-folder/thumbnails/{giftId}/{timestamp}_{random}.{ext}
gift-folder/index.json
```

## 2. 创建 SCF 运行角色

在 CAM 创建角色，角色载体选择“云函数 SCF”，再使用可按资源授权的自定义策略限制到目标存储桶。需要的 COS 操作只有：

```text
GetBucket
GetObject
HeadObject
PutObject
DeleteObject
```

资源范围选择目标存储桶及其 `gift-folder/*` 对象。`GetBucket` 用于列出 `gift-folder/gifts/`，其资源范围需要包含存储桶本身；`HeadObject` 用于在保存礼品前确认已上传图片确实存在。不要直接使用账号级永久 SecretId/SecretKey。

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

## 4. 创建事件函数

在 SCF 控制台从头创建函数：

- 函数类型：事件函数
- 运行环境：Node.js 18
- 建议名称：`baby-menu-gift-api`
- 地域：与 COS 相同
- 执行方法：`index.main_handler`
- 内存：128MB
- 超时：10秒
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
- `request` 合法域名：COS 存储桶访问域名，用于预签名 PUT。
- `downloadFile` 合法域名：COS 存储桶访问域名，用于图片加载失败后的临时下载兜底。

只填写域名，不填写路径和签名参数。真机请求必须通过合法域名校验，不能依赖开发者工具里的“不校验合法域名”选项。

## 8. 安全与费用建议

- COS 始终保持私有。
- SCF 不配置预置并发，内存保持128MB，超时保持10秒。
- CLS 日志只保留排障需要的最短时间，关闭 OpenID 发现模式后避免记录身份信息。
- 在费用中心设置预算告警，并为 SCF、COS 请求量和外网下行流量设置监控告警。
- 更新函数代码前先运行 `npm test` 和 `npm run check`。
- 礼品列表使用 `index.json` 分页返回，每页最多 20 件；首次部署新版后，第一次读取礼品夹会自动从既有礼品 JSON 建立索引。
- 新图片同时保存原图与压缩缩略图：列表只使用缩略图，全屏查看时才签发原图临时 URL。旧图片会回退使用原图，编辑并重新选择图片后会自动升级。
