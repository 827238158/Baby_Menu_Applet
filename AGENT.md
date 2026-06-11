# Agent 开发指南

本项目是微信原生小程序菜单展示页，定位是“可发布展示版 / 可预览展示版”，不是完整点单系统。

## 项目边界

- 不接后端、数据库、登录、支付或真实订单。
- 购物车、数量和合计都是本地前端状态。
- 用户最终操作是复制已选菜单文本。
- 除非用户明确要求，不要新增真实下单、云开发、后端接口、支付流程或 npm 构建流程。
- `project.config.json` 里的 `touristappid` 不要主动替换。

## 技术栈

- 微信原生小程序：WXML、WXSS、JavaScript、JSON。
- 主入口页面：`miniprogram/pages/menu/menu`。
- 页面数据入口：`miniprogram/data/menu-data.js`。
- 使用微信开发者工具导入仓库根目录预览。

## 关键文件

```text
tools/menu-workbook/menu-data.xlsx
tools/generate-menu-data.js
tools/generate-menu-data.py
miniprogram/data/shop-data.js
miniprogram/data/category-data.js
miniprogram/data/dish-data.js
miniprogram/data/menu-data.js
miniprogram/pages/menu/menu.js
miniprogram/pages/menu/menu.wxml
miniprogram/pages/menu/menu.wxss
miniprogram/assets/
CUSTOMIZATION.md
README.md
```

## 菜单数据维护

日常不需要手改 `tools/menu-workbook/menu-data.xlsx`，不要手改生成后的 `miniprogram/data/*.js`，除非用户明确需求。

工作簿当前只保留这些 Sheet：

- `Shop`：店铺名、分享标题、分享图、页面背景图、顶部背景图。
- `Categories`：分类 ID、分类名称、排序。
- `Dishes`：商品主表，包含商品、分类、描述、价格、图片、标签、规格。

`Dishes.tags` 用自然文本维护，例如：

```text
招牌、推荐
```

`Dishes.options` 一行一个规格组，例如：

```text
糖度: 七分糖、五分糖
小料(可选): 珍珠、椰果
```

修改 Excel 后运行：

```powershell
node tools\generate-menu-data.js
```

`generate-menu-data.js` 是日常入口，负责寻找可用 Python；`generate-menu-data.py` 负责读取 Excel 并生成：

- `miniprogram/data/shop-data.js`
- `miniprogram/data/category-data.js`
- `miniprogram/data/dish-data.js`

`menu-data.js` 只做聚合和排序，通常不要改。

## 图片与价格

- 商品图片放在 `miniprogram/assets/foods/`。
- `Dishes.imageFile` 只填文件名，例如 `mango.jpg`；留空会使用占位图。
- 不要把 Windows 绝对路径写进图片配置。
- 当前项目不做真实交易，现有商品 `price` 统一保持字符串 `'0'`。
- 规格选项暂时不影响价格，不要增加规格加价逻辑，除非用户明确要求。

## UI 与交互原则

- 商品列表保持手机端卡片布局，图片固定尺寸并使用 `aspectFill`。
- 商品名称、价格、标签、描述、规格提示和购物车控件不能重叠。
- 商品卡片加购入口统一使用圆形 `+`。
- 有规格商品点击 `+` 打开底部规格面板，默认选中每组第一项。
- 无规格商品点击 `+` 直接加入购物车。
- 同一商品不同规格组合作为不同购物车项。
- 不要新增显式分享按钮、订单状态、订单编号、支付状态或提交订单接口，除非用户明确要求。

## 常用检查

```powershell
node tools\generate-menu-data.js
node --check miniprogram\pages\menu\menu.js
node --check miniprogram\data\shop-data.js
node --check miniprogram\data\category-data.js
node --check miniprogram\data\dish-data.js
node --check miniprogram\data\menu-data.js
node --input-type=module -e "import('./miniprogram/data/menu-data.js').then(({default:data})=>{const dishes=data.categories.flatMap(c=>c.items); console.log(data.categories.length,dishes.length,dishes.reduce((n,d)=>n+(d.tags||[]).length,0),dishes.reduce((n,d)=>n+(d.options||[]).length,0));})"
git diff --check
```

仍需在微信开发者工具里手动确认分类切换、商品展示、图片加载、规格弹窗、购物车数量加减、复制已选菜单和右上角转发。

## 编码注意

项目包含中文。PowerShell 终端偶尔会把中文显示成乱码，不要仅凭终端显示判断文件损坏。检查 JS 语法时优先让 Node 直接读取文件路径，避免用管道传中文文件内容。
