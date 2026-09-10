const defaultApi = require('./menu-api')
const { createMenuImages } = require('./menu-images')
const { coverLayout } = require('./menu-header')
const { buildMenu, assetIds, SHOP_IMAGES, validateDocument } = require('./menu-document')
const CACHE_KEY = 'baby_public_menu_v1'

function summarizeChanges(current, next) {
  const old = current || { shop: {}, categories: [], dishes: [] }
  const oldDishes = new Map(old.dishes.map((dish) => [dish.id, dish]))
  const nextIds = new Set(next.dishes.map((dish) => dish.id))
  const added = next.dishes.filter((dish) => !oldDishes.has(dish.id)).length
  const changed = next.dishes.filter((dish) => oldDishes.has(dish.id) && JSON.stringify(oldDishes.get(dish.id)) !== JSON.stringify(dish)).length
  const removed = old.dishes.filter((dish) => !nextIds.has(dish.id)).length
  return '新增 ' + added + ' 道，调整 ' + changed + ' 道，移除 ' + removed + ' 道。' +
    (JSON.stringify(old.categories) !== JSON.stringify(next.categories) ? '分类有调整。' : '') +
    (JSON.stringify(old.shop) !== JSON.stringify(next.shop) ? '页面设置有调整。' : '')
}

function attachCloudMenu(page, options, helpers, wx) {
  const api = options.api || defaultApi
  const preview = Boolean(options.preview)
  const baseLoad = page.onLoad
  const baseUnload = page.onUnload
  const basePersist = page.persistSelectedItems
  const baseGetStored = page.getStoredSelectedItems
  Object.assign(page.data, { headerAssetId: '', headerImageStyle: 'width:100%;height:100%;', headerImageFailed: false })
  Object.assign(page.data, { previewMode: preview, historyPreview: false, previewIdentityText: '草稿预览 · 不影响真实购物车', cloudLoading: !options.initialMenu, cloudError: '', cloudStatus: '', hasMenu: Boolean(options.initialMenu), publishing: false, previewSummary: '' })
  Object.assign(page, {
    onLoad(query = {}) {
      // 历史版本只从页面参数读取一次，后续刷新始终锁定同一份私有快照。
      const pageQuery = query && typeof query === 'object' ? query : {}
      this.historyVersion = preview && typeof pageQuery.version === 'string' ? pageQuery.version.trim() : ''
      const historyPreview = Boolean(this.historyVersion)
      this.setData({
        historyPreview,
        previewIdentityText: historyPreview ? '历史版本预览 · 只读' : '草稿预览 · 不影响真实购物车'
      })
      if (historyPreview && wx.setNavigationBarTitle) wx.setNavigationBarTitle({ title: '历史版本预览' })
      this.menuImageService = createMenuImages(wx, api)
      this.menuImageUrls = {}
      this.menuImageFailures = new Set()
      this.menuEpoch = 0
      this.menuDisposed = false
      this.menuVisible = true
      this.menuAccessEpoch = 0
      this.menuAccessPromise = null
      this.quantityMotionSequence = 0
      this.cartCloseTimer = null
      this.detailCloseTimer = null
      if (options.initialMenu) { baseLoad.call(this, pageQuery); return }
      if (preview) {
        if (wx.hideShareMenu) wx.hideShareMenu()
      } else {
        if (wx.showShareMenu) wx.showShareMenu({ menus: ['shareAppMessage'] })
        try {
          const cached = wx.getStorageSync(CACHE_KEY)
          if (cached && cached.version) {
            validateDocument(cached.document)
            this.applyCloudMenu(cached)
            this.setData({ cloudStatus: '正在检查菜单更新' })
          }
        } catch (error) {}
      }
      this.refreshMenu()
    },
    onShow() {
      this.menuVisible = true
      if (this.data.headerImageFailed && this.menuImageFailures) this.menuImageFailures.delete(this.data.headerAssetId)
      if (!options.initialMenu && this.menuImageService) this.refreshMenu()
    },
    onHide() {
      this.menuVisible = false
      this.menuAccessEpoch += 1
      this.menuAccessPromise = null
    },
    onResize() { this.updateHeaderLayout() },
    updateHeaderLayout() {
      if (!this.headerDimensions || !wx.createSelectorQuery) return
      const epoch = this.menuEpoch
      const headerId = this.data.headerAssetId
      const source = this.data.shop.headerBackgroundImage
      const query = wx.createSelectorQuery().in(this)
      query.select('.shop-header').boundingClientRect((box) => {
        if (!box || this.menuDisposed || epoch !== this.menuEpoch || headerId !== this.data.headerAssetId || source !== this.data.shop.headerBackgroundImage) return
        const size = this.headerDimensions
        if (!size) return
        const layout = coverLayout(size.width, size.height, box.width, box.height, this.data.shop.headerBackgroundPosition)
        if (layout) this.setData({ headerImageStyle: layout.style })
      }).exec()
    },
    handleHeaderLoad(event) {
      if (event.currentTarget.dataset.asset !== this.data.headerAssetId || this.menuDisposed) return
      if (event.currentTarget.dataset.src && event.currentTarget.dataset.src !== this.data.shop.headerBackgroundImage) return
      this.headerDimensions = event.detail
      this.setData({ headerImageFailed: false })
      this.updateHeaderLayout()
    },
    async handleHeaderError(event) {
      const id = event.currentTarget.dataset.asset
      if (!id || id !== this.data.headerAssetId || this.menuDisposed) return
      if (event.currentTarget.dataset.src && event.currentTarget.dataset.src !== this.data.shop.headerBackgroundImage) return
      if (this.menuImageFailures.has(id)) { this.setData({ headerImageFailed: true }); return }
      this.menuImageFailures.add(id)
      const epoch = this.menuEpoch
      try {
        const url = await this.menuImageService.display(id, preview, true, true)
        if (!this.menuDisposed && epoch === this.menuEpoch) this.applyAssetUrl(id, url)
      } catch (error) {
        if (!this.menuDisposed && epoch === this.menuEpoch) this.setData({ headerImageFailed: true })
      }
    },
    onUnload() {
      this.menuDisposed = true
      this.menuVisible = false
      this.menuAccessEpoch += 1
      this.menuAccessPromise = null
      this.menuEpoch += 1
      baseUnload.call(this)
    },
    openMenuAdmin() {
      if (preview || this.menuDisposed || !this.menuVisible) return Promise.resolve()
      if (this.menuAccessPromise) return this.menuAccessPromise
      const epoch = this.menuAccessEpoch
      // 长按入口只做静默白名单校验，页面离开后不再使用旧校验结果。
      const request = Promise.resolve().then(() => api.access()).then((access) => {
        if (this.menuDisposed || !this.menuVisible || epoch !== this.menuAccessEpoch) return
        if (access && access.allowed === true && access.canEdit !== false) {
          wx.navigateTo({ url: '/pages/menu-admin/menu-admin' })
        }
      }).catch(() => {}).finally(() => {
        if (this.menuAccessPromise === request) this.menuAccessPromise = null
      })
      this.menuAccessPromise = request
      return request
    },
    persistSelectedItems(items) { return preview ? true : basePersist.call(this, items) },
    getStoredSelectedItems() { return preview ? [] : baseGetStored.call(this) },
    async refreshMenu() {
      if (this.menuRefreshPromise) return this.menuRefreshPromise
      this.setData({ cloudLoading: !this.data.hasMenu, cloudError: '' })
      this.menuRefreshPromise = (async () => {
        try {
          const historyPreview = preview && Boolean(this.historyVersion)
          const snapshot = historyPreview
            ? await api.getRelease(this.historyVersion)
            : preview ? await api.getPreview() : await api.getMenu(this.menuSnapshot && this.menuSnapshot.version)
          if (this.menuDisposed) return
          if (!snapshot.unchanged) {
            validateDocument(snapshot.document)
            const snapshotChanged = !this.menuSnapshot || (historyPreview
              ? this.menuSnapshot.version !== snapshot.version
              : preview ? this.menuSnapshot.revision !== snapshot.revision : this.menuSnapshot.version !== snapshot.version)
            if (snapshotChanged) this.applyCloudMenu(snapshot)
            if (!preview) {
              try { wx.setStorageSync(CACHE_KEY, { version: snapshot.version, document: snapshot.document }) } catch (error) {}
            }
          } else if (!this.menuSnapshot) throw new Error('菜单缓存不可用，请重试')
          this.setData({ cloudStatus: historyPreview ? '历史版本只读预览 · 加购不会影响真实购物车' : preview ? '草稿预览 · 加购不会影响真实购物车' : '', cloudError: '' })
          await this.loadCloudImages()
          if (preview && !historyPreview && !this.menuDisposed) {
            const current = await api.getMenu().catch((error) => {
              if (error.statusCode === 404) return { document: null }
              throw error
            })
            if (!this.menuDisposed) this.setData({ previewSummary: summarizeChanges(current.document, this.menuSnapshot.document) })
          }
        } catch (error) {
          if (this.menuDisposed) return
          // 私有预览授权失败后立即清空，公开菜单则保留最近一次成功内容。
          if (preview && (error.statusCode === 401 || error.statusCode === 403)) {
            this.menuSnapshot = null
            this.menuEpoch += 1
            this.setData({ hasMenu: false, categories: [], activeItems: [], selectedItems: [], selectedCount: 0, shop: {}, pageStyle: '', currentItem: null, detailVisible: false, cartVisible: false })
          }
          this.setData({ cloudError: error.message || '菜单读取失败，请重试', cloudStatus: this.data.hasMenu ? '暂时无法更新，当前显示缓存内容' : '' })
          if (!preview && this.data.hasMenu) await this.loadCloudImages().catch(() => {})
        } finally {
          if (!this.menuDisposed) this.setData({ cloudLoading: false })
        }
      })().finally(() => { this.menuRefreshPromise = null })
      return this.menuRefreshPromise
    },
    applyCloudMenu(snapshot) {
      const headerAssetId = snapshot.document.shop.headerBackgroundImage || ''
      const sameHeader = headerAssetId === this.data.headerAssetId
      if (!sameHeader) this.headerDimensions = null
      const rendered = buildMenu(snapshot.document, this.menuImageUrls)
      const categories = helpers.normalizeCategories(rendered.categories)
      const active = categories.find((category) => category.id === this.data.activeCategoryId) || categories[0]
      const oldItems = this.data.selectedItems || []
      const hadMenu = this.data.hasMenu
      this.menuSnapshot = snapshot
      this.menuEpoch += 1
      this.menuImageFailures.clear()
      this.setData({ headerAssetId, headerImageFailed: sameHeader && this.data.headerImageFailed, headerImageStyle: sameHeader ? this.data.headerImageStyle : 'width:100%;height:100%;', shop: rendered.shop, pageStyle: helpers.getPageStyle(rendered.shop), categories,
        activeCategoryId: active ? active.id : '', activeItems: active ? active.items : [], hasMenu: true,
        currentItem: null, detailVisible: false, detailClosing: false, cloudError: '' }, () => {
        const items = hadMenu ? oldItems.map((item) => this.normalizeStoredCartItem(item)).filter(Boolean) : this.getStoredSelectedItems()
        if (!this.updateSelected(items)) {
          // 新菜单已生效时，即使磁盘缓存写入失败也不能继续展示失效购物车。
          this.setData({ selectedItems: [], selectedCount: 0, selectedTotal: '0', selectedSummaryText: '还未选择菜品', cartVisible: false })
        }
        if (hadMenu && items.length < oldItems.length) wx.showToast({ title: '菜单已更新，已移除失效菜品或规格', icon: 'none' })
        this.updateHeaderLayout()
      })
    },
    async loadCloudImages() {
      if (!this.menuSnapshot) return
      const epoch = this.menuEpoch
      const ids = assetIds(this.menuSnapshot.document)
      const shopIds = new Set(SHOP_IMAGES.map((field) => this.menuSnapshot.document.shop[field]).filter(Boolean))
      // 头图立即独立下载，菜品慢请求不会挡住头图显示。
      const shopLoads = Array.from(shopIds, async (id) => {
        try {
          const url = await this.menuImageService.display(id, preview, true)
          if (!this.menuDisposed && epoch === this.menuEpoch) this.applyAssetUrl(id, url)
        } catch (error) {
          if (!this.menuDisposed && epoch === this.menuEpoch && id === this.data.headerAssetId) {
            await this.handleHeaderError({ currentTarget: { dataset: { asset: id } } })
          }
        }
      })
      // 限制图片签名请求并发，避免一次打开菜单发起大量请求。
      let index = 0
      await Promise.all(Array.from({ length: Math.min(4, ids.length) }, async () => {
        while (index < ids.length) {
          const id = ids[index++]
          if (shopIds.has(id)) continue
          try {
            const url = await this.menuImageService.display(id, preview)
            if (!this.menuDisposed && epoch === this.menuEpoch) this.applyAssetUrl(id, url)
          } catch (error) {}
        }
      }))
      await Promise.all(shopLoads)
    },
    applyAssetUrl(id, url) {
      if (!this.menuSnapshot || this.menuDisposed) return
      this.menuImageUrls[id] = url
      const doc = this.menuSnapshot.document
      doc.dishes.filter((dish) => dish.imageAssetId === id && dish.enabled !== false).forEach((dish) => this.replaceDishImage(dish.id, url))
      const shop = Object.assign({}, this.data.shop)
      SHOP_IMAGES.forEach((field) => { if (doc.shop[field] === id) shop[field] = url })
      this.setData({ shop, pageStyle: helpers.getPageStyle(shop) })
      if (doc.shop.headerBackgroundImage === id) this.setData({ headerImageFailed: false })
    },
    async handleImageError(event) {
      const dish = this.findDish(event.currentTarget.dataset.id)
      if (!dish || !dish.imageAssetId) {
        if (dish) this.replaceDishImage(dish.id, '/assets/placeholder-food.jpg')
        return
      }
      const id = dish.imageAssetId
      if (this.menuImageFailures.has(id)) return
      this.menuImageFailures.add(id)
      const epoch = this.menuEpoch
      try {
        const url = await this.menuImageService.display(id, preview, true)
        if (!this.menuDisposed && epoch === this.menuEpoch) this.applyAssetUrl(id, url)
      } catch (error) {
        if (!this.menuDisposed && epoch === this.menuEpoch) this.replaceDishImage(dish.id, '/assets/placeholder-food.jpg')
      }
    },
    async publishPreview() {
      if (!preview || this.historyVersion || !this.menuSnapshot || this.data.publishing || this.data.cloudLoading) return
      const revision = this.menuSnapshot.revision
      const confirmed = await new Promise((resolve) => wx.showModal({ title: '发布菜单', content: (this.data.previewSummary || '') + '\n发布后所有用户可查看此版本。', success: (result) => resolve(result.confirm), fail: () => resolve(false) }))
      if (!confirmed) return
      this.setData({ publishing: true })
      try {
        // 同一草稿的重试复用请求编号，处理“服务端成功、客户端超时”的情况。
        if (!this.publishRequest || this.publishRequest.revision !== revision) this.publishRequest = { revision, id: 'publish_' + Date.now() + '_' + Math.random().toString(36).slice(2) }
        await api.publish(revision, this.publishRequest.id)
        wx.showToast({ title: '菜单已发布', icon: 'success' })
        wx.navigateBack()
      } catch (error) {
        this.setData({ cloudError: error.code === 'MENU_BUSY' ? '菜单正在同步，请稍后重试' : error.statusCode === 409 ? '草稿已变化，请重新加载预览后发布' : error.message })
      } finally { if (!this.menuDisposed) this.setData({ publishing: false }) }
    }
  })
  return page
}

module.exports = { attachCloudMenu, summarizeChanges, CACHE_KEY }
