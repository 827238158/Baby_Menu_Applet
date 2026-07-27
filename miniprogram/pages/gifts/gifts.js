import menuData from '../../data/menu-data.js'

const GIFT_STORAGE_KEY = 'baby_gift_folder_v1'

function createEmptyForm() {
  return {
    id: '',
    imagePath: '',
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

  const imagePath = typeof gift.imagePath === 'string' ? gift.imagePath : ''
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
    name,
    description,
    createdAt,
    updatedAt
  }

  return Object.assign({}, normalized, {
    displayName: getDisplayName(normalized),
    dateText: formatDate(createdAt),
    imageAvailable: Boolean(imagePath)
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
    name: gift.name || '',
    description: gift.description || '',
    createdAt: gift.createdAt,
    updatedAt: gift.updatedAt
  }))
}

function formsEqual(left, right) {
  return left.id === right.id &&
    left.imagePath === right.imagePath &&
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
    formSheetStyle: '',
    formDragStartY: 0
  },

  onLoad() {
    this.initialForm = createEmptyForm()
    this.pendingImagePath = ''
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
      formSheetStyle: '',
      formDragStartY: 0
    })
  },

  requestCloseForm() {
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
      (form.name || '').trim() ||
      (form.description || '').trim()
    )
  },

  updateSaveState() {
    this.setData({
      saveDisabled: !this.hasFormContent(this.data.form)
    })
  },

  chooseImage() {
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
    if (this.pendingImagePath && this.data.form.imagePath === this.pendingImagePath) {
      this.cleanupPendingImage()
    }

    this.setData({
      'form.imagePath': ''
    })
    this.updateSaveState()
  },

  handleNameInput(event) {
    this.setData({
      'form.name': event.detail.value
    })
    this.updateSaveState()
  },

  handleDescriptionInput(event) {
    this.setData({
      'form.description': event.detail.value
    })
    this.updateSaveState()
  },

  saveGift() {
    const form = this.data.form

    if (!this.hasFormContent(form)) {
      wx.showToast({
        title: '请添加图片或文字',
        icon: 'none'
      })
      return
    }

    const now = Date.now()
    const sourceGift = this.data.gifts.find((gift) => gift.id === form.id)
    const gift = {
      id: form.id || 'gift_' + now + '_' + Math.random().toString(36).slice(2, 7),
      imagePath: form.imagePath || '',
      name: (form.name || '').trim(),
      description: (form.description || '').trim(),
      createdAt: sourceGift ? sourceGift.createdAt : now,
      updatedAt: now
    }
    const nextGifts = sourceGift
      ? this.data.gifts.map((item) => item.id === sourceGift.id ? gift : item)
      : [gift].concat(this.data.gifts)

    if (!this.persistGifts(nextGifts)) {
      return
    }

    // 缓存写入成功后再清理旧图片，避免保存失败导致原图片丢失。
    if (this.initialForm.imagePath && this.initialForm.imagePath !== gift.imagePath) {
      this.removeSavedFile(this.initialForm.imagePath)
    }

    this.pendingImagePath = ''
    const gifts = normalizeGifts(nextGifts)
    this.setData({
      gifts,
      giftCount: gifts.length
    })
    this.hideForm()

    wx.showToast({
      title: sourceGift ? '已更新' : '已收藏',
      icon: 'success'
    })
  },

  confirmDelete() {
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

  deleteGift(gift) {
    const nextGifts = this.data.gifts.filter((item) => item.id !== gift.id)

    if (!this.persistGifts(nextGifts)) {
      return
    }

    this.cleanupPendingImage()
    this.removeSavedFile(gift.imagePath)
    const gifts = normalizeGifts(nextGifts)
    this.setData({
      gifts,
      giftCount: gifts.length
    })
    this.hideForm()

    wx.showToast({
      title: '已删除',
      icon: 'success'
    })
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
    const gifts = this.data.gifts.map((gift) => gift.id === id
      ? Object.assign({}, gift, { imageAvailable: false })
      : gift)

    this.setData({
      gifts
    })
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
