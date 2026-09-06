# 菜单一次性上云工具

这里只负责把旧 Excel 菜单和本地图片初始化到空的 `menu/` 命名空间。上云后在小程序菜单管理页维护，工具不作为日常同步入口，不覆盖已有草稿或发布历史。

## 只读检查

在项目根目录运行：

```powershell
node tools\menu-cloud\migrate.cjs --check
```

默认使用 `D:/Anaconda/python.exe`，可通过 `MENU_PYTHON` 指向已经安装 openpyxl 的 Python。检查复用旧生成器读取 Excel，但不调用生成函数、不改写任何业务数据；核对 `tools/menu-workbook/generated/` 中三个生成 JS 的完整内容、稳定 ID、菜单结构、图片路径和文件头、单图 8 MiB、整份菜单 1 MiB 限制。旧图片位于 `tools/menu-workbook/assets/`，不进入小程序代码包。相同图片内容去重；占位图保持前端占位，不上传。

检查无需云密钥、不访问腾讯云。SDK 复用 `serverless/gift-api/node_modules/cos-nodejs-sdk-v5`，执行前需按项目后端部署说明准备已有生产依赖，不额外安装软件。

## 首次初始化

风险：执行会上传图片并创建首个公开菜单版本，产生存储、图片处理和请求费用。先备份心愿夹、部署新版后端、复核私有 COS、数据万象和运行角色，再执行。工具不会更改桶权限或版本控制，不访问或写入 `gift-folder/`。

使用仅限目标桶 `menu/*` 的临时凭据，在当前终端设置 `TENCENTCLOUD_SECRETID`、`TENCENTCLOUD_SECRETKEY`、`TENCENTCLOUD_SESSIONTOKEN`、`COS_BUCKET`、`COS_REGION`。另需桶级 `cos:GetBucketVersioning` 和限定 `menu/` 的列举权限。CAM 的 `cos:prefix` 条件必须把斜杠 URL 编码为 `menu%2F`；已验证写法是 `"string_equal": { "cos:prefix": "menu%2F" }`，直接写 `menu/` 或 `menu/*` 会导致 `GetBucket` 返回 403。不得将凭据写进代码、提交文件或截图；工具拒绝缺少 SessionToken 的凭据，且不输出凭据。

临时凭据由小主自行从可信的临时授权流程取得，三个凭据字段必须属于同一组，剩余有效期应覆盖全部图片处理时间。不要用永久 SecretId/SecretKey 拼接随意 Token；真实凭据有效性由腾讯云验证。执行权限需覆盖 `cos:GetBucket`（限定 `menu/`）、`cos:GetObject`、`cos:HeadObject`、`cos:PutObject` 和 `cos:DeleteObject`（释放菜单锁），以及数据万象处理所需权限。建议在单独终端中交互输入，避免明文密钥进入命令历史：

```powershell
$env:TENCENTCLOUD_SECRETID = Read-Host '临时 SecretId'
$env:TENCENTCLOUD_SECRETKEY = Read-Host '临时 SecretKey' -MaskInput
$env:TENCENTCLOUD_SESSIONTOKEN = Read-Host '临时 SessionToken' -MaskInput
$env:COS_BUCKET = Read-Host '目标桶名称（含 APPID 后缀）'
$env:COS_REGION = Read-Host '目标桶地域'
```

上述遮蔽输入适用于 PowerShell 7；不要把占位值替换成写在脚本中的实际密钥，也不要保存到 `.env` 或其他明文文件。

```powershell
node tools\menu-cloud\migrate.cjs --execute
```

执行再次做全部本地检查，然后只读核验桶版本控制未开启或已暂停。在与菜单管理相同的 `menu/system/write.lock` 下检查整个 `menu/` 为空，上传原图、调用数据万象生成 WebP 缩略图、核验引用图片，最后写入草稿、不可变首发快照和当前指针。已有任意菜单对象均阻止初始化；重复执行不会覆盖菜单。

上传或发布失败可能留下部分初始化对象，工具不会擅自清理。确认没有正在执行的初始化或管理操作后，按后端恢复手册核验该次对象，再由管理员处理；不要为重试批量删除整个桶或心愿夹。网络结果不确定时先核对 `current.json` 和历史，不直接重跑。

完成后清除当前终端临时凭据，并使用第三位账号匿名查看、两名白名单账号管理，核对分类/菜品数量、规格、排序、图片与首发版本。

```powershell
Remove-Item Env:TENCENTCLOUD_SECRETID,Env:TENCENTCLOUD_SECRETKEY,Env:TENCENTCLOUD_SESSIONTOKEN -ErrorAction SilentlyContinue
```

## 工具测试

```powershell
node --test --test-isolation=none tools\menu-cloud\migration.test.cjs
```

测试只使用临时本地目录和模拟 COS；不访问或修改线上资源。

2026-09-05 首次迁移前只读核验为 16 个分类、71 个菜品、39 张独立图片；随后已生成云端草稿修订号 `1` 和首发版本 `r_58e060cbe9d7d8551614fca2d8803e69`。该记录不替代公开接口、COS 对象及真机验收。工具测试覆盖初次发布、重复与残留命名空间拒绝、缩略图失败及写锁释放。
