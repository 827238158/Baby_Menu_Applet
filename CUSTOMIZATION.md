# 自定义修改指南

这个项目现在采用“本地表格式数据”的维护方式：不要再直接把所有内容写进一个巨大的 `menu-data.js`。后期日常修改通常只需要改三个数据文件，再把图片放进 `miniprogram/assets/` 对应目录。

## 先看懂这 4 个数据文件

```text
miniprogram/data/shop-data.js      店铺、分享、页面背景、顶部背景
miniprogram/data/category-data.js  分类列表和分类排序
miniprogram/data/dish-data.js      餐品列表、餐品排序、图片、标签、规格
miniprogram/data/menu-data.js      自动聚合入口，通常不要改
```

页面实际读取的是 `menu-data.js`，但它只是自动把 `shop-data.js`、`category-data.js`、`dish-data.js` 合并起来。你后续维护菜单时，优先改前三个文件。

## 1. 修改店铺信息、分享图和背景图

改这里：

```text
miniprogram/data/shop-data.js
```

当前结构：

```js
export default {
  name: '宝宝小厨房',
  subtitle: '小画家宝宝专用菜单',
  shareTitle: '我宝宝最好看！',
  shareImage: '../../assets/share.jpg',
  pageBackgroundImage: '../../assets/backgrounds/page-bg.jpg',
  headerBackgroundImage: '../../assets/backgrounds/header-bg.jpg',
  headerBackgroundPosition: 'center bottom'
}
```

怎么改：

- 页面顶部名称：改 `name`
- 页面顶部副标题：改 `subtitle`
- 微信分享标题：改 `shareTitle`
- 微信分享图片：改 `shareImage`
- 整个小程序页面背景图：改 `pageBackgroundImage`
- 顶部封面区域背景图：改 `headerBackgroundImage`
- 顶部封面裁切位置：改 `headerBackgroundPosition`

如果不想用某张背景图，把对应字段改成空字符串：

```js
pageBackgroundImage: '',
headerBackgroundImage: ''
```

这样页面会回退到默认纯色背景和渐变顶部。

顶部封面图默认会铺满整个顶部区域。如果图片比例和顶部区域比例不一致，图片会被裁切。裁切时保留哪一块由 `headerBackgroundPosition` 控制：

```js
headerBackgroundPosition: 'center bottom'
```

常用值：

- `center center`：保留图片中间，默认裁切效果。
- `center top`：保留图片上部。
- `center bottom`：保留图片下部。
- `center 70%`：保留偏下位置。
- `left bottom`：保留左下。
- `right bottom`：保留右下。

当前顶部图仍使用铺满方式，不会变形，也不会留白。如果你想完全不裁切，需要提前把图片裁成更接近顶部区域的横向比例。

## 2. 修改分类

改这里：

```text
miniprogram/data/category-data.js
```

一条分类长这样：

```js
{
  id: 'drink',
  name: '饮品',
  order: 40
}
```

字段规则：

- `id`：分类编号，给餐品的 `categoryId` 使用；建议用英文、数字或短横线。
- `name`：小程序左侧分类栏显示的文字。
- `order`：分类排序，数字越小越靠前。

新增分类：

1. 复制一条分类对象。
2. 改一个新的 `id`，例如 `snack`。
3. 改显示名称 `name`，例如 `小食`。
4. 设置 `order`，例如 `50`。
5. 在 `dish-data.js` 里给餐品填写 `categoryId: 'snack'`。

删除分类前，先确认 `dish-data.js` 里没有餐品继续使用这个分类的 `id`。

## 3. 修改餐品

改这里：

```text
miniprogram/data/dish-data.js
```

一条餐品长这样：

```js
{
  id: 'drink01',
  categoryId: 'drink',
  order: 10,
  name: '手作柠檬茶',
  desc: '鲜切柠檬搭配清茶，酸甜平衡，适合餐后慢慢喝。',
  price: '0',
  image: '../../assets/foods/lemon-tea.jpg',
  tags: ['推荐'],
  options: []
}
```

