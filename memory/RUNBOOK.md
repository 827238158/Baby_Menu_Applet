# 运行手册

## 菜单数据生成

修改 Excel 后，在项目根目录运行：

```powershell
node tools\generate-menu-data.js
```

该命令会生成：

```text
miniprogram/data/shop-data.js
miniprogram/data/category-data.js
miniprogram/data/dish-data.js
```

`miniprogram/data/menu-data.js` 只做聚合和排序，通常不要手改。

## 语法检查

```powershell
node --check miniprogram\pages\menu\menu.js
node --check miniprogram\pages\gifts\gifts.js
node --check miniprogram\services\gift-api.js
node --check miniprogram\config\gift-cloud.js
node --check miniprogram\data\shop-data.js
node --check miniprogram\data\category-data.js
node --check miniprogram\data\dish-data.js
node --check miniprogram\data\menu-data.js
```

## 数据聚合检查

```powershell
node --input-type=module -e "import('./miniprogram/data/menu-data.js').then(({default:data})=>{const dishes=data.categories.flatMap(c=>c.items); console.log(data.categories.length,dishes.length,dishes.reduce((n,d)=>n+(d.tags||[]).length,0),dishes.reduce((n,d)=>n+(d.options||[]).length,0));})"
```

## 空白检查

```powershell
git diff --check
```

## 心愿夹云端测试

```powershell
node --test --test-isolation=none minitest\gift-api.test.cjs minitest\gifts-page.test.cjs minitest\menu-page.test.cjs
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
npm ci --omit=dev
tar.exe -a -c -f gift-api.zip index.js src node_modules package.json
Get-Item gift-api.zip | Select-Object FullName,Length,LastWriteTime
tar.exe -tf gift-api.zip | Select-String -Pattern '^(index.js|src/app.js|package.json)$'
```

只要 `index.js`、`src/`、`package.json` 或生产依赖发生变化，都要重新执行上述命令，在腾讯云 SCF 控制台上传新 ZIP 并完成部署/发布。上传前确认 ZIP 修改时间晚于后端源码修改时间；涉及新路由时，还要从 ZIP 中检查对应代码确实存在。

部署参数、运行角色、环境变量、OpenID 发现模式和合法域名见 `serverless/gift-api/README.md`。

## SCF 部署后验证

上传前先备份生产 `index.json` 和 `gifts/` 前缀，确认 COS 版本控制已暂停、角色已增加 `cos:PostObject`、COS 域名已加入微信 `uploadFile` 合法域名。完整兼容发布顺序见 `serverless/gift-api/README.md`。

上传 ZIP 并完成部署后，不要只检查控制台显示成功，还要在真机验证实际路由：

1. 访问 `/health`，确认函数可以正常响应。
2. 进入心愿夹，确认“礼品夹 / 装修好物”分段切换和列表缩略图可以加载。
3. 点击一张有原图的礼品图片进入全屏预览。
4. 确认 `GET /gifts/{id}/image` 不再返回“接口不存在”，并能加载对应原图。
5. 分别从相册和相机选图；拍照后应进入微信图片编辑，确认后由 `wx.uploadFile` POST Object 直传。
6. 预览图左上角圆形叉号不变形；点击后取消应保留，确认后只移除草稿图片。
7. 用两名用户并发新增/编辑，并在 21 条以上数据中续载，确认无丢失、重复或跳项。
8. 在礼品夹和装修好物分别完成新增、编辑、删除、缩略图和原图预览，确认两区不串数据。
9. 分别把一件有图收藏从礼品夹移到装修好物、再移回，确认 ID、图片、名称和简介不变，目标数量正确，重复提交移动请求不产生重复数据。
10. 创建 `GiftImageCleanupDaily` Timer 并执行控制台测试；日志应包含 `gift` / `decor` 分项和总计，且不删除任一区在用、移动后仍被引用或不足 24 小时的图片。

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
4. 编译后进入 `pages/menu/menu`。

## 手动验收

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
- 图片直传 COS，加载失败时可以回退到微信临时下载路径。
- 礼品图片可从相机或相册选择；拍照后可编辑，预览叉号需二次确认；列表续载、全屏预览按需加载原图、点击图片退出与退出按钮均正常。
