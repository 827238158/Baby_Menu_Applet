import menuData from '../../data/menu-data.js'

const giftApi = require('../../services/gift-api.js')
const GIFT_STORAGE_KEY = 'baby_gift_folder_v1'
const DECOR_STORAGE_KEY = 'baby_decor_folder_v1'
const SHEET_CLOSE_DURATION = 240
const CARD_MOTION_DURATION = 240
const PREVIEW_CLOSE_DURATION = 220
const COLLECTION_GIFT = 'gift'
const COLLECTION_DECOR = 'decor'
const COLLECTION_CONFIG = {
  gift: {
    title: '礼品夹',
    subtitleNoun: '件心仪礼品',
    createTitle: '收藏新礼品',
    editTitle: '编辑礼品',
    nameLabel: '礼品名称',
    namePlaceholder: '例如：手工陶瓷杯',
    imageLabel: '为礼品添加一张图片',
    saveText: '保存到礼品夹',
    emptyTitle: '还没有收藏礼品',
    emptyButton: '收藏第一件',
    addAria: '收藏新礼品',
    storageKey: GIFT_STORAGE_KEY,
    idPrefix: 'gift_'
  },
  decor: {
    title: '装修好物',
    subtitleNoun: '件装修好物',
    createTitle: '收藏装修好物',
    editTitle: '编辑装修好物',
    nameLabel: '好物名称',
    namePlaceholder: '例如：胡桃木边几',
    imageLabel: '为好物添加一张图片',
    saveText: '保存到装修好物',
    emptyTitle: '还没有收藏装修好物',
    emptyButton: '收藏第一件',
    addAria: '收藏装修好物',
    storageKey: DECOR_STORAGE_KEY,
    idPrefix: 'decor_'
  }
}

function createCollectionState() {
  return {
    gifts: [],
    cachedGifts: [],
    giftCount: 0,
    hasMore: true,
    nextCursor: '',
    isLoadingMore: false,
    isInitialLoading: true,
    loaded: false,
    loading: false,
    scrollTop: 0
  }
}