字段规则：

- `id`：餐品编号，所有餐品里必须唯一。
- `categoryId`：餐品所属分类，对应 `category-data.js` 的分类 `id`。
- `order`：餐品在当前分类里的排序，数字越小越靠前。
- `name`：餐品名称。
- `desc`：餐品描述。
- `price`：展示价格。当前演示项目统一建议写成字符串 `'0'`，不要维护真实售价，除非后续明确要做真实价格展示。
- `image`：餐品图片路径。
- `tags`：餐品标签，例如 `['推荐', '限量']`。
- `options`：规格选项；没有规格就写 `[]`。

新增餐品：

1. 在 `dish-data.js` 里复制一条餐品对象。
2. 改 `id`，不能和已有餐品重复。
3. 填 `categoryId`，决定它出现在哪个分类下。
4. 填 `order`，决定它在该分类里的位置。
5. 修改名称、描述、价格、标签。
6. 准备图片，并把图片路径写进 `image`。
7. 有口味、冷热、甜度等选择时，填写 `options`。

移动餐品到其他分类时，只改 `categoryId`。调整餐品顺序时，只改 `order`。

## 4. 添加口味、冷热、甜度等规格

规格写在餐品的 `options` 字段里。

示例：

```js
options: [
  {
    id: 'temperature',
    name: '冷热',
    required: true,
    choices: ['热饮', '常温', '少冰']
  },
  {
    id: 'sweetness',
    name: '甜度',
    required: true,
    choices: ['无糖', '三分糖', '五分糖', '正常糖']
  }
]
```

字段规则：

- `id`：规格编号，同一个餐品里不要重复。
- `name`：页面上显示的规格名称。
- `required`：是否必选。`true` 表示加入前必须选择。
- `choices`：可选项列表。

当前交互：

- 商品卡片入口统一是圆形 `+`。
- 有规格的餐品，点击 `+` 会从底部打开规格选择面板。
- 规格面板会默认选中每组规格的第一项，并实时显示“已选规格”。
- 用户可以在规格面板里切换规格标签，再点击“加入购物车”。
- 无规格的餐品，点击 `+` 会直接加入购物车。
- 同一餐品的不同规格组合会分开计数；同一餐品同一规格组合会合并数量。
- 购物车面板里通过 `+` / `-` 调整数量，数量减到 `0` 会自动移除该项；当前不显示删除或清空按钮。
- 当前规格不影响价格，合计仍按餐品基础价格计算。

如果餐品没有规格，保持：

```js
options: []
```

## 5. 图片到底怎么替换

图片替换分两步：先放图片文件，再改数据里的路径。

### 第一步：把图片放到对应目录

推荐目录：

```text
miniprogram/assets/share.jpg                 分享图
miniprogram/assets/backgrounds/page-bg.jpg   页面整体背景图
miniprogram/assets/backgrounds/header-bg.jpg 顶部封面背景图
miniprogram/assets/foods/xxx.jpg             餐品图
```

你可以同名覆盖现有图片，也可以新增自己的图片文件，例如：

```text
miniprogram/assets/foods/milk-tea.jpg
miniprogram/assets/backgrounds/my-page-bg.jpg
```

### 第二步：在数据文件里填写路径

分享图、页面背景图、顶部背景图改：

```text
miniprogram/data/shop-data.js
```

```js
shareImage: '../../assets/share.jpg',
pageBackgroundImage: '../../assets/backgrounds/page-bg.jpg',
headerBackgroundImage: '../../assets/backgrounds/header-bg.jpg',
headerBackgroundPosition: 'center bottom'
```

餐品图改：

```text
miniprogram/data/dish-data.js
```

```js
image: '../../assets/foods/milk-tea.jpg'
```

### 路径为什么要写 `../../assets/...`

图片路径是相对菜单页文件夹：

