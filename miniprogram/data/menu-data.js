import shop from './shop-data.js'
import categories from './category-data.js'
import dishes from './dish-data.js'

function sortByOrder(left, right) {
  return (Number(left.order) || 0) - (Number(right.order) || 0)
}

function buildCategories() {
  return categories.slice()
    .sort(sortByOrder)
    .map((category) => {
      const items = dishes
        .filter((dish) => dish.categoryId === category.id)
        .sort(sortByOrder)

      return Object.assign({}, category, {
        items
      })
    })
}

export default {
  shop,
  categories: buildCategories()
}
