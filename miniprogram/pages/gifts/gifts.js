import menuData from '../../data/menu-data.js'

const giftApi = require('../../services/gift-api.js')
const GIFT_STORAGE_KEY = 'baby_gift_folder_v1'

function createEmptyForm() {
  return {
    id: '',
    imagePath: '',
    imageKey: '',
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

  const imageUrl = typeof gift.imageUrl === 'string' ? gift.imageUrl : ''
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
    name: gift.name || '',
    description: gift.description || '',
    createdAt: gift.createdAt,
    updatedAt: gift.updatedAt
  }))
}

function formsEqual(left, right) {
  return left.id === right.id &&
    left.imagePath === right.imagePath &&
    left.imageKey === right.imageKey &&
    left.name === right.name &&
    left.description === right.description
}

Page({
  data: {
    shop: menuData.shop,
    pageStyle: getPageStyle(menuData.shop),
    gifts: [],
    giftCount: 0,
    formVisible: false,
    isEditing: false,
    formTitle: '收藏新礼品',
    form: createEmptyForm(),
    saveDisabled: true,
    isSaving: false,
    isDeleting: false,
    formSheetStyle: '',
    formDragStartY: 0
  },

  onLoad() {
    this.initialForm = createEmptyForm()
    this.pendingImagePath = ''
    this.accessDenied = false

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
    this.cleanupPendingImage()
  },

  loadGifts() {
    let gifts = []

    try {
      gifts = normalizeGifts(wx.getStorageSync(GIFT_STORAGE_KEY))
    } catch (error) {
      wx.showToast({
        title: '礼品夹读取失败',
        icon: 'none'
      })
    }

    this.setData({
      gifts,
      giftCount: gifts.length
    })

    if (giftApi.isConfigured()) {
      this.refreshCloudGifts()
    }
  },

  async refreshCloudGifts() {
    try {
      const cloudGifts = await giftApi.listGifts()
      const gifts = normalizeGifts(cloudGifts)

      this.persistGifts(gifts)
      this.setData({
        gifts,
        giftCount: gifts.length
      })
    } catch (error) {
      this.handleCloudError(error, '云端同步失败，已显示缓存')
    }
  },

  handleCloudError(error, fallbackMessage) {
    if (error && error.code === 'FORBIDDEN') {
      if (this.accessDenied) {
        return
      }

      this.accessDenied = true
      wx.showModal({
        title: '无法访问礼品夹',
        content: '当前微信账号不在授权名单中。',
        showCancel: false,
        confirmText: '知道了',
        success: () => {
          wx.navigateBack({ delta: 1 })
        }
      })
      return
    }

    wx.showToast({
      title: error && error.message || fallbackMessage,
      icon: 'none'
    })
  },

  openCreateForm() {
    const form = createEmptyForm()

    this.initialForm = Object.assign({}, form)
    this.pendingImagePath = ''
    this.setData({
      formVisible: true,
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
    const id = event.currentTarget.dataset.id
    const gift = this.data.gifts.find((item) => item.id === id)

    if (!gift) {
      return
    }

    const form = {
      id: gift.id,
      imagePath: gift.imagePath,
      imageKey: gift.imageKey,
      name: gift.name,
      description: gift.description
    }

    this.initialForm = Object.assign({}, form)
    this.pendingImagePath = ''
    this.setData({
      formVisible: true,
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
    if (this.data.isSaving || this.data.isDeleting) {
      return
    }

    if (!this.hasFormChanges()) {
      this.discardForm()
      return
    }

    wx.showModal({
      title: '放弃本次修改？',
      content: '关闭后，本次填写的内容不会保存。',
      confirmText: '放弃',
      confirmColor: '#c45f72',
      cancelText: '继续填写',
      success: (result) => {
        if (result.confirm) {
          this.discardForm()
        }
      }
    })
  },

  discardForm() {
    this.cleanupPendingImage()
    this.hideForm()
  },

  hideForm() {
    const form = createEmptyForm()

    this.initialForm = Object.assign({}, form)
    this.pendingImagePath = ''
    this.setData({
      formVisible: false,
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

  hasFormChanges() {
    return !formsEqual(this.data.form, this.initialForm || createEmptyForm())
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

  chooseImage() {
    if (this.data.isSaving || this.data.isDeleting) {
      return
    }

    const handleSuccess = (tempFilePath) => {
      if (tempFilePath) {
        this.saveSelectedImage(tempFilePath)
      }
    }

    if (wx.chooseMedia) {
      wx.chooseMedia({
        count: 1,
        mediaType: ['image'],
        sourceType: ['album'],
        sizeType: ['compressed'],
        success: (result) => {
          const selectedFile = result.tempFiles && result.tempFiles[0]
          handleSuccess(selectedFile && selectedFile.tempFilePath)
        }
      })
      return
    }

    wx.chooseImage({
      count: 1,
      sourceType: ['album'],
      sizeType: ['compressed'],
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
        this.pendingImagePath = result.savedFilePath
        this.setData({
          'form.imagePath': result.savedFilePath
        })
        this.updateSaveState()
      },
      fail: () => {
        wx.showToast({
          title: '图片保存失败',
          icon: 'none'
        })
      }
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
      'form.imageKey': ''
    })
    this.updateSaveState()
  },

  handleNameInput(event) {
    if (this.data.isSaving || this.data.isDeleting) {
      return
    }

    this.setData({
      'form.name': event.detail.value
    })
    this.updateSaveState()
  },

  handleDescriptionInput(event) {
    if (this.data.isSaving || this.data.isDeleting) {
      return
    }

    this.setData({
      'form.description': event.detail.value
    })
    this.updateSaveState()
  },

  async saveGift() {
    const form = Object.assign({}, this.data.form)

    if (this.data.isSaving || this.data.isDeleting) {
      return
    }

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
    let uploadedImageKey = ''

    this.setData({
      isSaving: true,
      saveDisabled: true
    })

    try {
      let imageKey = form.imagePath ? form.imageKey || '' : ''

      if (hasNewImage) {
        uploadedImageKey = await giftApi.uploadImage(this.pendingImagePath, id)
        imageKey = uploadedImageKey
      }

      const payload = {
        id,
        imageKey,
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
      if (uploadedImageKey) {
        giftApi.deleteOrphan(uploadedImageKey).catch(() => {})
      }

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

  previewImage(event) {
    const current = event.currentTarget.dataset.src
    const urls = this.data.gifts
      .filter((gift) => gift.imagePath && gift.imageAvailable)
      .map((gift) => gift.imagePath)

    if (!current || !urls.length) {
      return
    }

    wx.previewImage({
      current,
      urls
    })
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
