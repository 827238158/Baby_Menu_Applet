import menuData from '../../data/menu-data.js'

const FALLBACK_IMAGE = '../../assets/placeholder-food.jpg'
const SHARE_IMAGE = '../../assets/share.jpg'
const SHARE_PATH = '/pages/menu/menu'
const CART_STORAGE_KEY = 'baby_menu_cart_v1'
const OPTION_TYPE_TEXT = 'text'
const CUSTOM_NAME_OPTION_ID = 'customName'
const CUSTOM_REMARK_OPTION_ID = 'customRemark'
const MULTI_NAME_PATTERN = /[、,，;；/\r\n]/
const CART_KEY_VERSION = 'v2:'
const MAX_CART_QUANTITY = 99
const SHEET_CLOSE_DURATION = 240

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
    type: option.type || 'choice',
    required: option.required !== false,
    choices: option.type === OPTION_TYPE_TEXT ? [] : (option.choices || []).map(normalizeChoice),
    placeholder: option.placeholder || '',
    maxlength: option.maxlength || 40
  }))
}

function createOtherDish(category) {
  const categoryName = category.name || ''

  return {
    id: category.id + '__other',
    categoryId: category.id,
    name: categoryName + '其他',
    desc: '奶茶新品，其他好吃的，自定义选项。',
    price: '0',
    image: FALLBACK_IMAGE,
    tags: ['宝宝自选'],
    options: [
      {
        id: CUSTOM_NAME_OPTION_ID,
        name: '名称',
        type: OPTION_TYPE_TEXT,
        required: true,
        placeholder: '请输入一个商品名称',
        maxlength: 30
      },
      {
        id: CUSTOM_REMARK_OPTION_ID,
        name: '备注',
        type: OPTION_TYPE_TEXT,
        required: false,
        placeholder: '可填写口味、数量或补充说明',
        maxlength: 60
      }
    ]
  }
}

