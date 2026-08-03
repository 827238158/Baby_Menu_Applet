# 微信小程序展示点餐页

这是一个微信原生小程序项目，用于展示一份可分享的家庭私房菜单。菜单仍是本地展示功能，不包含支付或真实下单；礼品夹可选接入 SCF + 私有 COS，实现两名授权用户共享礼品。

## 当前状态

- 入口页面：`miniprogram/pages/menu/menu`
- 聚合入口：`miniprogram/data/menu-data.js`
- 店铺配置：`miniprogram/data/shop-data.js`
- 分类配置：`miniprogram/data/category-data.js`
- 餐品配置：`miniprogram/data/dish-data.js`
- 项目配置：`project.config.json`
- 小程序 AppID：已在 `project.config.json` 配置
- 图片资源：仓库已内置分享图、菜品图、背景图和通用占位图
- 礼品夹后端：`serverless/gift-api`
- 礼品夹云端状态：SCF 已部署原图接口；列表加载缩略图，全屏预览按需加载原图，真机功能正常

## 目录结构

```text
.
├── README.md
├── CUSTOMIZATION.md
├── project.config.json
├── serverless
│   └── gift-api
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
    ├── config
    │   └── gift-cloud.js
    ├── services
    │   └── gift-api.js
    ├── pages
    │   ├── gifts
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

现在主要编辑 Excel 源数据文件：

- `tools/menu-workbook/menu-data.xlsx`：店铺、分类、商品、标签和规格的日常维护入口

修改后运行：

```powershell
node tools\generate-menu-data.js
```

脚本会生成：

- `miniprogram/data/shop-data.js`
- `miniprogram/data/category-data.js`
- `miniprogram/data/dish-data.js`

`miniprogram/data/menu-data.js` 是自动聚合入口，一般不需要手动修改。

更完整的自定义替换说明见 `CUSTOMIZATION.md`。

## 如何用微信开发者工具预览

1. 打开微信开发者工具。
2. 选择“导入项目”。
3. 项目目录选择仓库根目录，也就是包含 `project.config.json` 的目录。
4. 使用 `project.config.json` 中已经配置的小程序 AppID。
5. 编译后会进入 `pages/menu/menu`。

## 配置共享礼品夹

礼品夹云端功能需要先部署 SCF 和私有 COS，完整步骤见：

```text
serverless/gift-api/README.md
```

部署完成后，把 SCF 函数 URL 填入 `miniprogram/config/gift-cloud.js`。该 URL 不是密钥；OpenID、AppSecret、会话密钥和腾讯云临时凭证都只存在于 SCF 环境中。

## 测试清单

- 分类按 `category-data.js` 的 `order` 排序。
- 餐品按 `dish-data.js` 的 `categoryId` 和 `order` 归类展示。
- 分类切换正常，左侧分类数量显示正确。
- 点击餐品图片或文字区可以打开详情弹层，点击遮罩可以关闭。
- 有规格餐品点击圆形 `+` 会先打开规格选择，未选必选项不能加入。
- 无规格餐品点击圆形 `+` 会直接加入。
- 同一餐品不同规格组合会分开显示和计数。
- 底部已选数量、菜品摘要和模拟合计正确。
- 右上角转发和分享到朋友圈使用预设的标题、页面路径和分享图；页面不额外放显式分享按钮。
- 替换或故意写错菜品图片路径时，页面会显示通用占位图，不影响布局。
- 礼品夹先完成白名单授权并显示加载骨架；授权成功后再读取云端列表，本地缓存只用于授权后的展示地址复用和网络失败兜底。
- 未授权微信账号不能查询、新增、编辑或删除礼品。
- 仅文字、仅图片和图片加文字礼品均可保存。
- 礼品列表加载缩略图，点击图片进入全屏预览后可以正常加载原图。
- 礼品列表超过 20 条时触底续载不重复、不跳项，两人并发增删改后总数一致。

## 技术说明

- 只使用微信原生 WXML、WXSS、JS、JSON。
- 小程序本身不需要 npm、webpack、Taro、uni-app 或其他编译依赖。
- `serverless/gift-api` 是独立 Node.js 18 项目，仅在打包 SCF 时安装依赖。
- 菜单数据生成脚本需要本地 Node.js 调用 Python，并由 Python `openpyxl` 读取 Excel。
- 菜单和购物车仍是本地状态；礼品夹以私有 COS 为云端数据源。
