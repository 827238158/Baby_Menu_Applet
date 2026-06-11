# 自定义菜单维护指南

纯本地演示项目，无后端实现。这个项目用 Excel 维护菜单，再用脚本生成小程序数据。日常不要直接手改 `miniprogram/data/*.js`。

## 日常流程

1. 打开并修改：

```text
tools/menu-workbook/menu-data.xlsx
```

2. 保存 Excel。
3. 在项目根目录运行：

```powershell
node tools\generate-menu-data.js
```

4. 回到微信开发者工具，重新编译预览。

脚本会生成：

- `miniprogram/data/shop-data.js`
- `miniprogram/data/category-data.js`
- `miniprogram/data/dish-data.js`

## 工作簿怎么改

当前工作簿主要有三张维护表：

- `Shop`：店铺名称、分享标题、分享图、页面背景图、顶部背景图。
- `Categories`：分类 ID、分类名称、排序。
- `Dishes`：商品主表，包含分类、描述、价格、图片、标签和规格。

## 商品字段

在 `Dishes` 里常用这些字段：

- `dishId`：商品稳定 ID，必须唯一。
- `dishName`：商品名称。
- `categoryId`：所属分类，填写 `Categories.categoryId` 中已有的值。
- `order`：商品在分类内的排序，数字越小越靠前。
- `desc`：商品描述。
- `price`：当前演示项目建议继续填 `0`。
- `imageFile`：商品图片文件名，例如 `mango.jpg`。
- `tags`：商品标签。
- `options`：商品规格。

商品图片放到：

```text
miniprogram/assets/foods/
```

`imageFile` 只填文件名，不要填 Windows 绝对路径。留空会使用占位图。

## 标签写法

标签直接写在 `Dishes.tags`，用顿号、逗号、分号或换行分隔。

示例：

```text
招牌、推荐、清爽
```

## 规格写法

规格直接写在 `Dishes.options`，一行一个规格组。

示例：

```text
规格: 中杯、大杯
糖度: 七分糖、五分糖、三分糖
小料(可选): 珍珠、椰果
```

规则：

- 冒号左边是规格组名称。
- 冒号右边是选项，用顿号、逗号、分号或 `|` 分隔。
- 默认都是必选规格。
- 规格组名称后写 `(可选)`、`（可选）`、`[可选]`、`【可选】` 或 `(optional)`，生成后会变成非必选。

## 常见操作

新增无规格商品：

1. 在 `Dishes` 新增一行。
2. 填 `dishId`、`dishName`、`categoryId`、`order`、`desc`。
3. 有图片就把图片放进 `miniprogram/assets/foods/`，并填写 `imageFile`。
4. 有标签就填写 `tags`。
5. 保存 Excel，运行 `node tools\generate-menu-data.js`。

新增有规格商品：

1. 在 `Dishes` 新增商品行。
2. 在 `options` 里按“一行一个规格组”填写规格。
3. 保存 Excel，运行生成脚本。

下架商品：

- 从 `Dishes` 删除对应商品行，再运行生成脚本。

调整顺序：

- 分类顺序改 `Categories.order`。
- 商品顺序改 `Dishes.order`。

## 检查

生成后建议运行：

```powershell
node --check miniprogram\pages\menu\menu.js
node --check miniprogram\data\shop-data.js
node --check miniprogram\data\category-data.js
node --check miniprogram\data\dish-data.js
node --check miniprogram\data\menu-data.js
```

在微信开发者工具里确认：

- 分类顺序正确。
- 商品出现在正确分类下。
- 图片正常显示。
- 有规格商品能打开规格面板。
- 购物车数量加减和复制已选菜单正常。
