# 运行手册

## 语法检查

```powershell
node --check miniprogram\pages\menu\menu.js
node --check miniprogram\pages\gifts\gifts.js
node --check miniprogram\services\gift-api.js
node --check miniprogram\config\gift-cloud.js
```

## 空白检查

```powershell
git diff --check
```

## 全量本地测试

```powershell
node --test --test-isolation=none minitest/*.test.cjs
Set-Location serverless\gift-api
npm test
npm run check
npm audit --omit=dev
```

## SCF 打包

```powershell
Set-Location serverless\gift-api
npm test
npm run check
npm ls --omit=dev
tar.exe -a -c -f gift-api.zip index.js src node_modules package.json
Get-Item gift-api.zip | Select-Object FullName,Length,LastWriteTime
tar.exe -tf gift-api.zip | Select-String -Pattern '^(index.js|src/app.js|package.json)$'
```

本次未改变生产依赖，使用 `npm ls --omit=dev` 核对现有安装即可，无需重装。以后 lockfile 改变时，先确认 Node 环境和依赖来源；需要下载包时按用户下载约定处理，再安装锁定依赖。

只要 `index.js`、`src/`、`package.json` 或生产依赖发生变化，都要重新执行上述命令，在腾讯云 SCF 控制台上传新 ZIP 并完成部署/发布。上传前确认 ZIP 修改时间晚于后端源码修改时间；涉及新路由时，还要从 ZIP 中检查对应代码确实存在。

部署参数、运行角色、环境变量、OpenID 发现模式和合法域名见 `serverless/gift-api/README.md`。

## 菜单创建与发布

旧 Excel 转换和首次迁移工具已淘汰。首次使用时，由白名单管理员在菜单管理页创建内容、保存草稿、预览并发布；权限、失败恢复与验收见 [菜单部署手册](../docs/menu-cloud-deployment.md)。

菜单新增脚本语法检查：

```powershell
node --check miniprogram/services/cloud-client.js
node --check miniprogram/services/menu-api.js
node --check miniprogram/services/menu-images.js
node --check miniprogram/services/menu-document.js
node --check miniprogram/services/menu-cloud-page.js
node --check miniprogram/services/menu-page.js
node --check miniprogram/pages/menu-admin/menu-admin.js
node --check miniprogram/pages/menu-preview/menu-preview.js
```

本机测试命令使用支持 `--test-isolation=none` 的 Node；SCF Node 18 执行生产入口，不运行本机测试命令。不得据本机测试推断已经完成 SCF 真机验证。

部署 ZIP 应包含 `src/menu/document.js`、`repository.js`、`service.js`。部署后保留 `GiftImageCleanupDaily` 并新增 `MenuImageCleanupDaily`，不能互相替换。

## SCF 部署后验证

上传前先备份生产两份 `index.json` 和礼品、装修好物的图片前缀，确认 COS 版本控制已暂停、目标桶已绑定数据万象；复核 SCF 角色具有 `cos:GetBucket`、`cos:GetObject`、`cos:HeadObject`、`cos:PutObject`、`cos:PostObject`、`cos:DeleteObject`，SCF/COS 域名分别加入微信 `request`、`uploadFile`、`downloadFile` 合法域名。完整兼容发布顺序见 `serverless/gift-api/README.md`。

缩略图迁移必须先部署兼容版 SCF，再发布新版小程序。SCF 需同时支持 `POST /uploads/thumbnail`、`POST /collections/decor/uploads/thumbnail` 和旧客户端 `asset: thumbnail` 表单直传；后端未验证前不要发布只上传原图的前端。

上传 ZIP 并完成部署后，不要只检查控制台显示成功，还要在真机验证实际路由：

