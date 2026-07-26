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

## CURRENT.md 更新守卫

项目级 Hook 配置位于 `.codex/hooks.json`，Windows 启动入口是 `.codex/hooks/invoke-current-memory-guard.ps1`。首次添加或修改 Hook 后，在 Codex CLI 中运行 `/hooks`，检查并信任当前项目的 Hook。

手动运行守卫测试：

```powershell
node --test --test-isolation=none .codex\hooks\current-memory-guard.test.cjs
```

守卫只检查本轮修改项目文件时是否同步更新了 `memory/CURRENT.md`，不会自动修改记忆文件。检查自身异常时会显示警告并放行，避免任务被无限阻塞。

## 微信开发者工具预览

1. 打开微信开发者工具。
2. 导入仓库根目录，也就是包含 `project.config.json` 的目录。
3. 当前没有真实 AppID 时，继续使用配置里的 `touristappid` 做开发预览。
4. 编译后进入 `pages/menu/menu`。

## 手动验收

- 分类切换正常。
- 商品展示和图片加载正常。
- 有规格商品能打开规格弹窗。
- 无规格商品能直接加入购物车。
- 购物车数量加减正常。
- 复制已选菜单正常。
- 右上角转发正常。
