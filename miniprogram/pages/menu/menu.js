import menuData from '../../data/menu-data.js'

const FALLBACK_IMAGE = '../../assets/placeholder-food.jpg'
const SHARE_PATH = '/pages/menu/menu'

function normalizeChoice(choice) {
  if (typeof choice === 'string') {
    return {
      id: choice,
      name: choice,
      selected: false
    }
  }

  return {
    id: choice.id || choice.name,
    name: choice.name || choice.id,
    selected: false
  }
}

function normalizeOptions(options) {
  return (options || []).map((option) => Object.assign({}, option, {
    required: option.required !== false,
    choices: (option.choices || []).map(normalizeChoice)
  }))
}

function normalizeCategories(categories) {
  return (categories || []).map((category) => {
    const items = (category.items || []).map((item) => Object.assign({}, item, {
      image: item.image || FALLBACK_IMAGE,
      tags: item.tags || [],
      options: normalizeOptions(item.options)
    }))

    return Object.assign({}, category, {
      count: items.length,
      items
    })
  })
}

function getDishCount(categories) {
  return categories.reduce((sum, category) => sum + (category.items || []).length, 0)
}

function getPageStyle(shop) {
  if (!shop.pageBackgroundImage) {
    return ''
  }

  return [
    'background-image: linear-gradient(rgba(250, 250, 248, 0.92), rgba(247, 247, 245, 0.97)), url("' + shop.pageBackgroundImage + '")',
    'background-size: cover',
    'background-position: center top'
  ].join(';')
}

function getHeaderStyle(shop) {
  if (!shop.headerBackgroundImage) {
    return ''
  }

  const position = shop.headerBackgroundPosition || 'center center'

  return [
    'background-image: linear-gradient(135deg, rgba(0, 0, 0, 0.18) 0%, rgba(0, 0, 0, 0.06) 100%), url("' + shop.headerBackgroundImage + '")',
    'background-size: cover',
    'background-position: ' + position
  ].join(';')
}

const normalizedCategories = normalizeCategories(menuData.categories)