function createEmptyForm() {
  return {
    id: '',
    imagePath: '',
    imageKey: '',
    thumbnailKey: '',
    name: '',
    description: ''
  }
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

function formatDate(timestamp) {
  const date = new Date(timestamp)
  const month = String(date.getMonth() + 1).padStart(2, '0')
  const day = String(date.getDate()).padStart(2, '0')

  return date.getFullYear() + '.' + month + '.' + day
}

function getDisplayName(gift) {
  const name = (gift.name || '').trim()
  const firstDescriptionLine = (gift.description || '').split(/\r?\n/)[0].trim()

  return name || firstDescriptionLine || '图片收藏'
}

function normalizeGift(gift) {
  if (!gift || !gift.id) {
    return null
  }

  const imageUrl = typeof gift.thumbnailUrl === 'string' && gift.thumbnailUrl
    ? gift.thumbnailUrl
    : typeof gift.imageUrl === 'string' ? gift.imageUrl : ''
  // 缓存数据优先保留上次已展示的地址，最新签名地址只作为失效回退。
  const imagePath = typeof gift.imagePath === 'string' && gift.imagePath
    ? gift.imagePath
    : imageUrl
  const imageKey = typeof gift.imageKey === 'string' ? gift.imageKey : ''
  const name = typeof gift.name === 'string' ? gift.name.trim() : ''
  const description = typeof gift.description === 'string' ? gift.description.trim() : ''

  if (!imagePath && !name && !description) {
    return null
  }

  const createdAt = Number(gift.createdAt) || Date.now()
  const updatedAt = Number(gift.updatedAt) || createdAt
  const normalized = {
    id: String(gift.id),
    imagePath,
    imageUrl,
    imageKey,
    thumbnailKey: typeof gift.thumbnailKey === 'string' ? gift.thumbnailKey : '',
    name,
    description,
    createdAt,
    updatedAt
  }

  return Object.assign({}, normalized, {
    displayName: getDisplayName(normalized),
    dateText: formatDate(createdAt),
    imageAvailable: Boolean(imagePath),
    imageFallbackTried: false
  })
}

function normalizeGifts(gifts) {
  if (!Array.isArray(gifts)) {
    return []
  }

  // 分页期间云端数据可能变化：按 ID 去重，同时保留 updatedAt 更新的版本。
  const byId = new Map()
  gifts.map(normalizeGift).filter(Boolean).forEach((gift) => {
    const existing = byId.get(gift.id)
    if (!existing || gift.updatedAt >= existing.updatedAt) {
      byId.set(gift.id, gift)
    }
  })

  return Array.from(byId.values())
    .sort((left, right) => right.createdAt - left.createdAt)
}

function mergeCloudGiftsWithCache(cloudGifts, cachedGifts) {
  const cachedById = new Map(
    (cachedGifts || []).map((gift) => [gift.id, gift])
  )

  return cloudGifts.map((gift) => {
    const cachedGift = cachedById.get(gift.id)

    if (
      !cachedGift ||
      !(gift.thumbnailKey || gift.imageKey) ||
      (gift.thumbnailKey || gift.imageKey) !== (cachedGift.thumbnailKey || cachedGift.imageKey) ||
      !cachedGift.imagePath
    ) {
      return gift
    }

    // 图片对象未变化时复用相同地址，让微信图片缓存可以直接命中。
    return Object.assign({}, gift, {
      imagePath: cachedGift.imagePath,
      imageUrl: gift.imageUrl || cachedGift.imageUrl || cachedGift.imagePath,
      imageAvailable: true,
      imageFallbackTried: false
    })
  })
}

function serializeGifts(gifts) {
  return gifts.map((gift) => ({
    id: gift.id,
    imagePath: gift.imagePath || '',
    imageUrl: gift.imageUrl || '',
    imageKey: gift.imageKey || '',
    thumbnailKey: gift.thumbnailKey || '',
    name: gift.name || '',
    description: gift.description || '',
    createdAt: gift.createdAt,
    updatedAt: gift.updatedAt
  }))
}

Page({
  data: {
    shop: menuData.shop,
    pageStyle: getPageStyle(menuData.shop),
    activeCollection: COLLECTION_GIFT,
    collectionTitle: COLLECTION_CONFIG.gift.title,
    collectionSubtitleNoun: COLLECTION_CONFIG.gift.subtitleNoun,
    collectionNameLabel: COLLECTION_CONFIG.gift.nameLabel,
    collectionNamePlaceholder: COLLECTION_CONFIG.gift.namePlaceholder,
    collectionImageLabel: COLLECTION_CONFIG.gift.imageLabel,
    collectionSaveText: COLLECTION_CONFIG.gift.saveText,
    collectionEmptyTitle: COLLECTION_CONFIG.gift.emptyTitle,
    collectionEmptyButton: COLLECTION_CONFIG.gift.emptyButton,
    collectionAddAria: COLLECTION_CONFIG.gift.addAria,
    listScrollTop: 0,
    gifts: [],
    giftCount: 0,
    accessDenied: false,
    formVisible: false,
    formClosing: false,
    isEditing: false,
    formTitle: '收藏新礼品',
    form: createEmptyForm(),
    saveDisabled: true,
    isSaving: false,
    isDeleting: false,
    isMoving: false,
    moveTargetTitle: COLLECTION_CONFIG.decor.title,
    formSheetStyle: '',
    formDragStartY: 0,
    hasMore: true,
    nextCursor: '',
    isLoadingMore: false,
    isInitialLoading: true,
    loadingSkeletons: [0, 1],
    isPreviewVisible: false,
    previewClosing: false,
    previewImagePath: '',
    isPreviewLoading: false,
    recentGiftId: '',
    removingGiftId: ''
  },

  onLoad() {
    this.pendingImagePath = ''
    this.pendingThumbnailPath = ''
    this.accessDenied = false
    this.hasLoaded = false
    this.isLoadingGifts = false
    this.collectionStates = {
      gift: createCollectionState(),
      decor: createCollectionState()
    }
    this.formCollection = COLLECTION_GIFT
    this.closeTimer = null
    this.cardMotionTimer = null
    this.previewCloseTimer = null
    this.imageSelectionGeneration = 0
    this.pageDestroyed = false

    if (!giftApi.isConfigured()) {
      wx.showToast({
        title: '心愿夹云端尚未配置',
        icon: 'none'
      })
    }
  },

  onShow() {
    if (this.hasLoaded || this.isLoadingGifts) {
      return
    }
    this.loadCollection(COLLECTION_GIFT)
  },

  onUnload() {
    this.pageDestroyed = true
    this.invalidateImageSelection()
    if (this.closeTimer) {
      clearTimeout(this.closeTimer)
    }
    if (this.cardMotionTimer) clearTimeout(this.cardMotionTimer)
    if (this.previewCloseTimer) clearTimeout(this.previewCloseTimer)
    this.cleanupPendingImage()
  },

  getCollectionConfig(collection = this.data.activeCollection) {
    return COLLECTION_CONFIG[collection] || COLLECTION_CONFIG.gift
  },

  getCollectionState(collection = this.data.activeCollection) {
    return this.collectionStates[collection]
  },

  getCollectionApi(collection) {
    if (collection === COLLECTION_DECOR) {
      return {
        list: giftApi.listDecorItems,
        create: giftApi.createDecorItem,
        update: giftApi.updateDecorItem,
        remove: giftApi.deleteDecorItem,
        image: giftApi.getDecorImage
      }
    }

    return {
      list: giftApi.listGifts,
      create: giftApi.createGift,
      update: giftApi.updateGift,
      remove: giftApi.deleteGift,
      image: giftApi.getGiftImage
    }
  },

  setActiveCollectionData(collection, extra = {}) {
    const state = this.getCollectionState(collection)
    const config = this.getCollectionConfig(collection)

    if (!state || this.data.activeCollection !== collection) return

    this.setData(Object.assign({
      gifts: state.gifts,
      giftCount: state.giftCount,
      hasMore: state.hasMore,
      nextCursor: state.nextCursor,
      isLoadingMore: state.isLoadingMore,
      isInitialLoading: state.isInitialLoading,
      listScrollTop: state.scrollTop,
      collectionTitle: config.title,
      collectionSubtitleNoun: config.subtitleNoun,
      collectionNameLabel: config.nameLabel,
      collectionNamePlaceholder: config.namePlaceholder,
      collectionImageLabel: config.imageLabel,
      collectionSaveText: config.saveText,
      collectionEmptyTitle: config.emptyTitle,
      collectionEmptyButton: config.emptyButton,
      collectionAddAria: config.addAria
    }, extra))
  },

  switchCollection(event) {
    if (this.data.formVisible || this.data.isPreviewVisible) return
    const collection = event.currentTarget.dataset.collection
    if (!COLLECTION_CONFIG[collection] || collection === this.data.activeCollection) return

    // 只切换分段状态，不再主动滚动页面，避免头图和内容产生纵向跳动。
    this.setData({ activeCollection: collection })
    this.setActiveCollectionData(collection)
    const state = this.getCollectionState(collection)
    if (!state.loaded && !state.loading) {
      this.loadCollection(collection)
    }
  },

  loadGifts() {
    return this.loadCollection(COLLECTION_GIFT)
  },

  loadCollection(collection) {
    const state = this.getCollectionState(collection)
    if (this.accessDenied || !state || state.loaded || state.loading) {
      return
    }
    state.loading = true
    if (collection === COLLECTION_GIFT) this.isLoadingGifts = true
    let gifts = []
    const config = this.getCollectionConfig(collection)

    try {
      gifts = normalizeGifts(wx.getStorageSync(config.storageKey))
    } catch (error) {
      wx.showToast({
        title: config.title + '读取失败',
        icon: 'none'
      })
    }

    state.cachedGifts = gifts
    if (collection === COLLECTION_GIFT) this.cachedGifts = gifts

    if (giftApi.isConfigured()) {
      // 先完成云端白名单校验，避免未授权账号短暂看到本地缓存内容。
      state.gifts = []
      state.giftCount = 0
      state.hasMore = true
      state.nextCursor = ''
      state.isInitialLoading = true
      this.setActiveCollectionData(collection)
      this.refreshCloudCollection(collection, true)
      return
    }

    Object.assign(state, {
      gifts,
      giftCount: gifts.length,
      hasMore: false,
      nextCursor: '',
      isInitialLoading: false,
      loaded: true,
      loading: false
    })
    this.setActiveCollectionData(collection)
    if (collection === COLLECTION_GIFT) {
      this.hasLoaded = true
      this.isLoadingGifts = false
    }
  },

  async refreshCloudGifts(reset = false) {
    return this.refreshCloudCollection(COLLECTION_GIFT, reset)
  },

  async refreshCloudCollection(collection, reset = false) {
    const state = this.getCollectionState(collection)
    if (!state || state.isLoadingMore) return
    state.isLoadingMore = true
    this.setActiveCollectionData(collection)
    try {
      const api = this.getCollectionApi(collection)
      const result = await api.list(reset ? '' : state.nextCursor, 20)
      const cloudGifts = Array.isArray(result) ? result : result.items || []
      const normalizedCloudGifts = normalizeGifts(cloudGifts)
      const stableCloudGifts = mergeCloudGiftsWithCache(
        normalizedCloudGifts,
        state.cachedGifts
      )
      const gifts = normalizeGifts(
        reset ? stableCloudGifts : state.gifts.concat(stableCloudGifts)
      )

      this.persistGifts(gifts, collection)
      const cloudTotal = Number(result && result.total)
      Object.assign(state, {
        gifts,
        giftCount: Number.isInteger(cloudTotal) && cloudTotal >= 0 ? cloudTotal : gifts.length,
        hasMore: Boolean(result && result.hasMore),
        nextCursor: result && result.nextCursor || '',
        isLoadingMore: false,
        isInitialLoading: false,
        loaded: reset ? true : state.loaded,
        loading: false
      })
      this.setActiveCollectionData(collection)
      if (reset) {
        if (collection === COLLECTION_GIFT) {
          this.hasLoaded = true
          this.isLoadingGifts = false
        }
      }
    } catch (error) {
      state.isLoadingMore = false
      state.isInitialLoading = false
      state.loading = false
      if (reset) {
        if (collection === COLLECTION_GIFT) this.isLoadingGifts = false
      }
      if (error && error.code === 'FORBIDDEN') {
        this.setActiveCollectionData(collection)
        this.handleCloudError(error, '云端同步失败，已显示缓存')
        return
      }
      if (!this.accessDenied && reset && state.cachedGifts) {
        state.gifts = state.cachedGifts
        state.giftCount = state.cachedGifts.length
        state.hasMore = false
        state.nextCursor = ''
        state.loaded = true
      }
      this.setActiveCollectionData(collection)
      this.handleCloudError(error, '云端同步失败，已显示缓存')
    }
  },

  handleCloudError(error, fallbackMessage) {
    if (error && error.code === 'FORBIDDEN') {
      if (this.accessDenied) {
        return
      }

      this.accessDenied = true
      Object.values(this.collectionStates).forEach((state) => {
        Object.assign(state, {
          gifts: [],
          giftCount: 0,
          hasMore: false,
          nextCursor: '',
          isLoadingMore: false,
          isInitialLoading: false,
          loaded: false,
          loading: false
        })
      })
      this.setData({
        accessDenied: true,
        gifts: [],
        giftCount: 0,
        hasMore: false,
        nextCursor: '',
        isLoadingMore: false,
        isInitialLoading: false,
        formVisible: false,
        formClosing: false
      })
      return
    }

    wx.showToast({
      title: error && error.message || fallbackMessage,
      icon: 'none'
    })
  },

  openCreateForm() {
    if (this.accessDenied) return
    const form = createEmptyForm()
    const collection = this.data.activeCollection
    const config = this.getCollectionConfig(collection)

    this.invalidateImageSelection()
    this.pendingImagePath = ''
    this.pendingThumbnailPath = ''
    this.formCollection = collection
    this.setData({
      formVisible: true,
      formClosing: false,
      isEditing: false,
      formTitle: config.createTitle,
      form,
      saveDisabled: true,
      isSaving: false,
      isDeleting: false,
      isMoving: false,
      moveTargetTitle: this.getCollectionConfig(
        collection === COLLECTION_GIFT ? COLLECTION_DECOR : COLLECTION_GIFT
      ).title,
      formSheetStyle: '',
      formDragStartY: 0
    })
  },

  openEditForm(event) {
    if (this.accessDenied) return
    const id = event.detail && event.detail.id || event.currentTarget.dataset.id
    const gift = this.data.gifts.find((item) => item.id === id)

    if (!gift) {
      return
    }

    const form = {
      id: gift.id,
      imagePath: gift.imagePath,
      imageKey: gift.imageKey,
      thumbnailKey: gift.thumbnailKey,
      name: gift.name,
      description: gift.description
    }

    this.invalidateImageSelection()
    this.pendingImagePath = ''
    this.pendingThumbnailPath = ''
    this.formCollection = this.data.activeCollection
    this.setData({
      formVisible: true,
      formClosing: false,
      isEditing: true,
      formTitle: this.getCollectionConfig(this.formCollection).editTitle,
      form,
      saveDisabled: false,
      isSaving: false,
      isDeleting: false,
      isMoving: false,
      moveTargetTitle: this.getCollectionConfig(
        this.formCollection === COLLECTION_GIFT ? COLLECTION_DECOR : COLLECTION_GIFT
      ).title,
      formSheetStyle: '',
      formDragStartY: 0
    })
  },

  requestCloseForm() {
    if (this.data.isSaving || this.data.isDeleting || this.data.isMoving || this.data.formClosing) {
      return
    }

    this.startCloseAnimation()
  },

  startCloseAnimation() {
    if (this.data.formClosing) return Promise.resolve()

    this.setData({
      formClosing: true,
      formSheetStyle: 'transform: translateY(100%); transition: transform ' + SHEET_CLOSE_DURATION + 'ms ease-in;'
    })
    return new Promise((resolve) => {
      this.closeTimer = setTimeout(() => {
        this.hideForm()
        resolve()
      }, SHEET_CLOSE_DURATION)
    })
  },

  hideForm() {
    const form = createEmptyForm()
    const config = this.getCollectionConfig(this.data.activeCollection)

    if (this.closeTimer) {
      clearTimeout(this.closeTimer)
      this.closeTimer = null
    }
    this.invalidateImageSelection()
    this.cleanupPendingImage()
    this.setData({
      formVisible: false,
      formClosing: false,
      isEditing: false,
      formTitle: config.createTitle,
      form,
      saveDisabled: true,
      isSaving: false,
      isDeleting: false,
      isMoving: false,
      formSheetStyle: '',
      formDragStartY: 0
    })
  },

  stopTap() {},

  handleFormDragStart(event) {
    const touch = event.touches && event.touches[0]

    if (!touch) {
      return
    }

    this.setData({
      formDragStartY: touch.clientY,
      formSheetStyle: ''
    })
  },

  handleFormDragMove(event) {
    const touch = event.touches && event.touches[0]

    if (!touch || !this.data.formDragStartY) {
      return
    }

    const offsetY = Math.max(0, touch.clientY - this.data.formDragStartY)

    if (offsetY <= 0) {
      return
    }

    this.setData({
      formSheetStyle: 'transform: translateY(' + offsetY + 'px); transition: none;'
    })
  },

  handleFormDragEnd(event) {
    const touch = event.changedTouches && event.changedTouches[0]
    const offsetY = touch && this.data.formDragStartY
      ? Math.max(0, touch.clientY - this.data.formDragStartY)
      : 0

    this.setData({
      formSheetStyle: '',
      formDragStartY: 0
    })

    if (offsetY > 88) {
      this.requestCloseForm()
    }
  },

  hasFormContent(form) {
    return Boolean(
      form.imagePath ||
      form.imageKey ||
      (form.name || '').trim() ||
      (form.description || '').trim()
    )
  },

  updateSaveState() {
    this.setData({
      saveDisabled: this.data.isSaving || !this.hasFormContent(this.data.form)
    })
  },

  showImageSourceActions() {
    if (!this.data.formVisible || this.data.isSaving || this.data.isDeleting || this.data.isMoving || this.data.formClosing) {
      return
    }

    wx.showActionSheet({
      itemList: ['拍照', '从相册选择'],
      success: (result) => {
        const sourceTypes = ['camera', 'album']
        const sourceType = sourceTypes[result.tapIndex]

        if (sourceType) {
          this.chooseImage(sourceType)
        }
      }
    })
  },

  chooseImage(sourceType = 'album') {
    if (!this.data.formVisible || this.data.isSaving || this.data.isDeleting || this.data.isMoving || this.data.formClosing) {
      return
    }

    const generation = ++this.imageSelectionGeneration
    const handleSuccess = (tempFilePath) => {
      if (tempFilePath && this.isImageSelectionActive(generation)) {
        this.prepareSelectedImage(tempFilePath, sourceType, generation)
      }
    }

    if (wx.chooseMedia) {
      wx.chooseMedia({
        count: 1,
        mediaType: ['image'],
        sourceType: [sourceType],
        sizeType: ['original'],
        success: (result) => {
          const selectedFile = result.tempFiles && result.tempFiles[0]
          handleSuccess(selectedFile && selectedFile.tempFilePath)
        }
      })
      return
    }

    wx.chooseImage({
      count: 1,
      sourceType: [sourceType],
      sizeType: ['original'],
      success: (result) => {
        handleSuccess(result.tempFilePaths && result.tempFilePaths[0])
      }
    })
  },

  prepareSelectedImage(tempFilePath, sourceType, generation = this.imageSelectionGeneration) {
    if (!this.isImageSelectionActive(generation)) return

    if (sourceType !== 'camera' || !wx.editImage) {
      this.saveSelectedImage(tempFilePath, generation)
      return
    }

    // 拍照确认页不自带聊天同款编辑入口，拍照成功后主动进入微信图片编辑器。
    wx.editImage({
      src: tempFilePath,
      success: (result) => {
        if (result.tempFilePath && this.isImageSelectionActive(generation)) {
          this.saveSelectedImage(result.tempFilePath, generation)
        }
      },
      fail: (error) => {
        if (!this.isImageSelectionActive(generation)) return
        const errorMessage = error && error.errMsg || ''

        if (!/cancel/i.test(errorMessage)) {
          wx.showToast({
            title: '图片编辑失败',
            icon: 'none'
          })
        }
      }
    })
  },

  saveSelectedImage(tempFilePath, generation = this.imageSelectionGeneration) {
    if (!this.isImageSelectionActive(generation)) return
    const fileSystem = wx.getFileSystemManager()

    // 相册路径是临时文件，先转存为本地用户文件再写入礼品资料。
    fileSystem.saveFile({
      tempFilePath,
      success: (result) => {
        if (!this.isImageSelectionActive(generation)) {
          this.removeSavedFile(result.savedFilePath)
          return
        }
        this.cleanupPendingImage()
        this.createThumbnail(result.savedFilePath, (thumbnailPath) => {
          if (!this.isImageSelectionActive(generation)) {
            this.removeSavedFile(result.savedFilePath)
            return
          }
          this.pendingImagePath = result.savedFilePath
          this.pendingThumbnailPath = thumbnailPath
          this.setData({ 'form.imagePath': result.savedFilePath })
          this.updateSaveState()
        })
      },
      fail: () => {
        if (!this.isImageSelectionActive(generation)) return
        wx.showToast({
          title: '图片保存失败',
          icon: 'none'
        })
      }
    })
  },

  createThumbnail(filePath, success) {
    // 原图只供全屏查看，列表使用微信原生压缩后的缩略图降低下行流量。
    if (!wx.compressImage) {
      success(filePath)
      return
    }

    wx.compressImage({
      src: filePath,
      quality: 65,
      success: (result) => success(result.tempFilePath || filePath),
      fail: () => success(filePath)
    })
  },

  confirmRemoveFormImage() {
    if (this.data.isSaving || this.data.isDeleting || this.data.isMoving || this.data.formClosing) {
      return
    }

    wx.showModal({
      title: '移除图片',
      content: '确定移除当前图片吗？',
      confirmText: '移除',
      confirmColor: '#c45f72',
      success: (result) => {
        if (result.confirm) {
          this.removeFormImage()
        }
      }
    })
  },

  removeFormImage() {
    if (this.data.isSaving || this.data.isDeleting || this.data.isMoving || this.data.formClosing) {
      return
    }

    this.invalidateImageSelection()
    if (this.pendingImagePath && this.data.form.imagePath === this.pendingImagePath) {
      this.cleanupPendingImage()
    }

    this.setData({
      'form.imagePath': '',
      'form.imageKey': '',
      'form.thumbnailKey': ''
    })
    this.updateSaveState()
  },

  handleNameInput(event) {
    if (this.data.isSaving || this.data.isDeleting || this.data.isMoving || this.data.formClosing) {
      return
    }

    this.setData({
      'form.name': event.detail.value
    })
    this.updateSaveState()
  },

  handleDescriptionInput(event) {
    if (this.data.isSaving || this.data.isDeleting || this.data.isMoving || this.data.formClosing) {
      return
    }

    this.setData({
      'form.description': event.detail.value
    })
    this.updateSaveState()
  },

  async saveGift() {
    if (this.data.isSaving || this.data.isDeleting || this.data.isMoving || this.accessDenied) {
      return
    }
    const form = Object.assign({}, this.data.form)
    const collection = this.formCollection || this.data.activeCollection
    const config = this.getCollectionConfig(collection)
    const state = this.getCollectionState(collection)
    const api = this.getCollectionApi(collection)

    if (!this.hasFormContent(form)) {
      wx.showToast({
        title: '请添加图片或文字',
        icon: 'none'
      })
      return
    }

    const sourceGift = state.gifts.find((gift) => gift.id === form.id)
    const id = form.id ||
      config.idPrefix + Date.now() + '_' + Math.random().toString(36).slice(2, 10)
    if (!form.id) {
      form.id = id
      // 创建失败后保留同一 ID，重试时由后端幂等处理，避免误删已生效图片。
      this.setData({ 'form.id': id })
    }
    const hasNewImage = Boolean(
      this.pendingImagePath &&
      form.imagePath === this.pendingImagePath
    )
    let uploadedImageKeys = []

    this.setData({
      isSaving: true,
      saveDisabled: true
    })

    try {
      let imageKey = form.imagePath ? form.imageKey || '' : ''
      let thumbnailKey = form.imagePath ? form.thumbnailKey || imageKey : ''

      if (hasNewImage) {
        const uploaded = await giftApi.uploadImages(
          this.pendingImagePath,
          this.pendingThumbnailPath || this.pendingImagePath,
          id,
          collection
        )
        imageKey = uploaded.imageKey
        thumbnailKey = uploaded.thumbnailKey
        uploadedImageKeys = [imageKey, thumbnailKey]
      }

      const payload = {
        id,
        imageKey,
        thumbnailKey,
        name: (form.name || '').trim(),
        description: (form.description || '').trim()
      }
      const savedGift = sourceGift
        ? await api.update(payload)
        : await api.create(payload)
      const total = Number.isInteger(savedGift && savedGift.total)
        ? savedGift.total
        : state.giftCount + (sourceGift ? 0 : 1)
      const nextGifts = sourceGift
        ? state.gifts.map((item) => item.id === sourceGift.id ? savedGift : item)
        : [savedGift].concat(state.gifts)
      const gifts = normalizeGifts(nextGifts)
      // 云端保存成功后再刷新缓存和页面，避免显示尚未落盘的数据。
      this.persistGifts(gifts, collection)
      this.cleanupPendingImage()
      Object.assign(state, {
        gifts,
        giftCount: total,
        hasMore: total > gifts.length
      })
      this.setActiveCollectionData(collection)
      await this.startCloseAnimation()

      if (!this.pageDestroyed) {
        // 弹层退场后再强调刚保存的卡片，让状态变化清晰可见。
        this.setData({ recentGiftId: savedGift.id })
        if (this.cardMotionTimer) clearTimeout(this.cardMotionTimer)
        this.cardMotionTimer = setTimeout(() => {
          this.cardMotionTimer = null
          if (!this.pageDestroyed) this.setData({ recentGiftId: '' })
        }, CARD_MOTION_DURATION + 80)
      }

      wx.showToast({
        title: sourceGift ? '已更新' : '已收藏',
        icon: 'success'
      })
    } catch (error) {
      uploadedImageKeys.forEach((imageKey) => {
        const cleanup = collection === COLLECTION_DECOR
          ? giftApi.deleteCollectionOrphan(imageKey, collection)
          : giftApi.deleteOrphan(imageKey)
        cleanup.catch(() => {})
      })

      this.setData({
        isSaving: false,
        saveDisabled: !this.hasFormContent(this.data.form)
      })
      this.handleCloudError(error, '保存失败，请稍后重试')
    }
  },

  confirmDelete() {
    if (this.data.isSaving || this.data.isDeleting || this.data.isMoving) {
      return
    }

    const collection = this.formCollection || this.data.activeCollection
    const config = this.getCollectionConfig(collection)
    const gift = this.getCollectionState(collection).gifts
      .find((item) => item.id === this.data.form.id)

    if (!gift) {
      return
    }

    wx.showModal({
      title: '删除' + (collection === COLLECTION_DECOR ? '好物' : '礼品'),
      content: '确定从' + config.title + '中删除“' + gift.displayName + '”吗？',
      confirmText: '删除',
      confirmColor: '#c45f72',
      success: (result) => {
        if (result.confirm) {
          this.deleteGift(gift)
        }
      }
    })
  },

  async deleteGift(gift) {
    if (this.data.isDeleting || this.data.isSaving || this.data.isMoving) {
      return
    }

    this.setData({
      isDeleting: true
    })

    try {
      const collection = this.formCollection || this.data.activeCollection
      const state = this.getCollectionState(collection)
      const result = await this.getCollectionApi(collection).remove(gift.id)
      const gifts = normalizeGifts(
        state.gifts.filter((item) => item.id !== gift.id)
      )

      this.persistGifts(gifts, collection)
      this.cleanupPendingImage()
      Object.assign(state, {
        giftCount: Number.isInteger(result && result.total)
          ? result.total
          : Math.max(0, state.giftCount - 1),
        hasMore: Number.isInteger(result && result.total)
          ? result.total > gifts.length
          : state.hasMore
      })
      this.setActiveCollectionData(collection)
      await this.startCloseAnimation()

      if (!this.pageDestroyed) {
        // 先让目标卡片淡出并收起，再从数据列表移除，避免内容突然跳位。
        this.setData({ removingGiftId: gift.id })
        await new Promise((resolve) => {
          this.cardMotionTimer = setTimeout(() => {
            this.cardMotionTimer = null
            resolve()
          }, CARD_MOTION_DURATION)
        })
      }

      if (!this.pageDestroyed) {
        state.gifts = gifts
        this.setActiveCollectionData(collection, { removingGiftId: '' })
      }

      wx.showToast({
        title: '已删除',
        icon: 'success'
      })
    } catch (error) {
      this.setData({
        isDeleting: false
      })
      this.handleCloudError(error, '删除失败，请稍后重试')
    }
  },

  persistGifts(gifts, collection = this.data.activeCollection) {
    try {
      wx.setStorageSync(this.getCollectionConfig(collection).storageKey, serializeGifts(gifts))
      return true
    } catch (error) {
      wx.showToast({
        title: '保存失败，请检查空间',
        icon: 'none'
      })
      return false
    }
  },

  async previewImage(event) {
    const id = event.detail && event.detail.id || event.currentTarget.dataset.id
    if (!id || this.data.isPreviewLoading) return

    this.setData({ isPreviewLoading: true })
    try {
      const result = await this.getCollectionApi(this.data.activeCollection).image(id)
      if (!result || !result.imageUrl) throw new Error('图片加载失败')
      this.setData({
        isPreviewVisible: true,
        previewClosing: false,
        previewImagePath: result.imageUrl,
        isPreviewLoading: false
      })
    } catch (error) {
      this.setData({ isPreviewLoading: false })
      this.handleCloudError(error, '图片加载失败，请稍后重试')
    }
  },

  closePreview() {
    if (!this.data.isPreviewVisible || this.data.previewClosing) return

    this.setData({ previewClosing: true })
    this.previewCloseTimer = setTimeout(() => {
      this.previewCloseTimer = null
      if (this.pageDestroyed) return
      this.setData({
        isPreviewVisible: false,
        previewClosing: false,
        previewImagePath: ''
      })
    }, PREVIEW_CLOSE_DURATION)
  },

  backToMenu() {
    wx.navigateBack({ delta: 1 })
  },

  loadMoreGifts() {
    const collection = this.data.activeCollection
    const state = this.getCollectionState(collection)
    if (!state.hasMore || state.isLoadingMore || !giftApi.isConfigured()) return
    this.refreshCloudCollection(collection, false)
  },

  handleListScroll(event) {
    const state = this.getCollectionState(this.data.activeCollection)
    if (!state) return

    // 滚动过程中只记录实例状态，避免高频 setData；切回分段时再恢复位置。
    state.scrollTop = Math.max(0, Number(event.detail && event.detail.scrollTop) || 0)
  },

  handleImageError(event) {
    const id = event.detail && event.detail.id || event.currentTarget.dataset.id
    const collection = this.data.activeCollection
    const state = this.getCollectionState(collection)
    const gift = state.gifts.find((item) => item.id === id)

    if (!gift) {
      return
    }

    if (gift.imageUrl && !gift.imageFallbackTried) {
      const pendingGifts = state.gifts.map((item) => item.id === id
        ? Object.assign({}, item, { imageFallbackTried: true })
        : item)

      state.gifts = pendingGifts
      this.setActiveCollectionData(collection)
      wx.downloadFile({
        url: gift.imageUrl,
        success: (result) => {
          if (result.statusCode === 200 && result.tempFilePath) {
            const gifts = state.gifts.map((item) => item.id === id
              ? Object.assign({}, item, {
                imagePath: result.tempFilePath,
                imageAvailable: true
              })
              : item)
            state.gifts = gifts
            this.setActiveCollectionData(collection)
            return
          }
          this.markImageUnavailable(id, collection)
        },
        fail: () => {
          this.markImageUnavailable(id, collection)
        }
      })
      return
    }

    this.markImageUnavailable(id, collection)
  },

  confirmMove() {
    if (!this.data.isEditing || this.data.isSaving || this.data.isDeleting || this.data.isMoving) return

    const sourceCollection = this.formCollection || this.data.activeCollection
    const targetCollection = sourceCollection === COLLECTION_GIFT ? COLLECTION_DECOR : COLLECTION_GIFT
    const item = this.getCollectionState(sourceCollection).gifts
      .find((entry) => entry.id === this.data.form.id)
    if (!item) return

    wx.showModal({
      title: '移动收藏',
      content: '将“' + item.displayName + '”移到' + this.getCollectionConfig(targetCollection).title + '？',
      confirmText: '移动',
      confirmColor: '#c45f72',
      success: (result) => {
        if (result.confirm) this.moveCollectionItem(item, sourceCollection, targetCollection)
      }
    })
  },

  async moveCollectionItem(item, sourceCollection, targetCollection) {
    if (this.data.isSaving || this.data.isDeleting || this.data.isMoving) return

    this.setData({ isMoving: true, saveDisabled: true })
    try {
      const result = await giftApi.moveCollectionItem(item.id, targetCollection)
      const movedItem = normalizeGift(result && result.item)
      if (!movedItem) throw new Error('移动后的收藏数据无效')

      const sourceState = this.getCollectionState(sourceCollection)
      const targetState = this.getCollectionState(targetCollection)
      sourceState.gifts = normalizeGifts(sourceState.gifts.filter((entry) => entry.id !== item.id))
      targetState.gifts = normalizeGifts([movedItem].concat(targetState.gifts))
      sourceState.cachedGifts = sourceState.gifts
      targetState.cachedGifts = targetState.gifts
      sourceState.giftCount = Number.isInteger(result.sourceTotal)
        ? result.sourceTotal
        : Math.max(0, sourceState.giftCount - 1)
      targetState.giftCount = Number.isInteger(result.targetTotal)
        ? result.targetTotal
        : targetState.giftCount + 1
      sourceState.hasMore = sourceState.giftCount > sourceState.gifts.length
      targetState.hasMore = targetState.giftCount > targetState.gifts.length
      Object.assign(targetState, {
        loaded: true,
        loading: false,
        isInitialLoading: false,
        isLoadingMore: false
      })
      this.persistGifts(sourceState.gifts, sourceCollection)
      this.persistGifts(targetState.gifts, targetCollection)

      await this.startCloseAnimation()
      if (this.pageDestroyed) return

      // 移动完成后切到目标分段，头图和列表容器保持原位。
      this.setData({ activeCollection: targetCollection, recentGiftId: movedItem.id })
      this.setActiveCollectionData(targetCollection)
      if (this.cardMotionTimer) clearTimeout(this.cardMotionTimer)
      this.cardMotionTimer = setTimeout(() => {
        this.cardMotionTimer = null
        if (!this.pageDestroyed) this.setData({ recentGiftId: '' })
      }, CARD_MOTION_DURATION + 80)
      wx.showToast({ title: '已移到' + this.getCollectionConfig(targetCollection).title, icon: 'success' })
    } catch (error) {
      this.setData({
        isMoving: false,
        saveDisabled: !this.hasFormContent(this.data.form)
      })
      this.handleCloudError(error, '移动失败，请稍后重试')
    }
  },

  markImageUnavailable(id, collection = this.data.activeCollection) {
    const state = this.getCollectionState(collection)
    const gifts = state.gifts.map((gift) => gift.id === id
      ? Object.assign({}, gift, { imageAvailable: false })
      : gift)

    state.gifts = gifts
    this.setActiveCollectionData(collection)
  },

  cleanupPendingImage() {
    if (this.pendingImagePath) {
      this.removeSavedFile(this.pendingImagePath)
      this.pendingImagePath = ''
    }
    this.pendingThumbnailPath = ''
  },

  invalidateImageSelection() {
    this.imageSelectionGeneration = (this.imageSelectionGeneration || 0) + 1
  },

  isImageSelectionActive(generation) {
    return !this.pageDestroyed &&
      this.data.formVisible &&
      !this.data.formClosing &&
      generation === this.imageSelectionGeneration
  },

  removeSavedFile(filePath) {
    if (!filePath) {
      return
    }

    wx.getFileSystemManager().removeSavedFile({
      filePath,
      fail: () => {}
    })
  }
})
