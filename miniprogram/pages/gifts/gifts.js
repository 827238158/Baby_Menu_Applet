import menuData from '../../data/menu-data.js'

const giftApi = require('../../services/gift-api.js')
const GIFT_STORAGE_KEY = 'baby_gift_folder_v1'

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

  const imageUrl = typeof gift.thumbnailUrl === 'string' ? gift.thumbnailUrl :
    typeof gift.imageUrl === 'string' ? gift.imageUrl : ''
  const imagePath = imageUrl
    ? imageUrl
    : typeof gift.imagePath === 'string' ? gift.imagePath : ''
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

  return gifts
    .map(normalizeGift)
    .filter(Boolean)
    .sort((left, right) => right.createdAt - left.createdAt)
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
    formSheetStyle: '',
    formDragStartY: 0,
    hasMore: true,
    nextCursor: '',
    isLoadingMore: false,
    isPreviewVisible: false,
    previewImagePath: '',
    isPreviewLoading: false
  },

  onLoad() {
    this.pendingImagePath = ''
    this.pendingThumbnailPath = ''
    this.accessDenied = false
    this.closeTimer = null

    if (!giftApi.isConfigured()) {
      wx.showToast({
        title: '礼品云端尚未配置',
        icon: 'none'
      })
    }
  },

  onShow() {
    this.loadGifts()
  },

  onUnload() {
    if (this.closeTimer) {
      clearTimeout(this.closeTimer)
    }
    this.cleanupPendingImage()
  },

  loadGifts() {
    if (this.accessDenied) {
      return
    }
    let gifts = []

    try {
      gifts = normalizeGifts(wx.getStorageSync(GIFT_STORAGE_KEY))
    } catch (error) {
      wx.showToast({
        title: '礼品夹读取失败',
        icon: 'none'
      })
    }

    this.cachedGifts = gifts

    if (giftApi.isConfigured()) {
      // 先完成云端白名单校验，避免未授权账号短暂看到本地缓存内容。
      this.setData({
        gifts: [],
        giftCount: 0,
        hasMore: true,
        nextCursor: ''
      })
      this.refreshCloudGifts(true)
      return
    }

    this.setData({
      gifts,
      giftCount: gifts.length,
      hasMore: false,
      nextCursor: ''
    })
  },

  async refreshCloudGifts(reset = false) {
    if (this.data.isLoadingMore) return
    this.setData({ isLoadingMore: true })
    try {
      const result = await giftApi.listGifts(reset ? '' : this.data.nextCursor, 20)
      const cloudGifts = Array.isArray(result) ? result : result.items || []
      const gifts = normalizeGifts(reset ? cloudGifts : this.data.gifts.concat(cloudGifts))

      this.persistGifts(gifts)
      this.setData({
        gifts,
        giftCount: Number(result && result.total) || gifts.length,
        hasMore: Boolean(result && result.hasMore),
        nextCursor: result && result.nextCursor || '',
        isLoadingMore: false
      })
      this.hasLoaded = true
    } catch (error) {
      this.setData({ isLoadingMore: false })
      if (error && error.code === 'FORBIDDEN') {
        this.handleCloudError(error, '云端同步失败，已显示缓存')
        return
      }
      if (!this.accessDenied && reset && this.cachedGifts) {
        this.setData({
          gifts: this.cachedGifts,
          giftCount: this.cachedGifts.length,
          hasMore: false,
          nextCursor: ''
        })
      }
      this.handleCloudError(error, '云端同步失败，已显示缓存')
    }
  },

  handleCloudError(error, fallbackMessage) {
    if (error && error.code === 'FORBIDDEN') {
      if (this.accessDenied) {
        return
      }

      this.accessDenied = true
      this.setData({
        accessDenied: true,
        gifts: [],
        giftCount: 0,
        hasMore: false,
        nextCursor: '',
        isLoadingMore: false,
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

    this.pendingImagePath = ''
    this.pendingThumbnailPath = ''
    this.setData({
      formVisible: true,
      formClosing: false,
      isEditing: false,
      formTitle: '收藏新礼品',
      form,
      saveDisabled: true,
      isSaving: false,
      isDeleting: false,
      formSheetStyle: '',
      formDragStartY: 0
    })
  },

  openEditForm(event) {
    if (this.accessDenied) return
    const id = event.currentTarget.dataset.id
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

    this.pendingImagePath = ''
    this.pendingThumbnailPath = ''
    this.setData({
      formVisible: true,
      formClosing: false,
      isEditing: true,
      formTitle: '编辑礼品',
      form,
      saveDisabled: false,
      isSaving: false,
      isDeleting: false,
      formSheetStyle: '',
      formDragStartY: 0
    })
  },

  requestCloseForm() {
    if (this.data.isSaving || this.data.isDeleting || this.data.formClosing) {
      return
    }

    this.startCloseAnimation()
  },

  startCloseAnimation() {
    if (this.data.formClosing) return

    this.setData({
      formClosing: true,
      formSheetStyle: 'transform: translateY(100%); transition: transform 220ms ease-in;'
    })
    this.closeTimer = setTimeout(() => this.hideForm(), 230)
  },

  hideForm() {
    const form = createEmptyForm()

    if (this.closeTimer) {
      clearTimeout(this.closeTimer)
      this.closeTimer = null
    }
    this.cleanupPendingImage()
    this.setData({
      formVisible: false,
      formClosing: false,
      isEditing: false,
      formTitle: '收藏新礼品',
      form,
      saveDisabled: true,
      isSaving: false,
      isDeleting: false,
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

  chooseImage(event) {
    if (this.data.isSaving || this.data.isDeleting) {
      return
    }

    const sourceType = event && event.currentTarget.dataset.source || 'album'
    const handleSuccess = (tempFilePath) => {
      if (tempFilePath) {
        this.saveSelectedImage(tempFilePath)
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

  saveSelectedImage(tempFilePath) {
    const fileSystem = wx.getFileSystemManager()

    // 相册路径是临时文件，先转存为本地用户文件再写入礼品资料。
    fileSystem.saveFile({
      tempFilePath,
      success: (result) => {
        this.cleanupPendingImage()
        this.createThumbnail(result.savedFilePath, (thumbnailPath) => {
          this.pendingImagePath = result.savedFilePath
          this.pendingThumbnailPath = thumbnailPath
          this.setData({ 'form.imagePath': result.savedFilePath })
          this.updateSaveState()
        })
      },
      fail: () => {
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

  removeFormImage() {
    if (this.data.isSaving || this.data.isDeleting) {
      return
    }

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
    if (this.data.isSaving || this.data.isDeleting || this.data.formClosing) {
      return
    }

    this.setData({
      'form.name': event.detail.value
    })
    this.updateSaveState()
  },

  handleDescriptionInput(event) {
    if (this.data.isSaving || this.data.isDeleting || this.data.formClosing) {
      return
    }

    this.setData({
      'form.description': event.detail.value
    })
    this.updateSaveState()
  },

  async saveGift() {
    if (this.data.isSaving || this.data.isDeleting || this.accessDenied) {
      return
    }
    const form = Object.assign({}, this.data.form)

    if (!this.hasFormContent(form)) {
      wx.showToast({
        title: '请添加图片或文字',
        icon: 'none'
      })
      return
    }

    const sourceGift = this.data.gifts.find((gift) => gift.id === form.id)
    const id = form.id ||
      'gift_' + Date.now() + '_' + Math.random().toString(36).slice(2, 10)
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
          id
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
        ? await giftApi.updateGift(payload)
        : await giftApi.createGift(payload)
      const nextGifts = sourceGift
        ? this.data.gifts.map((item) => item.id === sourceGift.id ? savedGift : item)
        : [savedGift].concat(this.data.gifts)
      const gifts = normalizeGifts(nextGifts)
      // 云端保存成功后再刷新缓存和页面，避免显示尚未落盘的数据。
      this.persistGifts(gifts)
      this.cleanupPendingImage()
      this.setData({
        gifts,
        giftCount: gifts.length
      })
      this.hideForm()

      wx.showToast({
        title: sourceGift ? '已更新' : '已收藏',
        icon: 'success'
      })
    } catch (error) {
      uploadedImageKeys.forEach((imageKey) => giftApi.deleteOrphan(imageKey).catch(() => {}))

      this.setData({
        isSaving: false,
        saveDisabled: !this.hasFormContent(this.data.form)
      })
      this.handleCloudError(error, '保存失败，请稍后重试')
    }
  },

  confirmDelete() {
    if (this.data.isSaving || this.data.isDeleting) {
      return
    }

    const gift = this.data.gifts.find((item) => item.id === this.data.form.id)

    if (!gift) {
      return
    }

    wx.showModal({
      title: '删除礼品',
      content: '确定从礼品夹中删除“' + gift.displayName + '”吗？',
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
    if (this.data.isDeleting || this.data.isSaving) {
      return
    }

    this.setData({
      isDeleting: true
    })

    try {
      await giftApi.deleteGift(gift.id)
      const gifts = normalizeGifts(
        this.data.gifts.filter((item) => item.id !== gift.id)
      )

      this.persistGifts(gifts)
      this.cleanupPendingImage()
      this.setData({
        gifts,
        giftCount: gifts.length
      })
      this.hideForm()

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

  persistGifts(gifts) {
    try {
      wx.setStorageSync(GIFT_STORAGE_KEY, serializeGifts(gifts))
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
    const id = event.currentTarget.dataset.id
    if (!id || this.data.isPreviewLoading) return

    this.setData({ isPreviewLoading: true })
    try {
      const result = await giftApi.getGiftImage(id)
      if (!result || !result.imageUrl) throw new Error('图片加载失败')
      this.setData({
        isPreviewVisible: true,
        previewImagePath: result.imageUrl,
        isPreviewLoading: false
      })
    } catch (error) {
      this.setData({ isPreviewLoading: false })
      this.handleCloudError(error, '图片加载失败，请稍后重试')
    }
  },

  closePreview() {
    this.setData({
      isPreviewVisible: false,
      previewImagePath: ''
    })
  },

  backToMenu() {
    wx.navigateBack({ delta: 1 })
  },

  loadMoreGifts() {
    if (!this.data.hasMore || this.data.isLoadingMore || !giftApi.isConfigured()) return
    this.refreshCloudGifts(false)
  },

  onReachBottom() {
    this.loadMoreGifts()
  },

  handleImageError(event) {
    const id = event.currentTarget.dataset.id
    const gift = this.data.gifts.find((item) => item.id === id)

    if (!gift) {
      return
    }

    if (gift.imageUrl && !gift.imageFallbackTried) {
      const pendingGifts = this.data.gifts.map((item) => item.id === id
        ? Object.assign({}, item, { imageFallbackTried: true })
        : item)

      this.setData({ gifts: pendingGifts })
      wx.downloadFile({
        url: gift.imageUrl,
        success: (result) => {
          if (result.statusCode === 200 && result.tempFilePath) {
            const gifts = this.data.gifts.map((item) => item.id === id
              ? Object.assign({}, item, {
                imagePath: result.tempFilePath,
                imageAvailable: true
              })
              : item)
            this.setData({ gifts })
            return
          }
          this.markImageUnavailable(id)
        },
        fail: () => {
          this.markImageUnavailable(id)
        }
      })
      return
    }

    this.markImageUnavailable(id)
  },

  markImageUnavailable(id) {
    const gifts = this.data.gifts.map((gift) => gift.id === id
      ? Object.assign({}, gift, { imageAvailable: false })
      : gift)

    this.setData({ gifts })
  },

  cleanupPendingImage() {
    if (this.pendingImagePath) {
      this.removeSavedFile(this.pendingImagePath)
      this.pendingImagePath = ''
    }
    this.pendingThumbnailPath = ''
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
