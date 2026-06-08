# 微信小程序展示点餐页

这是一个标准微信原生小程序项目，用于展示一个可分享的点餐菜单页面。项目不包含后端、数据库、登录、支付或真实下单能力，所有交互只保存在前端页面内。

## 开发计划

1. 使用原生微信小程序目录结构，入口页面为 `pages/menu/menu`。
2. 使用 `miniprogram/data/menu-data.js` 集中维护店铺、分享、分类、菜品、价格、标签和图片路径。
3. 使用 WXML、WXSS、JS、JSON 实现页面，不引入 Vue、React、Taro、uni-app 或编译依赖。
4. 使用 `scroll-view` 实现分类和菜品列表滚动。
5. 使用 `image` 展示菜品图和分享封面图。
6. 使用 `onShareAppMessage` 和 `button open-type="share"` 实现微信小程序分享。
7. 实现纯前端交互：分类切换、详情弹窗、模拟加入已选、清空已选。
8. 底部固定展示“仅展示，不可下单”。

## 目录结构

```text
.
├── README.md
├── project.config.json
└── miniprogram
    ├── app.js
    ├── app.json
    ├── app.wxss
    ├── sitemap.json
    ├── data
    │   └── menu-data.js
    ├── pages
    │   └── menu
    │       ├── menu.js
    │       ├── menu.json
    │       ├── menu.wxml
    │       └── menu.wxss
    └── assets
        ├── README.md
        ├── share.jpg
        └── foods
            ├── beef-rice.jpg
            ├── tomato-noodle.jpg
            ├── chicken-soup.jpg
            └── lemon-tea.jpg
```

图片文件名和代码中的路径大小写必须完全一致。当前仓库保留了图片路径说明，请把真实图片放到上面列出的路径。

## Linux 上如何编辑项目

在 Linux 上可以直接使用 VS Code、Cursor、Vim 或其他编辑器修改文件。

常改文件：

- `miniprogram/data/menu-data.js`：修改店铺信息、分享标题、分类、菜品、价格、标签和图片路径
- `miniprogram/pages/menu/menu.wxml`：修改页面结构
- `miniprogram/pages/menu/menu.wxss`：修改页面样式
- `miniprogram/pages/menu/menu.js`：修改页面交互和分享逻辑
- `project.config.json`：修改小程序项目配置和 AppID

不需要在 Linux 上运行微信开发者工具。

## 如何上传到 GitHub

在项目根目录执行：

```bash
git add .
git commit -m "Create shareable mini program menu page"
git branch -M main
git remote add origin <你的 GitHub 仓库地址>
git push -u origin main
```

如果已经配置过远程仓库，只需要：

```bash
git add .
git commit -m "Update mini program menu page"
git push
```

## Windows 上如何用微信开发者工具打开

1. 在 Windows 上从 GitHub 克隆项目，或把项目目录复制到 Windows。
2. 打开微信开发者工具。
3. 选择“导入项目”。
4. 项目目录选择仓库根目录，也就是包含 `project.config.json` 的目录。
5. 微信开发者工具会读取 `project.config.json`，并使用 `miniprogram/` 作为小程序根目录。
6. 编译后会直接进入 `pages/menu/menu` 点餐页面。

## 如何替换 AppID

当前 `project.config.json` 使用占位 AppID：

```json
"appid": "touristappid"
```

后续在 Windows 微信开发者工具中可以用两种方式替换：

1. 在微信开发者工具导入项目时填写真实 AppID。
2. 手动编辑 `project.config.json`，把 `touristappid` 改成你的真实 AppID。

## 如何修改菜单内容

编辑：

```text
miniprogram/data/menu-data.js
```

示例字段：

```js
shop: {
  name: '我的私房菜单',
  subtitle: '今日限定 · 仅供展示 · 欢迎分享给朋友查看',
  shareTitle: '来看看我的专属菜单',
  shareImage: '../../assets/share.jpg'
}
```

菜品图片路径示例：

```js
image: '../../assets/foods/beef-rice.jpg'
```

这些图片路径是相对菜单页 `miniprogram/pages/menu/` 的路径。请保持目录名、文件名和扩展名大小写完全一致。

## 如何替换图片

把真实图片放到这些相对路径对应的位置：

```text
miniprogram/assets/share.jpg
miniprogram/assets/foods/beef-rice.jpg
miniprogram/assets/foods/tomato-noodle.jpg
miniprogram/assets/foods/chicken-soup.jpg
miniprogram/assets/foods/lemon-tea.jpg
```

也可以在 `miniprogram/data/menu-data.js` 中修改为其他相对路径。建议不要混用大小写，例如不要代码写 `Beef-Rice.jpg` 但文件名是 `beef-rice.jpg`。

## 如何测试分享功能

1. 在 Windows 微信开发者工具中编译项目。
2. 点击页面顶部“分享菜单”按钮，触发页面内分享。
3. 点击右上角菜单中的“转发”，触发右上角分享。
4. 分享配置在 `miniprogram/pages/menu/menu.js`：

```js
onShareAppMessage() {
  return {
    title: this.data.shop.shareTitle,
    path: '/pages/menu/menu',
    imageUrl: this.data.shop.shareImage
  }
}
```

`path: '/pages/menu/menu'` 是微信小程序分享卡片要求的页面路由，不是 Linux 或 Windows 文件系统绝对路径。

## 注意事项

- 本项目只使用原生 WXML、WXSS、JS、JSON。
- 不需要 Node.js、npm、webpack 或其他编译环境。
- 不依赖 Windows 专属路径。
- 页面内“加入”只是模拟效果，刷新后状态会丢失。
- 底部按钮明确显示“仅展示，不可下单”。
- 如果使用网络图片，需要在微信公众平台配置合法下载域名；使用本地图片则不需要。
