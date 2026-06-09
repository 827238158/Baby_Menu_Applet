# 微信小程序展示点餐页

这是一个微信原生小程序项目，用于展示一份可分享的家庭私房菜单。项目当前定位是“可发布展示版”：不包含后端、数据库、登录、支付或真实下单能力，页面里的“加入”和合计只是前端展示效果。

## 当前状态

- 入口页面：`miniprogram/pages/menu/menu`
- 聚合入口：`miniprogram/data/menu-data.js`
- 店铺配置：`miniprogram/data/shop-data.js`
- 分类配置：`miniprogram/data/category-data.js`
- 餐品配置：`miniprogram/data/dish-data.js`
- 项目配置：`project.config.json`
- 小程序 AppID：当前仍使用测试占位值 `touristappid`
- 图片资源：仓库已内置分享图、菜品图、背景图和通用占位图

## 目录结构

```text
.
├── README.md
├── CUSTOMIZATION.md
├── project.config.json
└── miniprogram
    ├── app.js
    ├── app.json
    ├── app.wxss
    ├── sitemap.json
    ├── data
    │   ├── shop-data.js
    │   ├── category-data.js
    │   ├── dish-data.js
    │   └── menu-data.js
    ├── pages
    │   └── menu
    │       ├── menu.js
    │       ├── menu.json
    │       ├── menu.wxml
    │       └── menu.wxss
    └── assets
        ├── README.md
        ├── placeholder-food.jpg
        ├── share.jpg
        ├── backgrounds
        │   ├── page-bg.jpg
        │   └── header-bg.jpg
        └── foods
            ├── beef-rice.jpg
            ├── tomato-noodle.jpg
            ├── chicken-soup.jpg
            └── lemon-tea.jpg
```

## 如何继续改菜单

现在主要编辑这些本地表格式数据文件：

- `miniprogram/data/shop-data.js`：店铺名、分享标题、分享图、页面背景图、顶部背景图
- `miniprogram/data/category-data.js`：分类名称和排序
- `miniprogram/data/dish-data.js`：餐品、价格、标签、图片和规格选项
- `miniprogram/data/menu-data.js`：自动聚合入口，一般不需要手动修改

更完整的自定义替换说明见 `CUSTOMIZATION.md`。

## 如何用微信开发者工具预览

1. 打开微信开发者工具。
2. 选择“导入项目”。
3. 项目目录选择仓库根目录，也就是包含 `project.config.json` 的目录。
4. AppID 暂时没有时，可以继续使用当前配置里的 `touristappid` 做开发预览。
5. 编译后会进入 `pages/menu/menu`。

## 发布前需要处理

当前 `project.config.json` 仍然是：

```json
"appid": "touristappid"
```

正式发布前需要把它替换为真实微信小程序 AppID。替换方式：

1. 在微信开发者工具导入项目时填写真实 AppID。
2. 或手动编辑 `project.config.json`，把 `touristappid` 改成真实 AppID。

如果后续改用网络图片，需要在微信公众平台配置合法下载域名；继续使用本地图片则不需要。

## 测试清单

- 分类按 `category-data.js` 的 `order` 排序。
- 餐品按 `dish-data.js` 的 `categoryId` 和 `order` 归类展示。
- 分类切换正常，左侧分类数量显示正确。
- 点击“详情”可以打开弹窗，点击遮罩或“关闭”可以关闭。
- 有规格餐品点击“加入”会先打开规格选择，未选必选项不能加入。
- 无规格餐品点击“加入”会直接加入。
- 同一餐品不同规格组合会分开显示和计数。
- 底部已选数量、菜品摘要和模拟合计正确。
- 分享按钮和右上角转发返回同一个分享标题、页面路径和分享图。
- 替换或故意写错菜品图片路径时，页面会显示通用占位图，不影响布局。

## 技术说明

- 只使用微信原生 WXML、WXSS、JS、JSON。
- 不需要 Node.js、npm、webpack、Taro、uni-app 或其他编译依赖。
- 目前所有交互状态只存在页面内，刷新后会重置。
