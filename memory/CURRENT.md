# 当前任务

## 本轮任务

把心愿夹本地压缩和双图片上传迁移为数据万象持久化生成缩略图。

## 目标与验收

- 新版小程序每次选图只上传一份原图，不再调用 `wx.compressImage`。
- SCF 为礼品和装修好物分别提供鉴权缩略图接口，使用数据万象生成最长边 800px、质量 75、自动回正并移除 EXIF 的 WebP。
- 数据万象失败时阻止保存，并等待孤儿原图清理完成后返回原始错误。
- 旧图不回填，旧客户端 `asset: thumbnail` 双上传流程继续兼容。

## 影响区域

- `serverless/gift-api/`
- `miniprogram/services/gift-api.js`
- `miniprogram/pages/gifts/gifts.js`
- `minitest/`
- 部署、运行、设计和项目记忆文档

## 当前状态

- 本地代码、测试与文档已完成：小程序已移除本地缩略图状态与 `wx.compressImage`，SCF 已增加礼品、装修好物两条持久化缩略图接口及数据万象仓储调用。
- 小程序 52 项、SCF 27 项测试全部通过；前后端 JS 语法检查、`npm audit --omit=dev`（0 个漏洞）和 `git diff --check` 通过。
- 已重新生成 `serverless/gift-api/gift-api.zip`，并核对 ZIP 包含两条新路由、`image_process` 调用和固定处理规则。
- 尚未部署腾讯云 SCF，尚未发布新版小程序，也未完成开发者工具或真机验收。

## 阻塞与下一步

- 发布前备份两份索引和图片前缀，复核数据万象绑定、SCF 权限、COS 版本控制与微信合法域名。
- 先部署并验证兼容版 SCF，再发布新版小程序；真机覆盖礼品、装修好物、相册、拍照编辑、列表 WebP 和全屏原图。
