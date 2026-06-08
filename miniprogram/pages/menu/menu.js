import menuData from '../../data/menu-data'

Page({
  data: {
    shop: menuData.shop,
    categories: menuData.categories,
    activeCategoryId: '',
    activeItems: [],
    selectedItems: [],
    selectedCount: 0,
    selectedTotal: '0',
    detailVisible: false,
    currentItem: null
  },

  onLoad() {
    const firstCategory = menuData.categories[0] || { id: '', items: [] }

    this.setData({
      activeCategoryId: firstCategory.id,
      activeItems: firstCategory.items || []
    })
  },

  onShareAppMessage() {
    return {
      title: this.data.shop.shareTitle,
      path: '/pages/menu/menu',
      imageUrl: this.data.shop.shareImage
    }
  },

  switchCategory(event) {
    const categoryId = event.currentTarget.dataset.id
    const category = this.data.categories.find((item) => item.id === categoryId)

    if (!category) {
      return
    }

    this.setData({
      activeCategoryId: categoryId,
      activeItems: category.items || []
    })
  },

  showDetail(event) {
    const item = this.findDish(event.currentTarget.dataset.id)

    if (!item) {
      return
    }

    this.setData({
      currentItem: item,
      detailVisible: true
    })
  },

  hideDetail() {
    this.setData({
      detailVisible: false,
      currentItem: null
    })
  },

  addDish(event) {
    const item = this.findDish(event.currentTarget.dataset.id)

    if (!item) {
      return
    }

    const selectedItems = this.data.selectedItems.concat(item)
    this.updateSelected(selectedItems)

    wx.showToast({
      title: '已加入展示菜单',
      icon: 'none'
    })
  },

  clearSelected() {
    this.updateSelected([])
  },

  stopTap() {},

  findDish(id) {
    for (let i = 0; i < this.data.categories.length; i += 1) {
      const dish = (this.data.categories[i].items || []).find((item) => item.id === id)

      if (dish) {
        return dish
      }
    }

    return null
  },

  updateSelected(selectedItems) {
    const total = selectedItems.reduce((sum, item) => {
      const price = Number(item.price)
      return Number.isNaN(price) ? sum : sum + price
    }, 0)

    this.setData({
      selectedItems,
      selectedCount: selectedItems.length,
      selectedTotal: String(total)
    })
  }
})
