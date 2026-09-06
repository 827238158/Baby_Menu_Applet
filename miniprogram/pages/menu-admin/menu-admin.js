const api = require('../../services/menu-api')
const { validateDocument } = require('../../services/menu-document')
const { coverLayout, dragPosition } = require('../../services/menu-header')

const clone = (value) => JSON.parse(JSON.stringify(value))
const uid = (prefix) => `${prefix}_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 9)}`
const confirm = (content, options = {}) => new Promise((resolve) => wx.showModal({ title: '菜单管理', content, ...options, success: (result) => resolve(result.confirm), fail: () => resolve(false) }))

Page({
  data: {
    ready: false, denied: false, loading: true, busy: false, error: '', conflict: false,
    tab: 'dishes', tabIndex: 0, revision: 0, document: null, dirty: false, activeDish: -1,
    headerStyle: '', headerLoaded: false, headerDragging: false, historyLoading: false,
    categoryNames: [], categoryIndex: 0, images: {}, history: [], nextCursor: '', historyLoaded: false, moving: false, moveStyles: {},
    tabs: [{ id: 'dishes', name: '菜品' }, { id: 'categories', name: '分类' }, { id: 'shop', name: '页面设置' }, { id: 'history', name: '发布历史' }],
    shopFields: [{ key: 'name', name: '店名' }, { key: 'subtitle', name: '副标题' }, { key: 'shareTitle', name: '分享标题' }],
    shopImages: [{ key: 'headerBackgroundImage', name: '头图' }, { key: 'pageBackgroundImage', name: '页面背景' }, { key: 'shareImage', name: '分享图片' }]
  },
  async onLoad() {
    this.setData({ loading: true, error: '', denied: false })
    // 权限通过前不读取草稿或任何管理缓存。
    try {
      const access = await api.access()
      if (access && (access.allowed === false || access.canEdit === false)) throw Object.assign(new Error('仅限两位受邀用户管理菜单'), { statusCode: 403 })
      await this.loadDraft()
      this.setData({ ready: true })
    } catch (error) {
      this.setData({ denied: error.statusCode === 403 || error.status === 403 || /FORBIDDEN|NOT_ALLOWED/.test(error.code || ''), error: error.message || '暂时无法连接，请重试' })
    } finally { this.setData({ loading: false }) }
  },
  onUnload() { this._closed = true; clearTimeout(this._moveTimer); if (this._finishMove) this._finishMove() },
  onHide() { this.headerTouchCancel() },
  onResize() { this.headerTouchCancel(); this.measureHeader() },
  async loadDraft() { this.adoptDraft(await api.getDraft()) },
  adoptDraft(draft) {
    this._headerDrag = null
    this._headerSize = null
    const document = clone(draft.document)
    document.categories.sort((left, right) => (left.order || 0) - (right.order || 0))
    document.dishes.sort((left, right) => (left.order || 0) - (right.order || 0))
    document.dishes.forEach((dish) => {
      dish.tags = dish.tags || []
      dish.options = dish.options || []
      dish.options.forEach((option) => {
        if (option.type !== 'text') option.choices = (option.choices || []).map((choice) => typeof choice === 'string' ? { id: choice, name: choice } : choice)
      })
    })
    this.setData({ document, revision: draft.revision, dirty: false, conflict: false, error: '', activeDish: -1, headerLoaded: false, headerDragging: false, headerStyle: '', categoryNames: document.categories.map((item) => item.name) })
    if (wx.disableAlertBeforeUnload) wx.disableAlertBeforeUnload()
    this.loadImages()
  },
  async loadImages() {
    const document = this.data.document
    const ids = [...new Set(document.dishes.map((dish) => dish.imageAssetId).concat(this.data.shopImages.map((field) => document.shop[field.key])).filter(Boolean))]
    await Promise.all(ids.map(async (id) => {
      try {
        const result = await api.resolveAsset(id, true)
        if (!this._closed) this.setData({ [`images.${id}`]: typeof result === 'string' ? result : result.thumbnailUrl || result.url || result.imageUrl })
      } catch (_) { /* 图片失败不丢弃可编辑草稿，重新加载时可重试。 */ }
    }))
  },
  markChanged() {
    this.setData({ dirty: true, categoryNames: this.data.document.categories.map((item) => item.name) })
    if (wx.enableAlertBeforeUnload) wx.enableAlertBeforeUnload({ message: '修改尚未保存，确定放弃修改并退出？' })
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
    if ((this.data.busy && !this._historyLoading) || this.data.moving) return
    const tab = event.currentTarget.dataset.tab
    const tabIndex = this.data.tabs.findIndex((item) => item.id === tab)
    if (tabIndex < 0 || tab === this.data.tab) return
    this.headerTouchCancel()
    this.setData({ tab, tabIndex })
    if (this.data.tab === 'history') {
      this.setData({ history: [], nextCursor: '', historyLoaded: false })
      if (!this._historyLoading) this.loadHistory()
    }
  },
  changeField(event) {
    if (this.data.busy) return
    let path = event.currentTarget.dataset.path
    const id = event.currentTarget.dataset.id
    // 使用稳定 ID 重新定位输入所属菜品，避免排序后的延迟输入写错行。
    if (id) {
      const index = this.data.document.dishes.findIndex((dish) => dish.id === id)
      if (index < 0) return
      path = path.replace(/^document\.dishes\[\d+\]/, `document.dishes[${index}]`)
    }
    this.setData({ [path]: event.detail.value })
    this.markChanged()
    if (/^document\.shop\.(name|subtitle)$/.test(path)) this.measureHeader()
  },
  editDish(event) {
    if (this.data.busy || this.data.moving) return
    const index = Number(event.currentTarget.dataset.index)
    if (!this.data.document.dishes[index]) return
    this.setData({ activeDish: this.data.activeDish === index ? -1 : index, categoryIndex: Math.max(0, this.data.document.categories.findIndex((category) => category.id === this.data.document.dishes[index].categoryId)) })
  },
  addDish() {
    if (this.data.busy || this.data.moving) return
    if (!this.data.document.categories.length) return wx.showToast({ title: '请先新增分类', icon: 'none' })
    const dishes = this.data.document.dishes.slice()
    dishes.push({ id: uid('dish'), name: '', desc: '', price: '0', categoryId: this.data.document.categories[0].id, order: dishes.length, enabled: true, tags: [], options: [], imageAssetId: '' })
    this.setData({ 'document.dishes': dishes, activeDish: dishes.length - 1, categoryIndex: 0 })
    this.markChanged()
    this.scrollToRow(`#dish-row-${dishes.length - 1}`)
  },
  chooseCategory(event) {
    if (this.data.busy || this.data.moving) return
    const index = Number(event.detail.value)
    const dishIndex = this.data.document.dishes.findIndex((dish) => dish.id === event.currentTarget.dataset.id)
    if (dishIndex < 0 || !this.data.document.categories[index]) return
    this.setData({ [`document.dishes[${dishIndex}].categoryId`]: this.data.document.categories[index].id, categoryIndex: index })
    this.markChanged()
  },
  changeTags(event) {
    if (this.data.busy) return
    const index = this.data.document.dishes.findIndex((dish) => dish.id === event.currentTarget.dataset.id)
    if (index < 0) return
    this.setData({ [`document.dishes[${index}].tags`]: event.detail.value.split(/[,，\n]/).map((value) => value.trim()).filter(Boolean) })
    this.markChanged()
  },
  addCategory() {
    if (this.data.busy || this.data.moving) return
    const categories = this.data.document.categories.concat({ id: uid('category'), name: '', order: this.data.document.categories.length })
    this.setData({ 'document.categories': categories })
    this.markChanged()
    this.scrollToRow(`#category-row-${categories.length - 1}`)
  },
  scrollToRow(selector) {
    const scroll = () => { if (!this._closed && wx.pageScrollTo) wx.pageScrollTo({ selector, duration: 240 }) }
    if (wx.nextTick) wx.nextTick(scroll)
    else setTimeout(scroll, 0)
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
    if (!this.data.document || !this._headerSize) return
    const id = this.data.document.shop.headerBackgroundImage
    if (typeof this.createSelectorQuery !== 'function') return
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
    if (!this._headerLayout) return
    this.setData({ headerStyle: this._headerLayout.style })
  },
  headerLongPress(event) {
    if (this.data.busy || !this.data.headerLoaded || !this._headerLayout) return
    const touch = (event.touches || [])[0]
    if (!touch) return
    // 激活 WXML 的 catchtouchmove 阻止滚动；普通滑动不绑定 catch，保持页面可滚动。
    // 拖动只调整可裁切范围，松手才将此次位置写入草稿。
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
  async removeRow(event) {
    if (this.data.busy || this.data.moving) return
    const { kind, index } = event.currentTarget.dataset
    const rows = this.data.document[kind]
    if (!rows || !rows[index]) return
    const id = rows[index].id
    this.setData({ busy: true })
    try {
      const content = kind === 'categories' ? '删除该分类会将分类下所有菜品一并删除' : '删除后需保存草稿并发布才会影响公开菜单，确定删除？'
      if (!await confirm(content, { confirmText: '确定', confirmColor: '#d14343', cancelColor: '#576b95' }) || this._closed) return
      const active = this.data.document.dishes[this.data.activeDish]
      const remaining = rows.filter((row) => row.id !== id).map((row, order) => ({ ...row, order }))
      const dishes = (kind === 'categories' ? this.data.document.dishes.filter((dish) => dish.categoryId !== id) : remaining).map((dish, order) => ({ ...dish, order }))
      const categories = kind === 'categories' ? remaining : this.data.document.categories
      this.setData({ 'document.categories': categories, 'document.dishes': dishes,
        activeDish: active ? dishes.findIndex((dish) => dish.id === active.id) : -1,
        categoryIndex: active ? Math.max(0, categories.findIndex((category) => category.id === active.categoryId)) : 0 })
      this.markChanged()
    } finally { if (!this._closed) this.setData({ busy: false }) }
  },
  async moveRow(event) {
    if (this.data.busy || this.data.moving) return
    const { kind, index, delta } = event.currentTarget.dataset
    const rows = this.data.document[kind].slice()
    const from = Number(index)
    const to = from + Number(delta)
    if (!Number.isInteger(from) || !rows[from] || ![-1, 1].includes(Number(delta)) || to < 0 || to >= rows.length) return
    const active = this.data.document.dishes[this.data.activeDish]
    this.setData({ moving: true })
    // 先让两张原卡片移动到交换位置，再一次性提交顺序，展开高度也参与测量。
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
    this.setData({ [`document.${kind}`]: rows, moving: false, moveStyles: {},
      activeDish: kind === 'dishes' && active ? rows.findIndex((dish) => dish.id === active.id) : this.data.activeDish,
      categoryIndex: kind === 'categories' && active ? Math.max(0, rows.findIndex((category) => category.id === active.categoryId)) : this.data.categoryIndex })
    this.markChanged()
  },
  addOption(event) {
    if (this.data.busy || this.data.moving) return
    const type = event.currentTarget.dataset.type
    const path = `document.dishes[${this.data.activeDish}].options`
    const options = this.data.document.dishes[this.data.activeDish].options.slice()
    options.push(type === 'text' ? { id: uid('option'), name: '备注', type: 'text', required: false, maxlength: 40, placeholder: '' } : { id: uid('option'), name: '', required: true, choices: [{ id: uid('choice'), name: '' }] })
    this.setData({ [path]: options })
    this.markChanged()
  },
  removeOption(event) {
    if (this.data.busy || this.data.moving) return
    const options = this.data.document.dishes[this.data.activeDish].options.filter((_, index) => index !== Number(event.currentTarget.dataset.index))
    this.setData({ [`document.dishes[${this.data.activeDish}].options`]: options })
    this.markChanged()
  },
  addChoice(event) {
    if (this.data.busy || this.data.moving) return
    const index = Number(event.currentTarget.dataset.index)
    const choices = this.data.document.dishes[this.data.activeDish].options[index].choices.concat({ id: uid('choice'), name: '' })
    this.setData({ [`document.dishes[${this.data.activeDish}].options[${index}].choices`]: choices })
    this.markChanged()
  },
  removeChoice(event) {
    if (this.data.busy || this.data.moving) return
    const { option, choice } = event.currentTarget.dataset
    const choices = this.data.document.dishes[this.data.activeDish].options[option].choices.filter((_, index) => index !== Number(choice))
    this.setData({ [`document.dishes[${this.data.activeDish}].options[${option}].choices`]: choices })
    this.markChanged()
  },
  async chooseImage(event) {
    if (this.data.busy || this.data.moving) return
    const path = event.currentTarget.dataset.path
    // 选图期间锁定表单，避免排序或删除菜品后把图片写入错误行。
    this.setData({ busy: true, error: '' })
    try {
      const source = await new Promise((resolve, reject) => wx.showActionSheet({ itemList: ['拍照', '从相册选择'], success: (result) => resolve(result.tapIndex === 0 ? 'camera' : 'album'), fail: reject }))
      const picked = await new Promise((resolve, reject) => wx.chooseMedia({ count: 1, mediaType: ['image'], sourceType: [source], success: resolve, fail: reject }))
      const filePath = picked.tempFiles[0].tempFilePath
      this.setData({ busy: true, error: '' })
      const asset = await api.uploadImage(filePath)
      if (path === 'document.shop.headerBackgroundImage') {
        this.headerTouchCancel()
        this._headerSize = null
        this.setData({ headerLoaded: false, headerStyle: '', 'document.shop.headerBackgroundPosition': '50% 50%' })
      }
      this.setData({ [`document.assets.${asset.assetId}`]: { imageKey: asset.imageKey, thumbnailKey: asset.thumbnailKey }, [path]: asset.assetId, [`images.${asset.assetId}`]: filePath })
      this.markChanged()
    } catch (error) {
      if (!/cancel/.test(error.errMsg || '')) this.reportError(error)
    } finally { this.setData({ busy: false }) }
  },
  async removeImage(event) {
    if (this.data.busy || this.data.moving || !await confirm('从当前草稿移除此图片？已发布历史仍会保留原图。')) return
    if (event.currentTarget.dataset.path === 'document.shop.headerBackgroundImage') {
      this.headerTouchCancel()
      this._headerSize = null
      this.setData({ headerLoaded: false, headerStyle: '' })
    }
    this.setData({ [event.currentTarget.dataset.path]: '' })
    this.markChanged()
  },
  validate() {
    const doc = this.data.document
    if (!String(doc.shop.name || '').trim()) return '请填写店名'
    if (doc.categories.some((row) => !row.name.trim())) return '请填写所有分类名称'
    const categories = new Set(doc.categories.map((row) => row.id))
    for (const dish of doc.dishes) {
      if (!dish.name.trim() || !categories.has(dish.categoryId)) return '请填写菜名并选择有效分类'
      for (const option of dish.options) {
        if (!option.name.trim()) return '请填写规格名称'
        if (option.type === 'text' && (!Number.isInteger(Number(option.maxlength)) || Number(option.maxlength) < 1 || Number(option.maxlength) > 200)) return '备注字数应为 1 到 200 的整数'
        if (option.type !== 'text' && (!option.choices.length || option.choices.some((choice) => !choice.name.trim()))) return '请填写规格的所有选项'
      }
    }
    return ''
  },
  reportError(error) {
    if (error.statusCode === 401 || error.statusCode === 403) {
      // 权限撤销后停止展示私有草稿；不能继续依赖进入页面时的授权结果。
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
    if (this.data.busy || this.data.moving) return false
    const problem = this.validate()
    if (problem) { wx.showToast({ title: problem, icon: 'none' }); return false }
    this.setData({ busy: true, error: '' })
    try {
      const document = clone(this.data.document)
      document.dishes.forEach((dish) => { dish.price = '0'; dish.options.forEach((option) => { if (option.type === 'text') option.maxlength = Number(option.maxlength) || 40 }) })
      validateDocument(document)
      const result = await api.saveDraft(this.data.revision, document)
      this.adoptDraft(result.document ? result : { revision: result.revision, document })
      wx.showToast({ title: '已保存共享草稿', icon: 'success' })
      return true
    } catch (error) { this.reportError(error); return false } finally { this.setData({ busy: false }) }
  },
  async preview() {
    if (this.data.busy || this.data.moving) return
    if (this.data.dirty && !await this.saveDraft()) return
    wx.navigateTo({ url: '/pages/menu-preview/menu-preview' })
  },
  async reload() {
    if (this.data.busy || this.data.moving) return
    if (this.data.dirty && !await confirm('重新加载会丢弃尚未保存的本地修改，确定继续？')) return
    this.setData({ busy: true })
    try { await this.loadDraft() } catch (error) { this.reportError(error) } finally { this.setData({ busy: false }) }
  },
  async loadHistory() {
    if (this.data.busy || this.data.moving) return
    this._historyLoading = true
    this.setData({ busy: true, historyLoading: true })
    try {
      const result = await api.getHistory(this.data.nextCursor || undefined)
      const items = result.items.map((item) => ({ ...item,
        publishedLabel: new Date(item.publishedAt).toLocaleString(),
        summaryLabel: typeof item.summary === 'string' ? item.summary : `${item.summary.categories} 个分类 · ${item.summary.dishes} 道菜品 · ${item.summary.enabledDishes} 道上架`
      }))
      this.setData({ history: this.data.history.concat(items), nextCursor: result.nextCursor || '', historyLoaded: true })
    } catch (error) { this.reportError(error) } finally { this._historyLoading = false; this.setData({ busy: false, historyLoading: false }) }
  },
  async viewHistory(event) {
    if (this.data.busy || this.data.moving) return
    this.setData({ busy: true })
    try {
      const result = await api.getRelease(event.currentTarget.dataset.version)
      const doc = result.document
      wx.showModal({ title: doc.shop.name, content: `${doc.shop.subtitle || ''}\n${doc.categories.length} 个分类，${doc.dishes.length} 道菜品\n${doc.dishes.map((dish) => dish.name).join('、')}`, showCancel: false })
    } catch (error) { this.reportError(error) } finally { this.setData({ busy: false }) }
  },
  async restoreHistory(event) {
    if (this.data.busy || this.data.moving || !await confirm('此版本将替换共享草稿及本地未保存修改，公开菜单保持不变。恢复后请预览并重新发布。')) return
    this.setData({ busy: true })
    try {
      const draft = await api.restore(this.data.revision, event.currentTarget.dataset.version)
      if (draft.document) this.adoptDraft(draft)
      else await this.loadDraft()
      this.setData({ tab: 'dishes', tabIndex: 0 })
      wx.showToast({ title: '已恢复至共享草稿', icon: 'none' })
    } catch (error) { this.reportError(error) } finally { this.setData({ busy: false }) }
  },
  back() { wx.navigateBack() }
})
