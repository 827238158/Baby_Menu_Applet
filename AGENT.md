# Agent 开发指南

这个文件是给后续 AI Agent 或开发者继续维护本项目时使用的项目级工作指南。它不是普通用户说明书，而是为了统一开发边界、数据维护方式、UI 规则和验证流程。

## 项目定位

这是一个微信原生小程序菜单展示项目，目前定位是“可发布展示版 / 可预览展示版”，不是完整真实点单系统。

当前边界：

- 不接后端。
- 不接数据库。
- 不做登录。
- 不做支付。
- 不生成真实订单。
- 购物车、数量、合计都只是本地前端状态。
- 用户最终操作是复制已选菜单文本，方便粘贴发送。

除非用户明确要求接入真实下单、云开发或后端服务，否则不要突破这些边界。

## 技术栈

- 微信原生小程序。
- WXML、WXSS、JavaScript、JSON。
- 没有 npm 流程。
- 没有 Taro、uni-app、Vue、React、webpack 或构建步骤。
- 使用微信开发者工具导入仓库根目录进行预览。

主入口页面是：

```text
miniprogram/pages/menu/menu
```

## 关键文件

```text
project.config.json
miniprogram/app.json
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

## 数据维护方式

日常维护菜单内容时，优先修改这几个文件：

- `miniprogram/data/shop-data.js`：店铺名、副标题、分享标题、分享图、页面背景图、顶部背景图。
- `miniprogram/data/category-data.js`：分类列表和分类排序。
- `miniprogram/data/dish-data.js`：餐品、价格、图片、标签、描述、规格选项。所有商品价格统一预设为字符串 `'0'`。
- `miniprogram/data/menu-data.js`：聚合入口。通常不要改，除非要调整数据合并和排序逻辑。

菜单页应该继续只从 `menu-data.js` 读取内容。`menu-data.js` 负责按 `order` 排序分类和餐品，并根据餐品的 `categoryId` 自动归入对应分类。

## 数据结构

分类示例：

```js
{
  id: 'drink',
  name: '饮品',
  order: 40
}
```

餐品示例：

```js
{
  id: 'drink01',
  categoryId: 'drink',
  order: 10,
  name: '手作柠檬茶',
  desc: '鲜切柠檬搭配清茶，酸甜平衡。',
  price: '0',
  image: '../../assets/foods/lemon-tea.jpg',
  tags: ['推荐'],
  options: []
}
```

规格示例：

```js
{
  id: 'temperature',
  name: '冷热',
  required: true,
  choices: ['热饮', '常温', '少冰']
}
```

店铺配置示例：

```js
{
  name: '宝宝小厨房',
  subtitle: '小画家宝宝专用菜单',
  shareTitle: '我宝宝最好看！',
  shareImage: '../../assets/share.jpg',
  pageBackgroundImage: '../../assets/backgrounds/page-bg.jpg',
  headerBackgroundImage: '../../assets/backgrounds/header-bg.jpg',
  headerBackgroundPosition: 'center bottom'
}
```

## 图片规则

默认使用本地图片资源，除非用户明确要求改成网络图片。

推荐图片位置：

```text
miniprogram/assets/share.jpg
miniprogram/assets/backgrounds/page-bg.jpg
miniprogram/assets/backgrounds/header-bg.jpg
miniprogram/assets/foods/
miniprogram/assets/placeholder-food.jpg
```

餐品和店铺配置里的图片路径是相对菜单页运行路径的，所以通常写成：

```text
../../assets/...
```

不要在小程序数据里使用 Windows 绝对路径，例如：

```text
G:\BackUp\...\milk-tea.jpg
```

顶部背景图继续使用铺满方式：

```css
background-size: cover;
```

如果图片比例和顶部区域比例不一致，允许裁切。裁切时保留哪一块由 `headerBackgroundPosition` 控制，例如：

```js
headerBackgroundPosition: 'center bottom'
```

常用值：

- `center center`：保留图片中间。
- `center top`：保留图片上部。
- `center bottom`：保留图片下部。
- `center 70%`：保留偏下位置。
- `left bottom`：保留左下。
- `right bottom`：保留右下。

## UI 规则

目标风格是美观、简洁、商用级、适配手机端，接近主流外卖 / 点单页面。

保持这些原则：

- 商品列表使用卡片式布局。
- 商品图片固定尺寸、圆角、比例统一，使用 `aspectFill`，不能拉伸变形。
- 商品图片在卡片内应垂直居中，不要贴在卡片顶部。
- 商品名称、价格、标签、描述、规格提示、购物车控件不能重叠。
- 商品卡片加购入口统一使用圆形 `+`，不要对有规格和无规格餐品使用割裂的入口样式。
- 规格弹窗使用底部弹出面板，顶部圆角、半透明遮罩、拖拽条关闭，保持现代奶茶店风格。
- 规格选项使用紧凑标签式圆角按钮，能自动换行，不能撑出屏幕。
- 底部购物车栏在未选商品和已选商品后都要保持稳定，不要变成竖向堆叠。
- 除非用户明确要求，不要在页面里添加显式分享按钮。
- 商品卡片上不要重新加“详情”按钮，除非用户明确要求。

当前商品卡片预期行为：

- 无规格餐品：点击 `+` 直接加入购物车，加入后显示数量加减器。
- 有规格餐品：点击圆形 `+` 打开底部规格面板，默认选中每组规格的第一项，用户可修改后加入购物车。
- 规格面板实时显示已选规格；如果后续出现未默认选中的必选项，必须选完后才能加入购物车。
- 同一餐品的不同规格组合要作为不同购物车项。

## 价格规则

当前项目不做真实交易，价格只用于展示和模拟合计。

统一规则：

- 所有现有商品的 `price` 都应写成字符串 `'0'`。
- 后续新增商品时，`price` 也必须默认写成字符串 `'0'`。
- 不要填写真实售价，除非用户明确要求开始维护真实价格。
- 规格选项暂时不影响价格，不要增加规格加价逻辑。

## 购物车行为

购物车是 `menu.js` 中的本地前端状态。

预期功能：

- 底部悬浮购物车栏显示商品总数和模拟合计。
- 点击购物车区域，有已选商品时展开购物车面板。
- 购物车面板展示已选商品、规格摘要、数量和小计。
- 购物车面板只保留增加数量和减少数量，不显示删除单项或清空全部入口。
- 数量减到 `0` 时自动移除该项。
- 复制按钮调用 `wx.setClipboardData`。
- 复制文本末尾必须说明“仅展示，不代表真实下单”。

不要新增订单状态、订单编号、支付状态、提交订单接口，除非用户明确要求。

## 分享规则

保留 `miniprogram/pages/menu/menu.js` 里的 `onShareAppMessage()`。

它用于配置微信右上角菜单的原生转发内容。当前页面不需要显示自定义分享按钮，除非用户明确要求。

固定分享路径：

```text
/pages/menu/menu
```

分享标题和分享图片来自 `shop-data.js`。

要让其他微信用户真正打开分享内容，需要真实微信小程序 AppID，并发布正式版，或给对方配置体验版 / 开发版权限。`touristappid` 只能用于开发预览。

## AppID 规则

`project.config.json` 当前使用：

```json
"appid": "touristappid"
```

不要主动替换这个值。只有用户提供真实 AppID，或明确要求替换时，才修改它。

## 开发流程

修改前：

- 先阅读相关文件，跟随现有结构。
- 改动范围尽量贴近用户请求。
- 不要回滚无关的工作区改动。
- 不要删除微信开发者工具生成的私有配置文件，除非用户明确要求。

文本和代码修改优先使用补丁式编辑。

常用检查命令：

```powershell
node --check miniprogram\pages\menu\menu.js
node --input-type=module -e "import('./miniprogram/data/menu-data.js').then(({default:data})=>{console.log(data.categories.map(c=>c.id+':' + c.items.length).join(','));})"
git diff --check -- miniprogram\pages\menu\menu.js miniprogram\pages\menu\menu.wxml miniprogram\pages\menu\menu.wxss
```

仍然需要在微信开发者工具里手动验证：

- 分类切换。
- 小屏手机下商品列表布局。
- 规格弹窗是否可以滚动。
- 规格弹窗是否从底部弹出，默认选中每组第一项，已选规格是否实时显示。
- 加入购物车。
- 增加数量、减少数量、数量减到 `0` 自动移除。
- 复制已选菜单。
- 微信右上角转发。
- 图片加载失败时的占位图表现。

## 编码注意事项

项目里包含中文文本。PowerShell 终端可能因为编码问题把中文显示成乱码。不要仅凭终端输出乱码就判断文件已经损坏。

检查 JS 语法时，优先让 Node 直接读取文件路径：

```powershell
node --check miniprogram\pages\menu\menu.js
```

避免用管道把文件内容传给 Node，例如 `Get-Content | node`，因为终端编码可能会改变中文字符。

## 文档维护

当自定义逻辑、数据结构、图片替换方式或发布方式发生变化时，同步更新：

```text
CUSTOMIZATION.md
README.md
```

`CUSTOMIZATION.md` 应该面向使用者，说明如何修改餐品、分类、规格、图片、背景图、分享标题和 AppID。

## 不要做的事

- 不要在没有明确要求时添加后端请求。
- 不要在没有明确要求时添加支付或真实下单。
- 不要在没有明确要求时引入 npm 或构建工具。
- 不要在没有明确要求时替换 `touristappid`。
- 不要随意修改微信开发者工具生成的私有配置文件。
- 不要把本地绝对路径写进小程序图片配置。
- 不要让小屏手机上的文字、按钮、价格、标签互相重叠。
