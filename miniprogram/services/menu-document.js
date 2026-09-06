const SHOP_IMAGES = ['shareImage', 'pageBackgroundImage', 'headerBackgroundImage']
const PLACEHOLDER = '/assets/placeholder-food.jpg'

function validateDocument(document) {
  if (!document || document.schemaVersion !== 1 || !document.shop || !Array.isArray(document.categories) || !Array.isArray(document.dishes) || !document.assets) throw new Error('菜单数据格式无效')
  const categories = new Set()
  const dishes = new Set()
  for (const category of document.categories) {
    if (!category.id || !category.name || categories.has(category.id)) throw new Error('分类名称或编号无效')
    categories.add(category.id)
  }
  for (const dish of document.dishes) {
    if (!dish.id || !dish.name || dishes.has(dish.id) || !categories.has(dish.categoryId) || dish.price !== '0') throw new Error('菜品名称、分类或价格无效')
    dishes.add(dish.id)
    const optionIds = new Set()
    for (const option of dish.options || []) {
      if (!option.id || !option.name || optionIds.has(option.id)) throw new Error('规格名称或编号无效')
      optionIds.add(option.id)
      if (option.type !== 'text') {
        const ids = (option.choices || []).map((choice) => typeof choice === 'string' ? choice : choice.id)
        if (!ids.length || ids.some((id) => !id) || new Set(ids).size !== ids.length) throw new Error('规格选项无效或重复')
      }
    }
  }
  const refs = SHOP_IMAGES.map((field) => document.shop[field]).concat(document.dishes.map((dish) => dish.imageAssetId)).filter(Boolean)
  for (const id of refs) if (!document.assets[id]) throw new Error('菜单图片引用不存在')
  return document
}

function buildMenu(document, urls = {}) {
  validateDocument(document)
  const shop = Object.assign({}, document.shop)
  SHOP_IMAGES.forEach((field) => { shop[field] = urls[shop[field]] || '' })
  const categories = document.categories.slice().sort((a, b) => a.order - b.order).map((category) => Object.assign({}, category, {
    items: document.dishes.filter((dish) => dish.categoryId === category.id && dish.enabled !== false)
      .sort((a, b) => a.order - b.order).map((dish) => Object.assign({}, dish, { image: urls[dish.imageAssetId] || PLACEHOLDER }))
  }))
  return { shop, categories }
}

function assetIds(document) {
  return Array.from(new Set(SHOP_IMAGES.map((field) => document.shop[field])
    .concat(document.dishes.filter((dish) => dish.enabled !== false).map((dish) => dish.imageAssetId)).filter(Boolean)))
}

module.exports = { buildMenu, assetIds, validateDocument, SHOP_IMAGES }