1. 访问 `/health`，确认函数可以正常响应。
2. 进入心愿夹，确认“礼品夹 / 装修好物”分段切换和列表缩略图可以加载。
3. 点击一张有原图的礼品图片进入全屏预览。
4. 确认 `GET /gifts/{id}/image` 不再返回“接口不存在”，并能加载对应原图。
5. 分别从相册和相机选图；拍照后应进入微信图片编辑，新版每次选图只由 `wx.uploadFile` POST Object 直传一份原图，再由 SCF 调用数据万象持久化生成缩略图。
6. 预览图左上角圆形叉号不变形；点击后取消应保留，确认后只移除草稿图片。
7. 用两名用户并发新增/编辑，并在 21 条以上数据中续载，确认无丢失、重复或跳项。
8. 在礼品夹和装修好物分别完成新增、编辑、删除、缩略图和原图预览，确认两区不串数据；新缩略图必须为 WebP、最长边不超过 800px、方向正确且不含 EXIF。
9. 分别把一件有图收藏从礼品夹移到装修好物、再移回，确认 ID、图片、名称和简介不变，目标数量正确，重复提交移动请求不产生重复数据。
10. 创建 `GiftImageCleanupDaily` Timer 并执行控制台测试；日志应包含 `gift` / `decor` 分项和总计，且不删除任一区在用、移动后仍被引用或不足 24 小时的图片。
11. 在数据万象控制台检查“基础图片处理”新增对应使用量，并观察 SCF 错误日志、COS 对象和外网流量；模拟处理失败时应阻止保存，且前端等待原图清理完成后才提示原始错误。

2026-07-29 已完成一次新版 ZIP 部署，原图接口真机功能验证正常。

## 项目记忆 Hook

项目级配置位于 `.codex/hooks.json`，脚本和领域路由位于 `.codex/hooks/`。Hook 分别在 `UserPromptSubmit`、`PostToolUse` 和 `Stop` 阶段执行定向记忆召回、匿名失败信号收集和最小归档门禁，不会自动修改项目记忆。

使用安装时指定的 Conda base Python 运行单元测试：

```powershell
& 'D:\Anaconda\python.exe' -X utf8 -B -m unittest discover -s .codex\hooks -p 'test_*.py' -v
```

校验 Hook 资产和事件配置是否仍与技能模板一致：

```powershell
& 'D:\Anaconda\python.exe' 'C:\Users\AQCJ\.codex\skills\project-agent-bootstrap\scripts\install_memory_hooks.py' --project-root 'G:\BackUp\AI+网络项目孵化\Baby_Menu_Applet' --python 'D:\Anaconda\python.exe' --check
```

首次安装或修改 Hook 命令、脚本后，在 Codex 中使用 `/hooks` 审查并信任当前项目 Hook。Hook 无法读取项目、Git 基线或临时状态时会显示降级警告并放行，此时由 Agent 手工完成检索和归档审计。

## 微信开发者工具预览

1. 打开微信开发者工具。
2. 导入仓库根目录，也就是包含 `project.config.json` 的目录。
3. 使用 `project.config.json` 中已经配置的小程序 AppID。
4. 编译后进入 `pages/menu/menu`；需要新版云端接口及已初始化菜单。无缓存而未部署时显示重试，不加载旧数据。
5. 新增页面后清缓存并编译；三页静态资源/事件检查已纳入 minitest。

## 手动验收

菜单上云还需完成 [部署手册的真机验收](../docs/menu-cloud-deployment.md)：匿名阅读、两人编辑、共享草稿冲突、发布/恢复、全历史图片保护、缓存与预览购物车隔离。

- 分类切换正常。
- 商品展示和图片加载正常。
- 有规格商品能打开规格弹窗。
- 无规格商品能直接加入购物车。
- 购物车数量加减正常。
- 复制已选菜单正常。
- 右上角转发正常。
- 心愿夹白名单校验期间显示骨架，授权后才显示云端数据或网络失败兜底缓存。
- 礼品夹与装修好物可通过顶部分段点按切换；只有胶囊左右滑动，页面无纵向跳动，头图和分段始终可见，两区各自恢复列表滚动位置。
- 两名授权用户能互相看到新增、编辑和删除结果。
- 未授权账号进入心愿夹时提示无权限并返回。
- 仅文字、仅图片和图片加文字均可保存。
- 新图片只直传原图到 COS，由 SCF 调用数据万象持久化生成 WebP 缩略图；加载失败时仍可回退到微信临时下载路径。
- 礼品图片可从相机或相册选择；拍照后可编辑，预览叉号需二次确认；列表续载、全屏预览按需加载原图、点击图片退出与退出按钮均正常。
