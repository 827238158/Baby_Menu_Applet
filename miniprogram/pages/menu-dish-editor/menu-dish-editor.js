const api = require('../../services/menu-api')
const { validateDishForm } = require('../../services/menu-admin-validation')

const clone = (value) => JSON.parse(JSON.stringify(value))
const uid = (prefix) => `${prefix}_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 9)}`
const confirm = (content, options = {}) => new Promise((resolve) => wx.showModal({
  title: '菜品编辑', content, ...options,
  success: (result) => resolve(Boolean(result.confirm)), fail: () => resolve(false)
}))

function normalizeDish(source, firstCategoryId) {
  const dish = clone(source || {})
  dish.id = dish.id || uid('dish')
  dish.name = String(dish.name || '')
  dish.desc = String(dish.desc || '')
  dish.price = '0'
  dish.categoryId = dish.categoryId || firstCategoryId || ''
  dish.enabled = dish.enabled !== false
  dish.tags = Array.isArray(dish.tags) ? dish.tags.slice() : []
  dish.options = (dish.options || []).map((option) => {
    const next = { ...option, id: option.id || uid('option'), name: String(option.name || ''), required: Boolean(option.required) }
    if (option.type === 'text') {
      next.type = 'text'
      next.maxlength = option.maxlength == null ? 40 : option.maxlength
      next.placeholder = String(option.placeholder || '')
      delete next.choices
    } else {
      delete next.type
      next.choices = (option.choices || []).map((choice) => typeof choice === 'string'
        ? { id: choice, name: choice }
        : { ...choice, id: choice.id || uid('choice'), name: String(choice.name || '') })
    }
    return next
  })
  dish.imageAssetId = String(dish.imageAssetId || '')
  return dish
}

function cleanDish(source) {
  const dish = clone(source)
  dish.name = dish.name.trim()
  dish.desc = dish.desc.trim()
  dish.price = '0'
  dish.tags = (dish.tags || []).map((tag) => String(tag).trim()).filter(Boolean)
  dish.options = (dish.options || []).map((option) => {
    const next = { ...option, name: String(option.name || '').trim(), required: Boolean(option.required) }
    if (option.type === 'text') {
      next.maxlength = Number(option.maxlength)
      next.placeholder = String(option.placeholder || '').trim()
    } else {
      next.choices = (option.choices || []).map((choice) => ({ ...choice, name: String(choice.name || '').trim() }))
    }
    return next
  })
  return dish
}

