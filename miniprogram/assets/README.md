# 图片资源说明

请把真实图片放到这些路径，或在 `miniprogram/data/menu-data.js` 中修改图片地址：

```text
share.jpg
foods/beef-rice.jpg
foods/tomato-noodle.jpg
foods/chicken-soup.jpg
foods/lemon-tea.jpg
```

当前项目代码已引用这些路径，但仓库没有生成真实 JPG 图片。导入微信开发者工具后，如果未替换图片，页面图片区域可能显示为空白或加载失败。

代码中的图片路径使用相对菜单页 `miniprogram/pages/menu/` 的写法，例如 `../../assets/foods/beef-rice.jpg`。请保持文件名大小写完全一致。
