# 图片资源说明

仓库已内置可预览占位图，导入微信开发者工具后可以直接看到完整页面。

```text
share.jpg
placeholder-food.jpg
foods/beef-rice.jpg
foods/tomato-noodle.jpg
foods/chicken-soup.jpg
foods/lemon-tea.jpg
backgrounds/page-bg.jpg
backgrounds/header-bg.jpg
```

替换真实图片时，可以同名覆盖这些 JPG 文件，也可以新增图片后修改数据文件中的路径：

- 分享图：`miniprogram/data/shop-data.js` 的 `shareImage`
- 页面背景图：`miniprogram/data/shop-data.js` 的 `pageBackgroundImage`
- 顶部背景图：`miniprogram/data/shop-data.js` 的 `headerBackgroundImage`
- 餐品图片：`miniprogram/data/dish-data.js` 的 `image`

代码中的图片路径是相对菜单页 `miniprogram/pages/menu/` 的写法，例如：

```js
image: '../../assets/foods/beef-rice.jpg'
pageBackgroundImage: '../../assets/backgrounds/page-bg.jpg'
```

如果某张菜品图加载失败，页面会自动回退到：

```text
../../assets/placeholder-food.jpg
```

请保持目录名、文件名和扩展名大小写完全一致。