function normalizeCategories(categories) {
  return (categories || []).map((category) => {
    const sourceItems = (category.items || []).concat(createOtherDish(category))
    const items = sourceItems.map((item) => {
      const options = normalizeOptions(item.options)

      return Object.assign({}, item, {
        image: item.image || FALLBACK_IMAGE,
        tags: item.tags || [],
        options,
        // 商品卡片只展示预设规格，用户输入型规格留到弹窗里填写。
        previewOptions: options.filter((option) => option.type !== OPTION_TYPE_TEXT)
      })
    })

    return Object.assign({}, category, {
      count: items.length,
      items
    })
  })
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

function getShareConfig(shop) {
  return {
    title: shop.shareTitle || shop.name,
    path: SHARE_PATH,
    imageUrl: shop.shareImage || SHARE_IMAGE
  }
}

const normalizedCategories = normalizeCategories(menuData.categories)

Page({
  data: {
    shop: menuData.shop,
    pageStyle: getPageStyle(menuData.shop),
    categories: normalizedCategories,
    activeCategoryId: '',
    activeItems: [],
    selectedItems: [],
    selectedCount: 0,
    selectedTotal: '0',
    selectedSummaryText: '还未选择菜品',
    cartVisible: false,
    cartClosing: false,
    cartMotionClass: '',
    cartRemark: '',
    detailVisible: false,
    detailClosing: false,
    currentItem: null,
    optionSelections: {},
    optionNotice: '',
    optionSummaryText: '请选择规格',
    optionReady: false,
    detailSheetStyle: '',
    detailDragStartY: 0
  },

  onLoad() {
    this.quantityMotionSequence = 0
    this.cartCloseTimer = null
    this.detailCloseTimer = null
    const firstCategory = this.data.categories[0] || { id: '', items: [] }

    if (wx.showShareMenu) {
      wx.showShareMenu({
        withShareTicket: false,
        menus: ['shareAppMessage']
      })
    }

    this.setData({
      activeCategoryId: firstCategory.id,
      activeItems: firstCategory.items || []
    }, () => {
      const storedSelectedItems = this.getStoredSelectedItems()

      if (storedSelectedItems.length) {
        this.updateSelected(storedSelectedItems)
      } else if (this.cartStorageNeedsCleanup && !this.persistSelectedItems([])) {
        wx.showToast({ title: '购物车保存失败', icon: 'none' })
      }
    })
  },

  onUnload() {
    if (this.cartCloseTimer) clearTimeout(this.cartCloseTimer)
    if (this.detailCloseTimer) clearTimeout(this.detailCloseTimer)
  },

  onShareAppMessage() {
    return getShareConfig(this.data.shop)
  },

  onShareTimeline() {
    const shareConfig = getShareConfig(this.data.shop)

    return {
      title: shareConfig.title,
      query: '',
      imageUrl: shareConfig.imageUrl
    }
  },

  openGiftFolder() {
    wx.navigateTo({
      url: '/pages/gifts/gifts'
    })
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

  hideDetail() {
    if (!this.data.detailVisible || this.data.detailClosing) return

    // 先播放下滑和遮罩淡出，再卸载弹层，保持空间关系连续。
    this.setData({
      detailClosing: true,
      detailSheetStyle: 'transform: translateY(100%); transition: transform ' + SHEET_CLOSE_DURATION + 'ms ease-in;',
      detailDragStartY: 0
    })
    this.detailCloseTimer = setTimeout(() => {
      this.detailCloseTimer = null
      this.setData({
        detailVisible: false,
        detailClosing: false,
        currentItem: null,
        optionSelections: {},
        optionNotice: '',
        optionSummaryText: '请选择规格',
        optionReady: false,
        detailSheetStyle: '',
        detailDragStartY: 0
      })
    }, SHEET_CLOSE_DURATION)
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

    if (this.data.cartVisible) {
      this.hideCartPanel()
      return
    }

    if (this.cartCloseTimer) clearTimeout(this.cartCloseTimer)
    this.setData({ cartVisible: true, cartClosing: false })
  },

  hideCartPanel() {
    if (!this.data.cartVisible || this.data.cartClosing) return

    this.setData({ cartClosing: true })
    this.cartCloseTimer = setTimeout(() => {
      this.cartCloseTimer = null
      this.setData({ cartVisible: false, cartClosing: false })
    }, SHEET_CLOSE_DURATION)
  },

  confirmAddDish() {
    if (this.data.detailClosing) return

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

  handleTextOptionInput(event) {
    const optionId = event.currentTarget.dataset.optionId

    if (!optionId || !this.data.currentItem) {
      return
    }

    const optionSelections = Object.assign({}, this.data.optionSelections)
    // 输入型规格允许用户自定义内容，加入购物车前会统一做必填和防输错校验。
    optionSelections[optionId] = event.detail.value || ''

    this.setData({
      optionSelections,
      optionNotice: this.getOptionValidationNotice(this.data.currentItem, optionSelections),
      currentItem: this.prepareItemForDetail(this.data.currentItem, optionSelections),
      optionSummaryText: this.getOptionSummaryText(this.data.currentItem, optionSelections),
      optionReady: this.areRequiredOptionsSelected(this.data.currentItem, optionSelections)
    })
  },

  increaseCartItem(event) {
    const selectionKey = event.currentTarget.dataset.key
    const target = this.data.selectedItems.find((item) => item.selectionKey === selectionKey)

    if (!target || target.quantity >= MAX_CART_QUANTITY) {
      if (target) {
        wx.showToast({ title: '每项最多 99 份', icon: 'none' })
      }
      return
    }
    const selectedItems = this.data.selectedItems.map((item) => {
      if (item.selectionKey !== selectionKey) {
        return item
      }

      return Object.assign({}, item, {
        quantity: item.quantity + 1
      })
    })

    this.updateSelected(selectedItems, {
      selectionKey,
      dishId: target.id
    })
  },

  decreaseCartItem(event) {
    const selectionKey = event.currentTarget.dataset.key
    const target = this.data.selectedItems.find((item) => item.selectionKey === selectionKey)

    if (!target) return

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

    this.updateSelected(selectedItems, {
      selectionKey,
      dishId: target.id
    })
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
          title: '已复制分享内容',
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

  handleCartRemarkInput(event) {
    // 实时记录购物车备注，复制分享时会和已选菜品一起输出。
    this.setData({
      cartRemark: event.detail.value || ''
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

  stopTouchMove() {},

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

    if (this.detailCloseTimer) {
      clearTimeout(this.detailCloseTimer)
      this.detailCloseTimer = null
    }

    this.setData({
      currentItem: this.prepareItemForDetail(item, normalizedSelections),
      optionSelections: normalizedSelections,
      optionNotice: '',
      optionSummaryText: this.getOptionSummaryText(item, normalizedSelections),
      optionReady: this.areRequiredOptionsSelected(item, normalizedSelections),
      detailSheetStyle: '',
      detailDragStartY: 0,
      detailClosing: false,
      detailVisible: true
    })
  },

  prepareItemForDetail(item, optionSelections) {
    const options = (item.options || []).map((option) => {
      if (option.type === OPTION_TYPE_TEXT) {
        return Object.assign({}, option, {
          value: optionSelections[option.id] || ''
        })
      }

      return Object.assign({}, option, {
        choices: (option.choices || []).map((choice) => Object.assign({}, choice, {
          selected: optionSelections[option.id] === choice.id
        }))
      })
    })

    return Object.assign({}, item, {
      options
    })
  },

  getDefaultOptionSelections(item) {
    return (item.options || []).reduce((selections, option) => {
      if (option.type === OPTION_TYPE_TEXT) {
        selections[option.id] = ''
        return selections
      }

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
    const missingOption = (item.options || []).find((option) => {
      if (!option.required) {
        return false
      }

      if (option.type === OPTION_TYPE_TEXT) {
        return !this.getTextOptionValue(optionSelections, option.id)
      }

      return !optionSelections[option.id]
    })

    if (!missingOption) {
      const optionNotice = this.getOptionValidationNotice(item, optionSelections)

      if (!optionNotice) {
        return true
      }

      this.setData({
        optionNotice,
        optionReady: false
      })

      wx.showToast({
        title: optionNotice,
        icon: 'none'
      })

      return false
    }

    const optionNotice = missingOption.type === OPTION_TYPE_TEXT
      ? '请填写' + missingOption.name
      : '请选择' + missingOption.name

    this.setData({
      optionNotice
    })

    wx.showToast({
      title: optionNotice,
      icon: 'none'
    })

    return false
  },

  getOptionValidationNotice(item, optionSelections) {
    const hasCustomNameOption = (item.options || []).some((option) => option.id === CUSTOM_NAME_OPTION_ID)

    if (!hasCustomNameOption) {
      return ''
    }

    const customName = this.getTextOptionValue(optionSelections, CUSTOM_NAME_OPTION_ID)

    if (customName && MULTI_NAME_PATTERN.test(customName)) {
      return '一次只能填写一个名称'
    }

    return ''
  },

  getTextOptionValue(optionSelections, optionId) {
    const value = optionSelections[optionId]

    return typeof value === 'string' ? value.trim() : ''
  },

  areRequiredOptionsSelected(item, optionSelections) {
    if (this.getOptionValidationNotice(item, optionSelections)) {
      return false
    }

    return !(item.options || []).some((option) => {
      if (!option.required) {
        return false
      }

      if (option.type === OPTION_TYPE_TEXT) {
        return !this.getTextOptionValue(optionSelections, option.id)
      }

      return !optionSelections[option.id]
    })
  },

  getOptionSummaryText(item, optionSelections) {
    const optionText = this.getOptionText(item, optionSelections)

    return optionText || '请选择规格'
  },

  addDishWithSelections(item, optionSelections) {
    const normalizedSelections = this.normalizeOptionSelections(item, optionSelections)
    if (!normalizedSelections) {
      wx.showToast({ title: '购物车数据无效', icon: 'none' })
      return
    }

    const selectedKey = this.getSelectionKey(item, normalizedSelections)
    const current = this.data.selectedItems.find((dish) => dish.selectionKey === selectedKey)
    if (current && current.quantity >= MAX_CART_QUANTITY) {
      wx.showToast({ title: '每项最多 99 份', icon: 'none' })
      return
    }

    const selectedItems = this.mergeSelectedDish(item, normalizedSelections)
    const selectedDish = selectedItems.find((dish) => dish.selectionKey === selectedKey)

    if (!this.updateSelected(selectedItems, {
      selectionKey: selectedKey,
      dishId: item.id
    })) return

    wx.showToast({
      title: selectedDish.quantity > 1 ? '已加入 ' + selectedDish.quantity + ' 份' : '已加入购物车',
      icon: 'none'
    })
  },

  updateSelected(selectedItems, motionTarget) {
    let quantityMotionClass = ''
    if (motionTarget) {
      this.quantityMotionSequence = (this.quantityMotionSequence || 0) + 1
      quantityMotionClass = this.quantityMotionSequence % 2
        ? 'quantity-pop-a'
        : 'quantity-pop-b'
    }
    const normalizedItems = []
    for (const item of selectedItems) {
      const dish = this.findDish(item.id)
      const quantity = item.quantity
      const optionSelections = dish
        ? this.normalizeOptionSelections(dish, item.optionSelections || {})
        : null

      if (!dish || !Number.isFinite(quantity) || !Number.isInteger(quantity) || quantity < 1 || quantity > MAX_CART_QUANTITY || !optionSelections) {
        wx.showToast({ title: '购物车数据无效', icon: 'none' })
        return false
      }

      const price = Number(dish.price)
      const itemTotal = Number.isFinite(price) ? price * quantity : 0

      const selectionKey = this.getSelectionKey(dish, optionSelections)
      normalizedItems.push({
        id: dish.id,
        selectionKey,
        name: dish.name,
        image: dish.image || FALLBACK_IMAGE,
        price: dish.price,
        optionSelections,
        optionText: this.getOptionText(dish, optionSelections),
        quantity,
        itemTotal: String(itemTotal),
        quantityMotionClass: motionTarget && motionTarget.selectionKey === selectionKey
          ? quantityMotionClass
          : ''
      })
    }
    const total = normalizedItems.reduce((sum, item) => {
      const price = Number(item.price)
      return Number.isFinite(price) ? sum + price * item.quantity : sum
    }, 0)
    const selectedCount = normalizedItems.reduce((sum, item) => sum + item.quantity, 0)
    const selectedSummaryText = this.getSelectedSummary(normalizedItems)
    const categories = this.getCategoriesWithCartQuantities(
      normalizedItems,
      motionTarget && motionTarget.dishId,
      quantityMotionClass
    )
    const activeCategory = categories.find((category) => category.id === this.data.activeCategoryId)

    if (!this.persistSelectedItems(normalizedItems)) {
      wx.showToast({ title: '购物车保存失败', icon: 'none' })
      return false
    }

    this.setData({
      selectedItems: normalizedItems,
      selectedCount,
      selectedTotal: String(total),
      selectedSummaryText,
      categories,
      activeItems: activeCategory ? activeCategory.items : [],
      cartVisible: normalizedItems.length ? this.data.cartVisible : false,
      cartClosing: normalizedItems.length ? this.data.cartClosing : false,
      cartMotionClass: quantityMotionClass
    })
    return true
  },

  mergeSelectedDish(item, optionSelections) {
    const selectedItems = this.data.selectedItems.slice()
    const normalizedSelections = this.normalizeOptionSelections(item, optionSelections)
    const selectionKey = this.getSelectionKey(item, normalizedSelections)
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
      image: item.image || FALLBACK_IMAGE,
      price: item.price,
      optionSelections: normalizedSelections,
      optionText: this.getOptionText(item, normalizedSelections),
      quantity: 1
    })
  },

  getStoredSelectedItems() {
    let storedItems = []
    this.cartStorageNeedsCleanup = false

    try {
      storedItems = wx.getStorageSync(CART_STORAGE_KEY)
    } catch (error) {
      return []
    }

    if (!Array.isArray(storedItems)) {
      this.cartStorageNeedsCleanup = Boolean(storedItems)
      return []
    }

    const normalizedItems = storedItems
      .map((storedItem) => this.normalizeStoredCartItem(storedItem))
      .filter(Boolean)
    this.cartStorageNeedsCleanup = storedItems.length > 0 && normalizedItems.length === 0
    return normalizedItems
  },

  normalizeStoredCartItem(storedItem) {
    if (!storedItem || !storedItem.id) {
      return null
    }

    const dish = this.findDish(storedItem.id)
    const quantity = storedItem.quantity

    if (!dish || !Number.isFinite(quantity) || !Number.isInteger(quantity) || quantity < 1 || quantity > MAX_CART_QUANTITY) {
      return null
    }

    const sourceSelections = storedItem.optionSelections && typeof storedItem.optionSelections === 'object'
      ? storedItem.optionSelections
      : this.parseLegacyOptionSelections(dish, storedItem.selectionKey)
    const optionSelections = this.normalizeOptionSelections(dish, sourceSelections)

    if (!optionSelections) return null

    return {
      id: dish.id,
      selectionKey: this.getSelectionKey(dish, optionSelections),
      name: dish.name,
      image: dish.image || FALLBACK_IMAGE,
      price: dish.price,
      optionSelections,
      optionText: this.getOptionText(dish, optionSelections),
      quantity
    }
  },

  persistSelectedItems(selectedItems) {
    try {
      if (!selectedItems.length) {
        wx.removeStorageSync(CART_STORAGE_KEY)
        return true
      }

      wx.setStorageSync(CART_STORAGE_KEY, selectedItems.map((item) => ({
        id: item.id,
        selectionKey: item.selectionKey,
        name: item.name,
        image: item.image || FALLBACK_IMAGE,
        price: item.price,
        optionSelections: item.optionSelections || {},
        quantity: item.quantity
      })))
      return true
    } catch (error) {
      return false
    }
  },

  getSelectionKey(item, optionSelections) {
    const selectedOptionIds = (item.options || []).map((option) => {
        const value = option.type === OPTION_TYPE_TEXT
          ? this.getTextOptionValue(optionSelections, option.id)
          : (optionSelections[option.id] || '')

        return [option.id, value]
      })

    return CART_KEY_VERSION + JSON.stringify([item.id, selectedOptionIds])
  },

  normalizeOptionSelections(item, sourceSelections) {
    if (!sourceSelections || typeof sourceSelections !== 'object') return null

    const validOptionIds = new Set((item.options || []).map((option) => option.id))
    if (Object.keys(sourceSelections).some((optionId) => !validOptionIds.has(optionId))) {
      return null
    }

    const normalized = {}
    for (const option of item.options || []) {
      if (option.type === OPTION_TYPE_TEXT) {
        const value = this.getTextOptionValue(sourceSelections, option.id)
        if (value.length > option.maxlength || (option.required && !value)) return null
        normalized[option.id] = value
        continue
      }

      const value = typeof sourceSelections[option.id] === 'string'
        ? sourceSelections[option.id]
        : ''
      if (option.required && !value) return null
      if (value && !(option.choices || []).some((choice) => choice.id === value)) return null
      normalized[option.id] = value
    }

    if (this.getOptionValidationNotice(item, normalized)) return null
    return normalized
  },

  parseLegacyOptionSelections(item, selectionKey) {
    if (typeof selectionKey !== 'string' || selectionKey.indexOf(item.id + '|') !== 0) {
      return null
    }

    const tail = selectionKey.slice(item.id.length + 1)
    const options = item.options || []
    if (!options.length) return tail ? null : {}

    const parts = tail.split('|')
    if (parts.length !== options.length) return null

    const selections = {}
    for (let index = 0; index < options.length; index += 1) {
      const prefix = options[index].id + ':'
      if (parts[index].indexOf(prefix) !== 0) return null
      selections[options[index].id] = parts[index].slice(prefix.length)
    }
    return selections
  },

  getCategoriesWithCartQuantities(selectedItems, motionDishId, quantityMotionClass) {
    const quantityMap = selectedItems.reduce((map, item) => {
      map[item.id] = (map[item.id] || 0) + item.quantity
      return map
    }, {})

    return this.data.categories.map((category) => Object.assign({}, category, {
      items: (category.items || []).map((item) => Object.assign({}, item, {
        cartQuantity: quantityMap[item.id] || 0,
        directSelectionKey: this.getSelectionKey(item, {}),
        quantityMotionClass: item.id === motionDishId ? quantityMotionClass : ''
      }))
    }))
  },

  getOptionText(item, optionSelections) {
    const hasCustomNameOption = (item.options || []).some((option) => option.id === CUSTOM_NAME_OPTION_ID)
    const customName = this.getTextOptionValue(optionSelections, CUSTOM_NAME_OPTION_ID)

    if (hasCustomNameOption) {
      if (!customName) {
        return ''
      }

      const customRemark = this.getTextOptionValue(optionSelections, CUSTOM_REMARK_OPTION_ID)
      return customRemark ? customName + ' / ' + customRemark : '名称：' + customName
    }

    return (item.options || [])
      .map((option) => {
        if (option.type === OPTION_TYPE_TEXT) {
          const textValue = this.getTextOptionValue(optionSelections, option.id)
          return textValue ? option.name + '：' + textValue : ''
        }

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
      this.data.shop.name + '出单啦！宝宝想要这些：'
    ]

    selectedItems.forEach((item, index) => {
      const optionText = item.optionText ? '（' + item.optionText + '）' : ''
      lines.push((index + 1) + '. ' + item.name + optionText + ' x' + item.quantity)
    })

    lines.push('合计：¥' + this.data.selectedTotal)

    // 备注为空时不追加，避免复制内容出现多余的空备注行。
    const cartRemark = (this.data.cartRemark || '').trim()
    if (cartRemark) {
      lines.push('宝宝の备注：' + cartRemark)
    }

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
    const selectedItems = this.data.selectedItems.map((item) => {
      if (item.id !== dishId || item.image === image) {
        return item
      }

      return Object.assign({}, item, {
        image
      })
    })

    this.setData({
      categories,
      activeItems: activeCategory ? activeCategory.items : [],
      currentItem,
      selectedItems
    })
  }
})