Page({
  data: {
    shop: menuData.shop,
    pageStyle: getPageStyle(menuData.shop),
    headerStyle: getHeaderStyle(menuData.shop),
    categories: normalizedCategories,
    dishCount: getDishCount(normalizedCategories),
    activeCategoryId: '',
    activeItems: [],
    selectedItems: [],
    selectedCount: 0,
    selectedTotal: '0',
    selectedSummaryText: '还未选择菜品',
    cartVisible: false,
    detailVisible: false,
    currentItem: null,
    optionSelections: {},
    optionNotice: '',
    optionSummaryText: '请选择规格',
    optionReady: false,
    detailSheetStyle: '',
    detailDragStartY: 0
  },

  onLoad() {
    const firstCategory = this.data.categories[0] || { id: '', items: [] }

    this.setData({
      activeCategoryId: firstCategory.id,
      activeItems: firstCategory.items || []
    })
  },

  onShareAppMessage() {
    return {
      title: this.data.shop.shareTitle,
      path: SHARE_PATH,
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

    this.openDetail(item, {})
  },

  hideDetail() {
    this.setData({
      detailVisible: false,
      currentItem: null,
      optionSelections: {},
      optionNotice: '',
      optionSummaryText: '请选择规格',
      optionReady: false,
      detailSheetStyle: '',
      detailDragStartY: 0
    })
  },

  addDish(event) {
    const item = this.findDish(event.currentTarget.dataset.id)

    if (!item) {
      return
    }

    if (item.options && item.options.length) {
      this.openDetail(item, this.getDefaultOptionSelections(item))
      return
    }

    this.addDishWithSelections(item, {})
  },

  toggleCartPanel() {
    if (!this.data.selectedItems.length) {
      wx.showToast({
        title: '购物车是空的',
        icon: 'none'
      })
      return
    }

    this.setData({
      cartVisible: !this.data.cartVisible
    })
  },

  hideCartPanel() {
    this.setData({
      cartVisible: false
    })
  },

  confirmAddDish() {
    const item = this.data.currentItem

    if (!item) {
      return
    }

    if (!this.validateRequiredOptions(item, this.data.optionSelections)) {
      return
    }

    this.addDishWithSelections(item, this.data.optionSelections)
    this.hideDetail()
  },

  selectOption(event) {
    const optionId = event.currentTarget.dataset.optionId
    const choiceId = event.currentTarget.dataset.choiceId

    if (!optionId || !choiceId || !this.data.currentItem) {
      return
    }

    const optionSelections = Object.assign({}, this.data.optionSelections)
    optionSelections[optionId] = choiceId

    this.setData({
      optionSelections,
      optionNotice: '',
      currentItem: this.prepareItemForDetail(this.data.currentItem, optionSelections),
      optionSummaryText: this.getOptionSummaryText(this.data.currentItem, optionSelections),
      optionReady: this.areRequiredOptionsSelected(this.data.currentItem, optionSelections)
    })
  },

  increaseCartItem(event) {
    const selectionKey = event.currentTarget.dataset.key
    const selectedItems = this.data.selectedItems.map((item) => {
      if (item.selectionKey !== selectionKey) {
        return item
      }

      return Object.assign({}, item, {
        quantity: item.quantity + 1
      })
    })

    this.updateSelected(selectedItems)
  },

  decreaseCartItem(event) {
    const selectionKey = event.currentTarget.dataset.key
    const selectedItems = this.data.selectedItems
      .map((item) => {
        if (item.selectionKey !== selectionKey) {
          return item
        }

        return Object.assign({}, item, {
          quantity: item.quantity - 1
        })
      })
      .filter((item) => item.quantity > 0)

    this.updateSelected(selectedItems)
  },

  copySelectedMenu() {
    if (!this.data.selectedItems.length) {
      wx.showToast({
        title: '请先选择商品',
        icon: 'none'
      })
      return
    }

    wx.setClipboardData({
      data: this.buildCopyText(this.data.selectedItems),
      success: () => {
        wx.showToast({
          title: '已复制已选菜单',
          icon: 'none'
        })
      },
      fail: () => {
        wx.showToast({
          title: '复制失败，请重试',
          icon: 'none'
        })
      }
    })
  },

  handleImageError(event) {
    const dishId = event.currentTarget.dataset.id

    if (!dishId) {
      return
    }

    this.replaceDishImage(dishId, FALLBACK_IMAGE)
  },

  stopTap() {},

  handleDetailDragStart(event) {
    const touch = event.touches && event.touches[0]

    if (!touch) {
      return
    }

    this.setData({
      detailDragStartY: touch.clientY,
      detailSheetStyle: ''
    })
  },

  handleDetailDragMove(event) {
    const touch = event.touches && event.touches[0]

    if (!touch || !this.data.detailDragStartY) {
      return
    }

    const offsetY = Math.max(0, touch.clientY - this.data.detailDragStartY)

    if (offsetY <= 0) {
      return
    }

    this.setData({
      detailSheetStyle: 'transform: translateY(' + offsetY + 'px); transition: none;'
    })
  },

  handleDetailDragEnd(event) {
    const touch = event.changedTouches && event.changedTouches[0]
    const offsetY = touch && this.data.detailDragStartY
      ? Math.max(0, touch.clientY - this.data.detailDragStartY)
      : 0

    if (offsetY > 88) {
      this.hideDetail()
      return
    }

    this.setData({
      detailSheetStyle: '',
      detailDragStartY: 0
    })
  },

  openDetail(item, optionSelections) {
    const normalizedSelections = optionSelections || this.getDefaultOptionSelections(item)

    this.setData({
      currentItem: this.prepareItemForDetail(item, normalizedSelections),
      optionSelections: normalizedSelections,
      optionNotice: '',
      optionSummaryText: this.getOptionSummaryText(item, normalizedSelections),
      optionReady: this.areRequiredOptionsSelected(item, normalizedSelections),
      detailSheetStyle: '',
      detailDragStartY: 0,
      detailVisible: true
    })
  },

  prepareItemForDetail(item, optionSelections) {
    const options = (item.options || []).map((option) => Object.assign({}, option, {
      choices: (option.choices || []).map((choice) => Object.assign({}, choice, {
        selected: optionSelections[option.id] === choice.id
      }))
    }))

    return Object.assign({}, item, {
      options
    })
  },

  getDefaultOptionSelections(item) {
    return (item.options || []).reduce((selections, option) => {
      const firstChoice = (option.choices || [])[0]

      if (firstChoice) {
        selections[option.id] = firstChoice.id
      }

      return selections
    }, {})
  },

  findDish(id) {
    for (let i = 0; i < this.data.categories.length; i += 1) {
      const dish = (this.data.categories[i].items || []).find((item) => item.id === id)

      if (dish) {
        return dish
      }
    }

    return null
  },

  validateRequiredOptions(item, optionSelections) {
    const missingOption = (item.options || []).find((option) => option.required && !optionSelections[option.id])

    if (!missingOption) {
      return true
    }

    this.setData({
      optionNotice: '请选择' + missingOption.name
    })

    wx.showToast({
      title: '请选择' + missingOption.name,
      icon: 'none'
    })

    return false
  },

  areRequiredOptionsSelected(item, optionSelections) {
    return !(item.options || []).some((option) => option.required && !optionSelections[option.id])
  },

  getOptionSummaryText(item, optionSelections) {
    const optionText = this.getOptionText(item, optionSelections)

    return optionText || '请选择规格'
  },

  addDishWithSelections(item, optionSelections) {
    const selectedItems = this.mergeSelectedDish(item, optionSelections)
    const selectedKey = this.getSelectionKey(item, optionSelections)
    const selectedDish = selectedItems.find((dish) => dish.selectionKey === selectedKey)

    this.updateSelected(selectedItems)

    wx.showToast({
      title: selectedDish.quantity > 1 ? '已加入 ' + selectedDish.quantity + ' 份' : '已加入购物车',
      icon: 'none'
    })
  },

  updateSelected(selectedItems) {
    const normalizedItems = selectedItems.map((item) => {
      const price = Number(item.price)
      const quantity = Number(item.quantity) || 0
      const itemTotal = Number.isNaN(price) ? 0 : price * quantity

      return Object.assign({}, item, {
        itemTotal: String(itemTotal)
      })
    })
    const total = normalizedItems.reduce((sum, item) => {
      const price = Number(item.price)
      const quantity = Number(item.quantity) || 0
      return Number.isNaN(price) ? sum : sum + price * quantity
    }, 0)
    const selectedCount = normalizedItems.reduce((sum, item) => sum + item.quantity, 0)
    const selectedSummaryText = this.getSelectedSummary(normalizedItems)
    const categories = this.getCategoriesWithCartQuantities(normalizedItems)
    const activeCategory = categories.find((category) => category.id === this.data.activeCategoryId)

    this.setData({
      selectedItems: normalizedItems,
      selectedCount,
      selectedTotal: String(total),
      selectedSummaryText,
      categories,
      activeItems: activeCategory ? activeCategory.items : [],
      cartVisible: normalizedItems.length ? this.data.cartVisible : false
    })
  },

  mergeSelectedDish(item, optionSelections) {
    const selectedItems = this.data.selectedItems.slice()
    const selectionKey = this.getSelectionKey(item, optionSelections)
    const selectedIndex = selectedItems.findIndex((dish) => dish.selectionKey === selectionKey)

    if (selectedIndex >= 0) {
      selectedItems[selectedIndex] = Object.assign({}, selectedItems[selectedIndex], {
        quantity: selectedItems[selectedIndex].quantity + 1
      })

      return selectedItems
    }

    return selectedItems.concat({
      id: item.id,
      selectionKey,
      name: item.name,
      price: item.price,
      optionText: this.getOptionText(item, optionSelections),
      quantity: 1
    })
  },

  getSelectionKey(item, optionSelections) {
    const selectedOptionIds = (item.options || [])
      .map((option) => option.id + ':' + (optionSelections[option.id] || ''))
      .join('|')

    return item.id + '|' + selectedOptionIds
  },

  getCategoriesWithCartQuantities(selectedItems) {
    const quantityMap = selectedItems.reduce((map, item) => {
      map[item.id] = (map[item.id] || 0) + item.quantity
      return map
    }, {})

    return this.data.categories.map((category) => Object.assign({}, category, {
      items: (category.items || []).map((item) => Object.assign({}, item, {
        cartQuantity: quantityMap[item.id] || 0,
        directSelectionKey: this.getSelectionKey(item, {})
      }))
    }))
  },

  getOptionText(item, optionSelections) {
    return (item.options || [])
      .map((option) => {
        const choiceId = optionSelections[option.id]
        const choice = (option.choices || []).find((itemChoice) => itemChoice.id === choiceId)
        return choice ? choice.name : ''
      })
      .filter(Boolean)
      .join(' / ')
  },

  getSelectedSummary(selectedItems) {
    if (!selectedItems.length) {
      return '还未选择菜品'
    }

    const preview = selectedItems.slice(0, 2)
      .map((item) => {
        const optionText = item.optionText ? '（' + item.optionText + '）' : ''
        return item.name + optionText + ' x' + item.quantity
      })
      .join('、')
    const restCount = selectedItems.length - preview.length

    return restCount > 0 ? preview + ' 等 ' + selectedItems.length + ' 种' : preview
  },

  buildCopyText(selectedItems) {
    const lines = [
      this.data.shop.name,
      '已选菜单：'
    ]

    selectedItems.forEach((item, index) => {
      const optionText = item.optionText ? '（' + item.optionText + '）' : ''
      lines.push((index + 1) + '. ' + item.name + optionText + ' x' + item.quantity)
    })

    lines.push('合计：¥' + this.data.selectedTotal)

    return lines.join('\n')
  },

  replaceDishImage(dishId, image) {
    const categories = this.data.categories.map((category) => Object.assign({}, category, {
      items: (category.items || []).map((item) => {
        if (item.id !== dishId || item.image === image) {
          return item
        }

        return Object.assign({}, item, {
          image
        })
      })
    }))
    const activeCategory = categories.find((category) => category.id === this.data.activeCategoryId)
    const currentItem = this.data.currentItem && this.data.currentItem.id === dishId
      ? Object.assign({}, this.data.currentItem, { image })
      : this.data.currentItem

    this.setData({
      categories,
      activeItems: activeCategory ? activeCategory.items : [],
      currentItem
    })
  }
})
