const api = require('../../services/menu-api')
const { validateDocument } = require('../../services/menu-document')
const { validateDishForm } = require('../../services/menu-admin-validation')
const { coverLayout, dragPosition } = require('../../services/menu-header')

const clone = (value) => JSON.parse(JSON.stringify(value))
const uid = (prefix) => `${prefix}_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 9)}`
const confirm = (content, options = {}) => new Promise((resolve) => wx.showModal({
  title: '菜单管理', content, ...options,
  success: (result) => resolve(Boolean(result.confirm)), fail: () => resolve(false)
}))

function normalizeDocument(source) {
  const document = clone(source)
  document.categories.sort((left, right) => (left.order || 0) - (right.order || 0))
  document.dishes.sort((left, right) => (left.order || 0) - (right.order || 0))
  document.dishes.forEach((dish) => {
    dish.tags = dish.tags || []
    dish.options = dish.options || []
    dish.options.forEach((option) => {
      if (option.type !== 'text') option.choices = (option.choices || []).map((choice) => typeof choice === 'string' ? { id: choice, name: choice } : choice)
    })
  })
  return document
}

Page({
  data: {
    ready: false, denied: false, loading: true, busy: false, error: '', conflict: false,
    tab: 'dishes', tabIndex: 0, revision: 0, document: null, dirty: false,
    saving: false, reloading: false, restoringVersion: '', statusKind: 'unknown', statusText: '正在确认版本状态…',
    images: {}, history: [], nextCursor: '', historyLoaded: false, historyLoading: false,
    moving: false, moveStyles: {}, sortMode: false,
    visibleDishes: [], categoryViews: [], categoryFilters: [{ id: '', name: '全部分类' }], categoryFilterIndex: 0,
    selectedCategoryId: '', searchQuery: '', expandedCategoryId: '', newCategoryId: '', invalidField: '',
    headerStyle: '', headerLoaded: false, headerAdjusting: false, headerDragging: false,
    tabs: [{ id: 'dishes', name: '菜品' }, { id: 'categories', name: '分类' }, { id: 'shop', name: '页面设置' }, { id: 'history', name: '发布历史' }]
  },

  async onLoad() {
    this._closed = false
    this.setData({ loading: true, error: '', denied: false })
    // 权限通过前不读取草稿或任何管理缓存。
    try {
      const access = await api.access()
      if (access && (access.allowed === false || access.canEdit === false)) throw Object.assign(new Error('仅限两位受邀用户管理菜单'), { statusCode: 403 })
      await this.loadDraft()
      this.setData({ ready: true })
    } catch (error) {
      this.setData({ denied: error.statusCode === 403 || error.status === 403 || /FORBIDDEN|NOT_ALLOWED/.test(error.code || ''), error: error.message || '暂时无法连接，请重试' })
    } finally {
      if (!this._closed) this.setData({ loading: false })
    }
  },

  onShow() {
    if (!this.data.ready) return
    if (this.data.dirty) {
      if (wx.enableAlertBeforeUnload) wx.enableAlertBeforeUnload({ message: '修改尚未保存，确定放弃修改并退出？' })
    } else this.refreshPublishState()
  },

  onUnload() {
    this._closed = true
    this._statusEpoch = (this._statusEpoch || 0) + 1
    clearTimeout(this._moveTimer)
    if (this._finishMove) this._finishMove()
  },

  onHide() {
    this.headerTouchCancel()
    if (this.data.headerAdjusting) this.setData({ headerAdjusting: false })
  },

  onResize() {
    this.headerTouchCancel()
    this.measureHeader()
  },

  async loadDraft() {
    this.adoptDraft(await api.getDraft())
  },

  adoptDraft(draft) {
    this._headerDrag = null
    this._headerSize = null
    const document = normalizeDocument(draft.document)
    this.setData({
      document, revision: draft.revision, dirty: false, conflict: false, error: '', invalidField: '',
      headerLoaded: false, headerAdjusting: false, headerDragging: false, headerStyle: '',
      statusKind: 'unknown', statusText: '正在确认版本状态…'
    })
    this.refreshViews()
    if (wx.disableAlertBeforeUnload) wx.disableAlertBeforeUnload()
    this.loadImages()
    this.refreshPublishState()
  },

  refreshViews() {
    const document = this.data.document
    if (!document) return
    const categoryNames = new Map(document.categories.map((category) => [category.id, category.name]))
    let selectedCategoryId = this.data.selectedCategoryId
    if (selectedCategoryId && !categoryNames.has(selectedCategoryId)) selectedCategoryId = ''
    const categoryFilters = [{ id: '', name: '全部分类' }].concat(document.categories.map((category) => ({ id: category.id, name: category.name || '未命名分类' })))
    const categoryFilterIndex = Math.max(0, categoryFilters.findIndex((category) => category.id === selectedCategoryId))
    const query = String(this.data.searchQuery || '').trim().toLocaleLowerCase()
    const visibleDishes = document.dishes.filter((dish) => {
      if (selectedCategoryId && dish.categoryId !== selectedCategoryId) return false
      if (!query) return true
      const haystack = [dish.name, dish.desc].concat(dish.tags || []).join('\n').toLocaleLowerCase()
      return haystack.includes(query)
    }).map((dish) => ({ ...dish, categoryName: categoryNames.get(dish.categoryId) || '未分类' }))
    const categoryViews = document.categories.map((category) => ({ ...category, dishCount: document.dishes.filter((dish) => dish.categoryId === category.id).length }))
    this.setData({ selectedCategoryId, categoryFilters, categoryFilterIndex, visibleDishes, categoryViews })
  },

  async refreshPublishState() {
    if (!this.data.document || this.data.dirty) return
    const epoch = (this._statusEpoch || 0) + 1
    this._statusEpoch = epoch
    const documentText = JSON.stringify(this.data.document)
    this.setData({ statusKind: 'unknown', statusText: '正在确认版本状态…' })
    try {
      const current = await api.getMenu()
      if (this._closed || epoch !== this._statusEpoch || this.data.dirty || JSON.stringify(this.data.document) !== documentText) return
      if (!current || !current.version) throw new Error('当前发布版本不可用')
      // 公开接口会隐藏下架菜品；必须读取完整发布快照，才能识别隐藏菜品的待发布修改。
      const release = await api.getRelease(current.version)
      if (this._closed || epoch !== this._statusEpoch || this.data.dirty || JSON.stringify(this.data.document) !== documentText) return
      const published = release && release.document && JSON.stringify(normalizeDocument(release.document)) === documentText
      this.setData({ statusKind: published ? 'published' : 'saved', statusText: published ? '当前已是最新版本' : '草稿已保存，待发布' })
    } catch (error) {
      if (this._closed || epoch !== this._statusEpoch || this.data.dirty || JSON.stringify(this.data.document) !== documentText) return
      const unpublished = error && (error.statusCode === 404 || error.status === 404 || error.code === 'MENU_NOT_PUBLISHED')
      this.setData({ statusKind: unpublished ? 'saved' : 'unknown', statusText: unpublished ? '草稿已保存，待首次发布' : '已保存，发布状态待确认' })
    }
  },

  markChanged() {
    this._statusEpoch = (this._statusEpoch || 0) + 1
    this.setData({ dirty: true, statusKind: 'dirty', statusText: '草稿未同步', invalidField: '' })
    if (wx.enableAlertBeforeUnload) wx.enableAlertBeforeUnload({ message: '修改尚未保存，确定放弃修改并退出？' })
  },

  async loadImages() {
    const document = this.data.document
    if (!document) return
    const ids = [...new Set(document.dishes.map((dish) => dish.imageAssetId)
      .concat(['headerBackgroundImage', 'pageBackgroundImage', 'shareImage'].map((field) => document.shop[field])).filter(Boolean))]
    await Promise.all(ids.map(async (id) => {
      try {
        const result = await api.resolveAsset(id, true)
        if (!this._closed) this.setData({ [`images.${id}`]: typeof result === 'string' ? result : result.thumbnailUrl || result.url || result.imageUrl })
      } catch (_) { /* 图片失败不丢弃可编辑草稿，重新加载时可重试。 */ }
    }))
  },

  async imageError(event) {
    const id = event.currentTarget.dataset.asset
    if (this.data.document && id === this.data.document.shop.headerBackgroundImage) this.setData({ headerLoaded: false })
    if (!id || (this._imageRetried || {})[id]) return
    this._imageRetried = this._imageRetried || {}
    this._imageRetried[id] = true
    try {
      const asset = await api.resolveAsset(id, true)
      const url = typeof asset === 'string' ? asset : asset.thumbnailUrl || asset.url || asset.imageUrl
      const local = await new Promise((resolve, reject) => wx.downloadFile({ url, success: (result) => result.statusCode === 200 ? resolve(result.tempFilePath) : reject(new Error('图片暂不可用')), fail: reject }))
      if (!this._closed) this.setData({ [`images.${id}`]: local })
    } catch (_) { /* 下载失败保留表单与图片引用，稍后重新加载可重试。 */ }
  },

  switchTab(event) {
    if (this.data.busy || this.data.moving) return
    const tab = event.currentTarget.dataset.tab
    const tabIndex = this.data.tabs.findIndex((item) => item.id === tab)
    if (tabIndex < 0 || tab === this.data.tab) return
    this.headerTouchCancel()
    this.setData({ tab, tabIndex, sortMode: false, headerAdjusting: false, invalidField: '' })
    if (tab === 'history') {
      this.setData({ history: [], nextCursor: '', historyLoaded: false })
      if (!this._historyLoading) this.loadHistory()
    }
  },

  openMore() {
    if (this.data.busy || this.data.moving) return
    wx.showActionSheet({ itemList: ['重新加载云端草稿'], success: (result) => { if (result.tapIndex === 0) this.reload() } })
  },

  changeSearch(event) {
    this.setData({ searchQuery: event.detail.value })
    this.refreshViews()
  },

  changeCategoryFilter(event) {
    const categoryFilterIndex = Number(event.detail.value)
    const category = this.data.categoryFilters[categoryFilterIndex]
    if (!category) return
    this.setData({ selectedCategoryId: category.id, categoryFilterIndex })
    this.refreshViews()
  },

  toggleSortMode() {
    if (this.data.busy || this.data.moving) return
    const sortMode = !this.data.sortMode
    this.setData({ sortMode, searchQuery: sortMode ? '' : this.data.searchQuery, selectedCategoryId: sortMode ? '' : this.data.selectedCategoryId, expandedCategoryId: '' })
    this.refreshViews()
  },

  stopTap() {},

  changeField(event) {
    if (this.data.busy) return
    const path = event.currentTarget.dataset.path
    if (!path) return
    this.setData({ [path]: event.detail.value })
    this.markChanged()
    if (/^document\.shop\.(name|subtitle)$/.test(path)) this.measureHeader()
  },

  changeCategoryName(event) {
    if (this.data.busy || this.data.moving) return
    const id = event.currentTarget.dataset.id
    const index = this.data.document.categories.findIndex((category) => category.id === id)
    if (index < 0) return
    this.setData({ [`document.categories[${index}].name`]: event.detail.value, newCategoryId: '' })
    this.markChanged()
    this.refreshViews()
  },

  toggleCategory(event) {
    if (this.data.sortMode || this.data.busy || this.data.moving) return
    const id = event.currentTarget.dataset.id
    this.setData({ expandedCategoryId: this.data.expandedCategoryId === id ? '' : id, newCategoryId: '' })
  },

  addDish() {
    if (this.data.busy || this.data.moving) return
    if (!this.data.document.categories.length) return wx.showToast({ title: '请先新增分类', icon: 'none' })
    const dishes = this.data.document.dishes
    const dish = { id: uid('dish'), name: '', desc: '', price: '0', categoryId: this.data.document.categories[0].id, order: dishes.length, enabled: true, tags: [], options: [], imageAssetId: '' }
    this.navigateDishEditor(dish, 'create')
  },

  openDish(event) {
    if (this.data.sortMode || this.data.busy || this.data.moving) return
    const dish = this.data.document.dishes.find((item) => item.id === event.currentTarget.dataset.id)
    if (dish) this.navigateDishEditor(dish, 'edit')
  },

  navigateDishEditor(source, mode, focusField = '', focusMessage = '') {
    const originalId = source.id
    const imageUrl = source.imageAssetId && this.data.images[source.imageAssetId]
    const payload = {
      mode, dish: clone(source), categories: clone(this.data.document.categories), images: imageUrl ? { [source.imageAssetId]: imageUrl } : {},
      focusField, focusMessage
    }
    wx.navigateTo({
      url: '/pages/menu-dish-editor/menu-dish-editor',
      events: {
        'dishEditor:commit': (result) => this.applyDishCommit(result, mode, originalId),
        'dishEditor:delete': (id) => this.applyDishDelete(id)
      },
      success: (result) => result.eventChannel.emit('dishEditor:init', payload),
      fail: () => wx.showToast({ title: '暂时无法打开菜品编辑', icon: 'none' })
    })
  },

  applyDishCommit(result, mode, originalId) {
    if (!result || !result.dish || !this.data.document) return
    const categoryIds = this.data.document.categories.map((category) => category.id)
    const problem = validateDishForm(result.dish, categoryIds)
    if (problem) return wx.showToast({ title: problem.message, icon: 'none' })
    const dishes = this.data.document.dishes.slice()
    if (mode === 'edit') {
      const index = dishes.findIndex((dish) => dish.id === originalId)
      if (index < 0) return wx.showToast({ title: '菜品已不存在，请重新加载', icon: 'none' })
      dishes[index] = { ...clone(result.dish), id: originalId, order: dishes[index].order, price: '0' }
    } else {
      const id = dishes.some((dish) => dish.id === originalId) ? uid('dish') : originalId
      dishes.push({ ...clone(result.dish), id, order: dishes.length, price: '0' })
    }
    this.setData({
      'document.dishes': dishes,
      'document.assets': { ...this.data.document.assets, ...(result.assets || {}) },
      images: { ...this.data.images, ...(result.images || {}) },
      searchQuery: '', selectedCategoryId: '', categoryFilterIndex: 0
    })
    this.markChanged()
    this.refreshViews()
    const index = mode === 'edit' ? dishes.findIndex((dish) => dish.id === originalId) : dishes.length - 1
    this.scrollToRow(`#dish-row-${index}`)
  },

  applyDishDelete(id) {
    if (!id || !this.data.document) return
    const dishes = this.data.document.dishes.filter((dish) => dish.id !== id).map((dish, order) => ({ ...dish, order }))
    if (dishes.length === this.data.document.dishes.length) return
    this.setData({ 'document.dishes': dishes })
    this.markChanged()
    this.refreshViews()
  },

  addCategory() {
    if (this.data.busy || this.data.moving) return
    const category = { id: uid('category'), name: '', order: this.data.document.categories.length }
    this.setData({ 'document.categories': this.data.document.categories.concat(category), expandedCategoryId: category.id, newCategoryId: category.id, sortMode: false })
    this.markChanged()
    this.refreshViews()
    this.scrollToRow(`#category-row-${this.data.document.categories.length - 1}`)
  },

  scrollToRow(selector) {
    const scroll = () => { if (!this._closed && wx.pageScrollTo) wx.pageScrollTo({ selector, duration: 240 }) }
    if (wx.nextTick) wx.nextTick(scroll)
    else setTimeout(scroll, 0)
  },

  async removeRow(event) {
    if (this.data.busy || this.data.moving) return
    const { kind, index } = event.currentTarget.dataset
    const rows = this.data.document[kind]
    if (kind !== 'categories' || !rows || !rows[index]) return
    const id = rows[index].id
    this.setData({ busy: true })
    try {
      if (!await confirm('删除该分类会将分类下所有菜品一并删除', { confirmText: '确定', confirmColor: '#d14343', cancelColor: '#576b95' }) || this._closed) return
      const categories = rows.filter((row) => row.id !== id).map((row, order) => ({ ...row, order }))
      const dishes = this.data.document.dishes.filter((dish) => dish.categoryId !== id).map((dish, order) => ({ ...dish, order }))
      this.setData({ 'document.categories': categories, 'document.dishes': dishes, expandedCategoryId: '', newCategoryId: '' })
      this.markChanged()
      this.refreshViews()
    } finally {
      if (!this._closed) this.setData({ busy: false })
    }
  },

  async moveRow(event) {
    if (this.data.busy || this.data.moving || !this.data.sortMode) return
    const { kind, index, delta } = event.currentTarget.dataset
    const rows = this.data.document[kind].slice()
    const from = Number(index)
    const to = from + Number(delta)
    if (!Number.isInteger(from) || !rows[from] || ![-1, 1].includes(Number(delta)) || to < 0 || to >= rows.length) return
    this.setData({ moving: true })
    // 继续复用已验证的相邻换位动画，不引入不稳定的长列表拖拽。
    if (kind === 'dishes' && typeof this.createSelectorQuery === 'function') {
      await new Promise((resolve) => {
        let settled = false
        const finish = () => { if (settled) return; settled = true; clearTimeout(this._moveTimer); this._finishMove = null; resolve() }
        this._finishMove = finish
        this._moveTimer = setTimeout(finish, 500)
        try {
          const query = this.createSelectorQuery()
          query.select(`#dish-row-${from}`).boundingClientRect()
          query.select(`#dish-row-${to}`).boundingClientRect()
          query.exec((rects) => {
            if (settled || this._closed) return finish()
            const [first, second] = rects || []
            if (!first || !second || ![first.top, first.bottom, first.height, second.top, second.bottom, second.height].every(Number.isFinite)) return finish()
            const gap = from < to ? second.top - first.bottom : first.top - second.bottom
            const direction = from < to ? 1 : -1
            this.setData({ moveStyles: {
              [rows[from].id]: `transform: translateY(${direction * (second.height + gap)}px); transition: transform 240ms ease-in-out;`,
              [rows[to].id]: `transform: translateY(${-direction * (first.height + gap)}px); transition: transform 240ms ease-in-out;`
            } })
            clearTimeout(this._moveTimer)
            this._moveTimer = setTimeout(finish, 260)
          })
        } catch (_) { finish() }
      })
    }
    if (this._closed) return
    ;[rows[from], rows[to]] = [rows[to], rows[from]]
    rows.forEach((row, order) => { row.order = order })
    this.setData({ [`document.${kind}`]: rows, moving: false, moveStyles: {} })
    this.markChanged()
    this.refreshViews()
  },

  headerLoad(event) {
    const id = event.currentTarget.dataset.asset
    if (!this.data.document || id !== this.data.document.shop.headerBackgroundImage || (event.currentTarget.dataset.src && event.currentTarget.dataset.src !== this.data.images[id])) return
    const { width, height } = event.detail
    if (!(width > 0 && height > 0)) return
    this._headerSize = { width, height }
    this.measureHeader()
  },

  measureHeader() {
    if (!this.data.document || !this._headerSize || typeof this.createSelectorQuery !== 'function') return
    const id = this.data.document.shop.headerBackgroundImage
    const measure = () => this.createSelectorQuery().select('#header-preview').boundingClientRect((box) => {
      if (this._closed || !this.data.document || !box || !(box.width > 0 && box.height > 0) || id !== this.data.document.shop.headerBackgroundImage) return
      this._headerBox = box
      this.updateHeaderLayout()
      this.setData({ headerLoaded: true })
    }).exec()
    if (wx.nextTick) wx.nextTick(measure)
    else measure()
  },

  updateHeaderLayout(position = this.data.document.shop.headerBackgroundPosition) {
    if (!this._headerSize || !this._headerBox) return
    this._headerLayout = coverLayout(this._headerSize.width, this._headerSize.height, this._headerBox.width, this._headerBox.height, position)
    if (this._headerLayout) this.setData({ headerStyle: this._headerLayout.style })
  },

  toggleHeaderAdjust() {
    if (this.data.busy || !this.data.headerLoaded) return
    if (this.data.headerDragging) this.headerTouchCancel()
    this.setData({ headerAdjusting: !this.data.headerAdjusting })
  },

  headerTouchStart(event) {
    if (!this.data.headerAdjusting || this.data.busy || !this.data.headerLoaded || !this._headerLayout) return
    const touch = (event.touches || [])[0]
    if (!touch) return
    this._headerDrag = { x: touch.clientX, y: touch.clientY, layout: this._headerLayout, original: this.data.document.shop.headerBackgroundPosition }
    this.setData({ headerDragging: true })
  },

  headerTouchMove(event) {
    const drag = this._headerDrag
    const touch = (event.touches || [])[0]
    if (!drag || !touch) return
    const dx = touch.clientX - drag.x
    const dy = touch.clientY - drag.y
    if (!dx && !dy) return
    drag.position = dragPosition(drag.layout, dx, dy)
    this.updateHeaderLayout(drag.position)
  },

  headerTouchEnd() {
    const drag = this._headerDrag
    if (!drag) return
    this._headerDrag = null
    this.setData({ headerDragging: false })
    if (drag.position && (Math.abs(this._headerLayout.left - drag.layout.left) > .01 || Math.abs(this._headerLayout.top - drag.layout.top) > .01)) {
      this.setData({ 'document.shop.headerBackgroundPosition': drag.position })
      this.markChanged()
    } else this.updateHeaderLayout(drag.original)
  },

  headerTouchCancel() {
    const drag = this._headerDrag
    this._headerDrag = null
    this.setData({ headerDragging: false })
    if (drag) this.updateHeaderLayout(drag.original)
  },

  async chooseImage(event) {
    if (this.data.busy || this.data.moving) return
    const path = event.currentTarget.dataset.path
    this.setData({ busy: true, error: '' })
    try {
      const source = await new Promise((resolve, reject) => wx.showActionSheet({ itemList: ['拍照', '从相册选择'], success: (result) => resolve(result.tapIndex === 0 ? 'camera' : 'album'), fail: reject }))
      const picked = await new Promise((resolve, reject) => wx.chooseMedia({ count: 1, mediaType: ['image'], sourceType: [source], success: resolve, fail: reject }))
      const filePath = picked.tempFiles[0].tempFilePath
      const asset = await api.uploadImage(filePath)
      if (path === 'document.shop.headerBackgroundImage') {
        this.headerTouchCancel()
        this._headerSize = null
        this.setData({ headerLoaded: false, headerAdjusting: false, headerStyle: '', 'document.shop.headerBackgroundPosition': '50% 50%' })
      }
      this.setData({ [`document.assets.${asset.assetId}`]: { imageKey: asset.imageKey, thumbnailKey: asset.thumbnailKey }, [path]: asset.assetId, [`images.${asset.assetId}`]: filePath })
      this.markChanged()
    } catch (error) {
      if (!/cancel/.test(error.errMsg || '')) this.reportError(error)
    } finally {
      if (!this._closed) this.setData({ busy: false })
    }
  },

  async removeImage(event) {
    if (this.data.busy || this.data.moving || !await confirm('从当前草稿移除此图片？已发布历史仍会保留原图。')) return
    const path = event.currentTarget.dataset.path
    if (path === 'document.shop.headerBackgroundImage') {
      this.headerTouchCancel()
      this._headerSize = null
      this.setData({ headerLoaded: false, headerAdjusting: false, headerStyle: '' })
    }
    this.setData({ [path]: '' })
    this.markChanged()
  },

  validate() {
    const document = this.data.document
    if (!String(document.shop.name || '').trim()) return { message: '请填写店名', tab: 'shop', fieldId: 'shop.name' }
    const emptyCategory = document.categories.find((category) => !String(category.name || '').trim())
    if (emptyCategory) return { message: '请填写所有分类名称', tab: 'categories', fieldId: emptyCategory.id }
    const categoryIds = document.categories.map((category) => category.id)
    for (const dish of document.dishes) {
      const problem = validateDishForm(dish, categoryIds)
      if (problem) return { ...problem, tab: 'dishes', dishId: dish.id }
    }
    return null
  },

  showValidationProblem(problem) {
    wx.showToast({ title: problem.message, icon: 'none' })
    if (problem.dishId) {
      const dish = this.data.document.dishes.find((item) => item.id === problem.dishId)
      if (dish) this.navigateDishEditor(dish, 'edit', problem.fieldId, problem.message)
      return
    }
    const tabIndex = this.data.tabs.findIndex((item) => item.id === problem.tab)
    this.setData({ tab: problem.tab, tabIndex, sortMode: false, invalidField: problem.fieldId, expandedCategoryId: problem.tab === 'categories' ? problem.fieldId : this.data.expandedCategoryId })
    const selector = problem.tab === 'categories' ? `#category-row-${this.data.document.categories.findIndex((category) => category.id === problem.fieldId)}` : '.is-invalid'
    this.scrollToRow(selector)
  },

  reportError(error) {
    if (error.statusCode === 401 || error.statusCode === 403) {
      this.setData({ ready: false, denied: true, document: null, images: {}, history: [], dirty: false, error: '仅限两位受邀用户管理菜单' })
      if (wx.disableAlertBeforeUnload) wx.disableAlertBeforeUnload()
      return
    }
    if (error.code === 'MENU_BUSY') {
      this.setData({ conflict: false, error: '菜单正在同步，请稍后重试。你的本地修改已保留。' })
      return
    }
    const conflict = error.statusCode === 409 || error.status === 409 || /CONFLICT|REVISION/.test(error.code || '')
    this.setData({ error: conflict ? '另一位编辑者已修改共享草稿。你的本地修改已保留，请记录修改后重新加载最新草稿。' : error.message || '操作失败，请重试', conflict })
  },

  async saveDraft() {
    if (this.data.busy || this.data.moving || !this.data.dirty) return !this.data.dirty
    const problem = this.validate()
    if (problem) { this.showValidationProblem(problem); return false }
    this.setData({ busy: true, saving: true, error: '' })
    try {
      const document = clone(this.data.document)
      document.dishes.forEach((dish) => { dish.price = '0'; dish.options.forEach((option) => { if (option.type === 'text') option.maxlength = Number(option.maxlength) || 40 }) })
      validateDocument(document)
      const result = await api.saveDraft(this.data.revision, document)
      this.adoptDraft(result.document ? result : { revision: result.revision, document })
      wx.showToast({ title: '已保存共享草稿', icon: 'success' })
      return true
    } catch (error) {
      this.reportError(error)
      return false
    } finally {
      if (!this._closed) this.setData({ busy: false, saving: false })
    }
  },

  async preview() {
    if (this.data.busy || this.data.moving) return
    if (this.data.dirty && !await this.saveDraft()) return
    wx.navigateTo({ url: '/pages/menu-preview/menu-preview' })
  },

  async reload() {
    if (this.data.busy || this.data.moving) return
    if (this.data.dirty && !await confirm('重新加载会丢弃尚未保存的本地修改，确定继续？')) return
    this.setData({ busy: true, reloading: true })
    try {
      await this.loadDraft()
    } catch (error) {
      this.reportError(error)
    } finally {
      if (!this._closed) this.setData({ busy: false, reloading: false })
    }
  },

  async loadHistory() {
    if (this.data.busy || this.data.moving) return
    this._historyLoading = true
    this.setData({ busy: true, historyLoading: true })
    try {
      const result = await api.getHistory(this.data.nextCursor || undefined)
      const items = result.items.map((item) => ({ ...item,
        publishedLabel: new Date(item.publishedAt).toLocaleString(),
        summaryLabel: typeof item.summary === 'string' ? item.summary : `${item.summary.categories} 个分类 · ${item.summary.dishes} 道菜品 · ${item.summary.enabledDishes} 道展示`
      }))
      this.setData({ history: this.data.history.concat(items), nextCursor: result.nextCursor || '', historyLoaded: true })
    } catch (error) {
      this.reportError(error)
    } finally {
      this._historyLoading = false
      if (!this._closed) this.setData({ busy: false, historyLoading: false })
    }
  },

  viewHistory(event) {
    if (this.data.busy || this.data.moving) return
    const version = event.currentTarget.dataset.version
    wx.navigateTo({ url: `/pages/menu-preview/menu-preview?version=${encodeURIComponent(version)}` })
  },

  async restoreHistory(event) {
    if (this.data.busy || this.data.moving || !await confirm('此版本将替换共享草稿及本地未保存修改，公开菜单保持不变。恢复后请预览并重新发布。')) return
    const version = event.currentTarget.dataset.version
    this.setData({ busy: true, restoringVersion: version })
    try {
      const draft = await api.restore(this.data.revision, version)
      if (draft.document) this.adoptDraft(draft)
      else await this.loadDraft()
      this.setData({ tab: 'dishes', tabIndex: 0 })
      wx.showToast({ title: '已恢复至共享草稿', icon: 'none' })
    } catch (error) {
      this.reportError(error)
    } finally {
      if (!this._closed) this.setData({ busy: false, restoringVersion: '' })
    }
  },

  back() { wx.navigateBack() }
})