```text
miniprogram/pages/menu/
```

所以从菜单页走到 `assets` 目录，需要写：

```text
../../assets/...
```

不要写 Windows 绝对路径，例如不要写：

```text
G:\BackUp\...\milk-tea.jpg
```

### 图片建议尺寸

- 页面背景图：竖图，建议接近 `900 x 1600`
- 顶部背景图：横图，建议接近 `1000 x 520`
- 分享图：横图，建议接近 `1000 x 800`
- 餐品图：横图或方图，建议接近 `640 x 480`

### 图片容错

- 餐品图片路径写错时，页面会显示 `../../assets/placeholder-food.jpg`。
- 背景图路径为空时，会回退到默认背景。
- 背景图路径写错时，页面仍有默认底色和遮罩，但控制台可能会提示图片加载失败。

## 6. 常见修改场景

### 我要新增一个饮品

1. 把饮品图片放到 `miniprogram/assets/foods/`。
2. 打开 `miniprogram/data/dish-data.js`。
3. 复制一条餐品对象。
4. 设置 `categoryId: 'drink'`。
5. 设置新的 `id` 和 `order`。
6. 修改 `name`、`desc`、`price`、`image`、`tags`、`options`。
7. 如果只是演示菜单，`price` 建议继续写 `'0'`。

### 我要新增一个分类

1. 打开 `miniprogram/data/category-data.js`。
2. 新增一条分类，例如 `id: 'snack'`。
3. 打开 `miniprogram/data/dish-data.js`。
4. 给餐品填写 `categoryId: 'snack'`。

### 我要让饮品可以选冷热和甜度

在对应饮品的餐品对象里填写：

```js
options: [
  {
    id: 'temperature',
    name: '冷热',
    required: true,
    choices: ['热饮', '常温', '少冰']
  },
  {
    id: 'sweetness',
    name: '甜度',
    required: true,
    choices: ['无糖', '三分糖', '五分糖', '正常糖']
  }
]
```

### 我要换小程序整体背景

1. 把新背景图放到 `miniprogram/assets/backgrounds/`。
2. 打开 `miniprogram/data/shop-data.js`。
3. 修改：

```js
pageBackgroundImage: '../../assets/backgrounds/你的图片名.jpg'
```

### 我要换顶部封面背景

1. 把新顶部图放到 `miniprogram/assets/backgrounds/`。
2. 打开 `miniprogram/data/shop-data.js`。
3. 修改图片路径：

```js
headerBackgroundImage: '../../assets/backgrounds/你的图片名.jpg'
```

4. 如果主体在图片下部，继续修改裁切位置：

```js
headerBackgroundPosition: 'center bottom'
```

如果主体在图片上部，改成：

```js
headerBackgroundPosition: 'center top'
```

如果想保留偏下但不是最底部，可以写：

```js
headerBackgroundPosition: 'center 70%'
```

## 7. 其他可改位置

页面导航栏标题：

```text
miniprogram/app.json
```

```json
"navigationBarTitleText": "点餐菜单"
```

页面颜色和按钮颜色：

```text
miniprogram/pages/menu/menu.wxss
```

小程序 AppID：

```text
project.config.json
```

正式发布前，把测试值 `touristappid` 替换成真实微信小程序 AppID。

## 8. 修改后检查

每次修改后建议在微信开发者工具里检查：

- 分类顺序是否符合 `category-data.js` 的 `order`。
- 餐品是否出现在正确分类下。
- 餐品顺序是否符合 `dish-data.js` 的 `order`。
- 图片是否正常显示。
- 有规格餐品点击圆形 `+` 是否从底部弹出规格选择。
- 规格选择是否默认选中每组第一项，已选规格是否实时显示。
- 无规格餐品点击圆形 `+` 是否直接加入，加入后是否显示数量加减器。
- 不同规格组合是否分开计数。
- 菜名、价格、标签、描述是否没有超出屏幕。