Page({
  data: {
    ready: false,
    mode: 'edit',
    dish: null,
    categories: [],
    categoryNames: [],
    categoryIndex: 0,
    tagsText: '',
    images: {},
    imageUrl: '',
    imageLoading: false,
    imageLoadFailed: false,
    uploading: false,
    dirty: false,
    error: '',
    fieldErrors: {}
  },

  onLoad() {
    this._channel = typeof this.getOpenerEventChannel === 'function' ? this.getOpenerEventChannel() : null
    if (this._channel && this._channel.on) this._channel.on('dishEditor:init', (payload) => this.initialize(payload))
  },

  onUnload() { this._closed = true },

  initialize(payload = {}) {
    const categories = clone(payload.categories || [])
    const mode = payload.mode === 'create' || payload.isNew ? 'create' : 'edit'
    const dish = normalizeDish(payload.dish, categories[0] && categories[0].id)
    const categoryIndex = Math.max(0, categories.findIndex((category) => category.id === dish.categoryId))
    const images = clone(payload.images || {})
    this._newAssets = {}
    this._newImages = {}
    this._initial = JSON.stringify(dish)
    const validation = payload.focusField && !payload.focusMessage
      ? validateDishForm(dish, categories.map((category) => category.id))
      : null
    const focusMessage = String(payload.focusMessage || (validation && validation.fieldId === payload.focusField ? validation.message : '') || '')
    const fieldErrors = payload.focusField && focusMessage ? { [payload.focusField]: focusMessage } : {}
    this.setData({
      ready: true, mode, dish, categories,
      categoryNames: categories.map((category) => category.name), categoryIndex,
      tagsText: dish.tags.join('，'), images,
      imageUrl: images[dish.imageAssetId] || '', imageLoading: false, imageLoadFailed: false,
      dirty: false, error: focusMessage, fieldErrors
    })
    if (wx.setNavigationBarTitle) wx.setNavigationBarTitle({ title: mode === 'create' ? '新增菜品' : '编辑菜品' })
    if (wx.disableAlertBeforeUnload) wx.disableAlertBeforeUnload()
    if (payload.focusField) this.scrollToField(payload.focusField)
    if (dish.imageAssetId && !images[dish.imageAssetId]) this.loadExistingImage(dish.imageAssetId)
  },

  markChanged(fieldId) {
    const fieldErrors = { ...this.data.fieldErrors }
    if (fieldId) delete fieldErrors[fieldId]
    this.setData({ dirty: true, fieldErrors, error: '' })
    if (wx.enableAlertBeforeUnload) wx.enableAlertBeforeUnload({ message: '菜品修改尚未完成，确定放弃并退出？' })
  },

  changeField(event) {
    if (this.data.uploading || !this.data.dish) return
    const { field, fieldId } = event.currentTarget.dataset
    if (!field) return
    this.setData({ [`dish.${field}`]: event.detail.value })
    this.markChanged(fieldId)
  },

  changeTags(event) {
    if (this.data.uploading) return
    const tagsText = event.detail.value
    this.setData({ tagsText, 'dish.tags': tagsText.split(/[,，\n]/).map((value) => value.trim()).filter(Boolean) })
    this.markChanged('dish-tags')
  },

  chooseCategory(event) {
    if (this.data.uploading) return
    const categoryIndex = Number(event.detail.value)
    const category = this.data.categories[categoryIndex]
    if (!category) return
    this.setData({ categoryIndex, 'dish.categoryId': category.id })
    this.markChanged('dish-category')
  },

  changeOptionField(event) {
    if (this.data.uploading) return
    const { index, field, fieldId } = event.currentTarget.dataset
    const optionIndex = Number(index)
    if (!this.data.dish.options[optionIndex] || !field) return
    this.setData({ [`dish.options[${optionIndex}].${field}`]: event.detail.value })
    this.markChanged(fieldId)
  },

  changeChoice(event) {
    if (this.data.uploading) return
    const optionIndex = Number(event.currentTarget.dataset.option)
    const choiceIndex = Number(event.currentTarget.dataset.choice)
    if (!this.data.dish.options[optionIndex] || !this.data.dish.options[optionIndex].choices[choiceIndex]) return
    this.setData({ [`dish.options[${optionIndex}].choices[${choiceIndex}].name`]: event.detail.value })
    this.markChanged(`option-${optionIndex}-choice-${choiceIndex}`)
  },

  addOption(event) {
    if (this.data.uploading) return
    const options = this.data.dish.options.slice()
    options.push(event.currentTarget.dataset.type === 'text'
      ? { id: uid('option'), name: '备注', type: 'text', required: false, maxlength: 40, placeholder: '' }
      : { id: uid('option'), name: '', required: true, choices: [{ id: uid('choice'), name: '' }] })
    this.setData({ 'dish.options': options })
    this.markChanged()
  },

  removeOption(event) {
    if (this.data.uploading) return
    const index = Number(event.currentTarget.dataset.index)
    if (!this.data.dish.options[index]) return
    this.setData({ 'dish.options': this.data.dish.options.filter((_, optionIndex) => optionIndex !== index) })
    this.markChanged()
  },

  addChoice(event) {
    if (this.data.uploading) return
    const index = Number(event.currentTarget.dataset.index)
    const option = this.data.dish.options[index]
    if (!option || option.type === 'text') return
    this.setData({ [`dish.options[${index}].choices`]: option.choices.concat({ id: uid('choice'), name: '' }) })
    this.markChanged(`option-${index}-choices`)
  },

  removeChoice(event) {
    if (this.data.uploading) return
    const optionIndex = Number(event.currentTarget.dataset.option)
    const choiceIndex = Number(event.currentTarget.dataset.choice)
    const option = this.data.dish.options[optionIndex]
    if (!option || option.type === 'text' || !option.choices[choiceIndex]) return
    this.setData({ [`dish.options[${optionIndex}].choices`]: option.choices.filter((_, index) => index !== choiceIndex) })
    this.markChanged(`option-${optionIndex}-choices`)
  },

  async chooseImage() {
    if (this.data.uploading) return
    this.setData({ uploading: true, imageLoading: false, imageLoadFailed: false, error: '' })
    try {
      const source = await new Promise((resolve, reject) => wx.showActionSheet({
        itemList: ['拍照', '从相册选择'],
        success: (result) => resolve(result.tapIndex === 0 ? 'camera' : 'album'), fail: reject
      }))
      const picked = await new Promise((resolve, reject) => wx.chooseMedia({
        count: 1, mediaType: ['image'], sourceType: [source], success: resolve, fail: reject
      }))
      const filePath = picked.tempFiles[0].tempFilePath
      const asset = await api.uploadImage(filePath)
      if (this._closed) return
      const metadata = { imageKey: asset.imageKey, thumbnailKey: asset.thumbnailKey }
      this._newAssets[asset.assetId] = metadata
      this._newImages[asset.assetId] = filePath
      this.setData({
        'dish.imageAssetId': asset.assetId,
        [`images.${asset.assetId}`]: filePath,
        imageUrl: filePath
      })
      this.markChanged('dish-image')
    } catch (error) {
      if (!/cancel/.test(error && error.errMsg || '')) this.setData({ error: error.message || '图片上传失败，请重试' })
    } finally {
      if (!this._closed) this.setData({ uploading: false })
    }
  },

  async removeImage() {
    if (this.data.uploading || !this.data.dish.imageAssetId) return
    if (!await confirm('从当前菜品移除此图片？已发布历史仍会保留原图。')) return
    this.setData({ 'dish.imageAssetId': '', imageUrl: '', imageLoading: false, imageLoadFailed: false })
    this.markChanged('dish-image')
  },

  async loadExistingImage(assetId, force = false) {
    if (!assetId || !api.resolveAsset || (!force && this.data.imageUrl)) return
    this.setData({ imageLoading: true, imageLoadFailed: false })
    try {
      const result = await api.resolveAsset(assetId, true)
      const url = typeof result === 'string' ? result : result.thumbnailUrl || result.url || result.imageUrl
      if (!url) throw new Error('图片地址不可用')
      if (!this._closed && this.data.dish && this.data.dish.imageAssetId === assetId) this.setData({ imageUrl: url, [`images.${assetId}`]: url, imageLoadFailed: false })
    } catch (_) {
      if (!this._closed && this.data.dish && this.data.dish.imageAssetId === assetId) this.setData({ imageLoadFailed: true })
    } finally {
      if (!this._closed && this.data.dish && this.data.dish.imageAssetId === assetId) this.setData({ imageLoading: false })
    }
  },

  handleImageError() {
    const assetId = this.data.dish && this.data.dish.imageAssetId
    if (!assetId || this._imageRetried === assetId) return this.setData({ imageUrl: '', imageLoadFailed: true })
    this._imageRetried = assetId
    this.setData({ imageUrl: '' })
    this.loadExistingImage(assetId, true)
  },

  showProblem(problem) {
    this.setData({ fieldErrors: { [problem.fieldId]: problem.message }, error: problem.message })
    this.scrollToField(problem.fieldId)
  },

  scrollToField(fieldId) {
    const scroll = () => wx.pageScrollTo && wx.pageScrollTo({ selector: `#${fieldId}`, duration: 240 })
    if (wx.nextTick) wx.nextTick(scroll)
    else scroll()
  },

  complete() {
    if (this.data.uploading || !this.data.dish) return
    const dish = cleanDish(this.data.dish)
    const problem = validateDishForm(dish, this.data.categories.map((category) => category.id))
    if (problem) return this.showProblem(problem)
    // 完成时才把编辑副本和本次新增资产交回管理页。
    const assetId = dish.imageAssetId
    const assets = assetId && this._newAssets && this._newAssets[assetId] ? { [assetId]: this._newAssets[assetId] } : {}
    const images = assetId && this._newImages && this._newImages[assetId] ? { [assetId]: this._newImages[assetId] } : {}
    if (this._channel && this._channel.emit) this._channel.emit('dishEditor:commit', {
      dish,
      assets: clone(assets),
      images: clone(images)
    })
    this._completed = true
    if (wx.disableAlertBeforeUnload) wx.disableAlertBeforeUnload()
    if (wx.navigateBack) wx.navigateBack()
  },

  async deleteDish() {
    if (this.data.uploading || this.data.mode !== 'edit' || !this.data.dish) return
    if (!await confirm('删除后需保存草稿并发布才会影响公开菜单，确定删除？', {
      confirmText: '删除', confirmColor: '#d14343', cancelColor: '#576b95'
    })) return
    if (this._channel && this._channel.emit) this._channel.emit('dishEditor:delete', this.data.dish.id)
    this._completed = true
    if (wx.disableAlertBeforeUnload) wx.disableAlertBeforeUnload()
    if (wx.navigateBack) wx.navigateBack()
  }
})
