'use strict'

const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const vm = require('node:vm')
const test = require('node:test')
const { createRequire } = require('node:module')
const { createMenuApi } = require('../miniprogram/services/menu-api')
const { createMenuImages } = require('../miniprogram/services/menu-images')
const { CACHE_KEY } = require('../miniprogram/services/menu-cloud-page')

const clone = (value) => JSON.parse(JSON.stringify(value))
const document = () => ({ schemaVersion: 1, shop: { name: '宝宝菜单' }, categories: [{ id: 'food', name: '主食', order: 1 }], dishes: [{ id: 'rice', categoryId: 'food', name: '米饭', price: '0', order: 1, enabled: true, tags: [], options: [], imageAssetId: '' }], assets: {} })

function makeWx() {
  const storage = new Map()
  return {
    storage, toasts: [], navigations: 0, hiddenShareMenus: 0, navigationBarTitle: '',
    getStorageSync(key) { return storage.get(key) },
    setStorageSync(key, value) { storage.set(key, clone(value)) },
    removeStorageSync(key) { storage.delete(key) },
    showShareMenu() {}, hideShareMenu() { this.hiddenShareMenus++ }, stopPullDownRefresh() {},
    setNavigationBarTitle({ title }) { this.navigationBarTitle = title },
    showToast(value) { this.toasts.push(value.title) },
    showModal({ success }) { success({ confirm: true }) },
    navigateBack() { this.navigations++ },
    navigateTo({ url }) { this.navigations++; this.lastUrl = url }
  }
}

function makePage(wx, api, preview = false, query = {}) {
  const filename = path.resolve(__dirname, '../miniprogram/services/menu-page.js')
  const sandbox = { module: { exports: {} }, require: createRequire(filename), wx, console, setTimeout, clearTimeout }
  vm.runInNewContext(fs.readFileSync(filename, 'utf8'), sandbox)
  const page = sandbox.module.exports.createMenuPage({ api, preview, wxApi: wx })
  page.data = clone(page.data)
  page.setData = (patch, done) => { Object.assign(page.data, patch); if (done) done() }
  page.onLoad(query)
  return page
}

test('公开菜单请求无需微信登录，管理接口仍携带白名单会话', async () => {
  const wx = makeWx()
  const calls = []
  let logins = 0
  wx.login = ({ success }) => { logins++; success({ code: 'code' }) }
  wx.request = (request) => {
    calls.push(request)
    request.success({ statusCode: 200, data: { data: request.url.endsWith('/auth/login') ? { token: 'authorized', expiresAt: Date.now() + 3600000 } : { allowed: true } } })
  }
  const api = createMenuApi(wx, { apiBaseUrl: 'https://example.test' })
  await api.getMenu()
  assert.equal(logins, 0)
  assert.equal(calls[0].header.authorization, undefined)
  await api.access()
  assert.equal(logins, 1)
  assert.equal(calls.at(-1).header.authorization, 'Bearer authorized')
})

test('首次断网没有缓存时不展示随包旧菜单，也不清除真实购物车', async () => {
  const wx = makeWx()
  const cart = [{ id: 'rice', quantity: 2 }]
  wx.storage.set('baby_menu_cart_v1', cart)
  const page = makePage(wx, { getMenu: async () => { throw new Error('网络失败') } })
  await page.menuRefreshPromise
  assert.equal(page.data.hasMenu, false)
  assert.equal(page.data.categories.length, 0)
  assert.deepEqual(wx.storage.get('baby_menu_cart_v1'), cart)
  assert.match(page.data.cloudError, /网络失败/)
})

test('缓存可离线展示，云端空菜单必须替换缓存并清理失效购物车', async () => {
  const wx = makeWx()
  const doc = document()
  wx.storage.set(CACHE_KEY, { version: 'old', document: doc })
  wx.storage.set('baby_menu_cart_v1', [{ id: 'rice', quantity: 2, optionSelections: {} }])
  let online = false
  const api = { async getMenu() { if (!online) throw new Error('断网'); return { version: 'empty', document: { ...document(), categories: [], dishes: [] } } } }
  const page = makePage(wx, api)
  await page.menuRefreshPromise
  assert.equal(page.data.hasMenu, true)
  assert.equal(page.data.selectedCount, 2)
  assert.match(page.data.cloudStatus, /缓存/)
  online = true
  await page.refreshMenu()
  assert.equal(page.data.categories.length, 0)
  assert.equal(page.data.selectedItems.length, 0)
  assert.equal(wx.storage.get(CACHE_KEY).version, 'empty')
  assert.ok(wx.toasts.some((text) => /失效/.test(text)))
})

test('同版本不重建菜品与弹层，损坏新响应不覆盖成功缓存', async () => {
  const wx = makeWx()
  let response = { version: 'v1', document: document() }
  const page = makePage(wx, { getMenu: async () => response })
  await page.menuRefreshPromise
  const categories = page.data.categories
  page.data.detailVisible = true
  response = { version: 'v1', unchanged: true }
  await page.refreshMenu()
  assert.equal(page.data.categories, categories)
  assert.equal(page.data.detailVisible, true)
  response = { version: 'v2', document: null }
  await page.refreshMenu()
  assert.equal(wx.storage.get(CACHE_KEY).version, 'v1')
  assert.equal(page.data.categories, categories)
})

test('草稿预览隔离真实购物车，权限失效后清空全部私有内容', async () => {
  const wx = makeWx()
  const cart = [{ id: 'rice', quantity: 4, optionSelections: {} }]
  wx.storage.set('baby_menu_cart_v1', cart)
  let allowed = true
  const api = {
    getPreview: async () => { if (!allowed) throw Object.assign(new Error('权限失效'), { statusCode: 403 }); return { revision: 1, document: document() } },
    getMenu: async () => ({ version: 'v1', document: document() })
  }
  const page = makePage(wx, api, true)
  await page.menuRefreshPromise
  assert.equal(page.data.selectedCount, 0)
  page.addDish({ currentTarget: { dataset: { id: 'rice' } } })
  assert.equal(page.data.selectedCount, 1)
  assert.deepEqual(wx.storage.get('baby_menu_cart_v1'), cart)
  assert.equal(wx.storage.has(CACHE_KEY), false)
  allowed = false
  await page.refreshMenu()
  assert.equal(page.data.hasMenu, false)
  assert.equal(page.data.selectedItems.length, 0)
  assert.equal(page.menuSnapshot, null)
})

test('历史版本使用私有快照和私有图片，只读刷新且隔离真实购物车', async () => {
  const wx = makeWx()
  const cart = [{ id: 'rice', quantity: 4, optionSelections: {} }]
  wx.storage.set('baby_menu_cart_v1', cart)
  const doc = document()
  doc.dishes[0].imageAssetId = 'rice-image'
  doc.assets['rice-image'] = { imageKey: 'menu/images/rice.jpg' }
  const calls = { releases: [], previews: 0, menus: 0, publishes: 0, assets: [] }
  const api = {
    getRelease: async (version) => { calls.releases.push(version); return { version, document: doc } },
    getPreview: async () => { calls.previews++; return { revision: 2, document: doc } },
    getMenu: async () => { calls.menus++; return { version: 'current', document: doc } },
    publish: async () => { calls.publishes++ },
    resolveAsset: async (id, privateAccess) => {
      calls.assets.push({ id, privateAccess })
      return { thumbnailUrl: 'https://example.test/' + id, expiresAt: Date.now() + 3600000 }
    }
  }
  const page = makePage(wx, api, true, { version: 'v-old' })
  await page.menuRefreshPromise
  assert.equal(page.data.historyPreview, true)
  assert.match(page.data.previewIdentityText, /历史版本预览/)
  assert.match(page.data.cloudStatus, /只读预览/)
  assert.deepEqual(calls.releases, ['v-old'])
  assert.equal(calls.previews, 0)
  assert.equal(calls.menus, 0)
  assert.deepEqual(calls.assets, [{ id: 'rice-image', privateAccess: true }])
  assert.equal(wx.hiddenShareMenus, 1)
  assert.equal(wx.navigationBarTitle, '历史版本预览')

  page.addDish({ currentTarget: { dataset: { id: 'rice' } } })
  assert.equal(page.data.selectedCount, 1)
  assert.deepEqual(wx.storage.get('baby_menu_cart_v1'), cart)
  await page.publishPreview()
  assert.equal(calls.publishes, 0)

  await page.refreshMenu()
  assert.deepEqual(calls.releases, ['v-old', 'v-old'])
  assert.equal(calls.previews, 0)
  assert.equal(calls.menus, 0)
})

test('历史版本读取失败可原地重试且不会退回草稿', async () => {
  const wx = makeWx()
  let failed = true
  let previews = 0
  const api = {
    getRelease: async (version) => {
      if (failed) throw Object.assign(new Error('历史版本暂时不可用'), { statusCode: 503 })
      return { version, document: document() }
    },
    getPreview: async () => { previews++; return { revision: 1, document: document() } }
  }
  const page = makePage(wx, api, true, { version: 'v-old' })
  await page.menuRefreshPromise
  assert.equal(page.data.hasMenu, false)
  assert.match(page.data.cloudError, /历史版本暂时不可用/)
  failed = false
  await page.refreshMenu()
  assert.equal(page.data.hasMenu, true)
  assert.equal(page.menuSnapshot.version, 'v-old')
  assert.equal(previews, 0)
})

test('没有版本参数时保持草稿预览与发布行为', async () => {
  const wx = makeWx()
  const calls = { previews: 0, releases: 0, publishes: 0 }
  const api = {
    getPreview: async () => { calls.previews++; return { revision: 3, document: document() } },
    getRelease: async () => { calls.releases++; return { version: 'unexpected', document: document() } },
    getMenu: async () => ({ version: 'current', document: document() }),
    publish: async () => { calls.publishes++ }
  }
  const page = makePage(wx, api, true)
  await page.menuRefreshPromise
  assert.equal(page.data.historyPreview, false)
  assert.match(page.data.previewIdentityText, /草稿预览/)
  assert.equal(calls.previews, 1)
  assert.equal(calls.releases, 0)
  await page.publishPreview()
  assert.equal(calls.publishes, 1)
})

test('发布超时重试复用请求编号，修订冲突提示重新预览', async () => {
  const wx = makeWx()
  const calls = []
  const api = {
    getPreview: async () => ({ revision: 3, document: document() }), getMenu: async () => ({ document: document() }),
    publish: async (revision, requestId) => { calls.push({ revision, requestId }); throw Object.assign(new Error('冲突'), { statusCode: calls.length === 1 ? 0 : 409 }) }
  }
  const page = makePage(wx, api, true)
  await page.menuRefreshPromise
  await page.publishPreview()
  await page.publishPreview()
  assert.equal(calls[0].requestId, calls[1].requestId)
  assert.match(page.data.cloudError, /重新加载预览/)
  assert.equal(wx.navigations, 0)
})

test('图片复用有效签名，加载失败刷新签名并下载临时文件', async () => {
  let requests = 0
  const api = { resolveAsset: async () => ({ thumbnailUrl: 'https://example.test/' + (++requests), expiresAt: Date.now() + 3600000 }) }
  const images = createMenuImages({ downloadFile: ({ url, success }) => success({ statusCode: 200, tempFilePath: '/tmp/' + url.split('/').pop() }) }, api)
  assert.equal(await images.display('asset_one'), 'https://example.test/1')
  assert.equal(await images.display('asset_one'), 'https://example.test/1')
  assert.equal(await images.display('asset_one', false, true), '/tmp/2')
  assert.equal(requests, 2)
})

test('临时图片有效时复用，失效后重新下载，并合并并发请求', async () => {
  let requests = 0
  let downloads = 0
  let valid = true
  const images = createMenuImages({
    getFileSystemManager: () => ({ access({ success, fail }) { valid ? success() : fail() } }),
    downloadFile({ success }) { downloads++; success({ statusCode: 200, tempFilePath: '/tmp/image-' + downloads }) }
  }, { resolveAsset: async () => ({ imageUrl: 'https://example.test/' + (++requests) }) })
  const paths = await Promise.all([images.display('a', false, true), images.display('a', false, true)])
  assert.deepEqual(paths, ['/tmp/image-1', '/tmp/image-1'])
  assert.equal(await images.display('a'), '/tmp/image-1')
  assert.equal(requests, 1)
  valid = false
  assert.equal(await images.display('a', false, true), '/tmp/image-2')
  assert.equal(downloads, 2)
})

function headerDocument() {
  const doc = document()
  doc.shop.headerBackgroundImage = 'header'
  doc.dishes[0].imageAssetId = 'rice-image'
  doc.assets.header = { imageKey: 'menu/images/header.jpg' }
  doc.assets['rice-image'] = { imageKey: 'menu/images/rice.jpg' }
  return doc
}

test('慢菜品签名不阻塞头图，同版本返回保留本地头图', async () => {
  const wx = makeWx()
  wx.getFileSystemManager = () => ({ access: ({ success }) => success() })
  wx.downloadFile = ({ success }) => success({ statusCode: 200, tempFilePath: '/tmp/header' })
  let finishDish
  const page = makePage(wx, {
    getMenu: async () => ({ version: 'v1', document: headerDocument() }),
    resolveAsset: (id) => id === 'header' ? Promise.resolve({ imageUrl: 'https://example.test/header' }) : new Promise((resolve) => { finishDish = resolve })
  })
  await new Promise((resolve) => setImmediate(resolve))
  assert.equal(page.data.shop.headerBackgroundImage, '/tmp/header')
  finishDish({ imageUrl: 'https://example.test/rice' })
  await page.menuRefreshPromise
  await page.refreshMenu()
  assert.equal(page.data.shop.headerBackgroundImage, '/tmp/header')
})

test('头图下载失败只重试一次，重新进入可再尝试', async () => {
  const wx = makeWx()
  let downloads = 0
  wx.downloadFile = ({ fail }) => { downloads++; fail(new Error('失效')) }
  const doc = headerDocument()
  doc.dishes[0].imageAssetId = ''
  const page = makePage(wx, {
    getMenu: async () => ({ version: 'v1', document: doc }),
    resolveAsset: async () => ({ imageUrl: 'https://example.test/header' })
  })
  await page.menuRefreshPromise
  assert.equal(downloads, 2)
  assert.equal(page.data.headerImageFailed, true)
  page.onShow()
  await page.menuRefreshPromise
  assert.equal(downloads, 4)
})

test('旧菜单头图下载完成不能覆盖新资产', async () => {
  const wx = makeWx()
  let finish
  wx.downloadFile = ({ success }) => { finish = success }
  const doc = headerDocument()
  doc.dishes[0].imageAssetId = ''
  const page = makePage(wx, {
    getMenu: async () => ({ version: 'v1', document: doc }),
    resolveAsset: async () => ({ imageUrl: 'https://example.test/header' })
  })
  await new Promise((resolve) => setImmediate(resolve))
  page.applyCloudMenu({ version: 'v2', document: document() })
  finish({ statusCode: 200, tempFilePath: '/tmp/old' })
  await page.menuRefreshPromise
  assert.equal(page.data.headerAssetId, '')
  assert.equal(page.data.shop.headerBackgroundImage, '')
})

test('头图失败刷新签名恢复，旧地址事件被忽略且后续错误不会无限重试', async () => {
  const wx = makeWx()
  let signatures = 0
  wx.downloadFile = ({ success, fail }) => signatures === 1 ? fail(new Error('签名过期')) : success({ statusCode: 200, tempFilePath: '/tmp/recovered' })
  const doc = headerDocument()
  doc.dishes[0].imageAssetId = ''
  const page = makePage(wx, {
    getMenu: async () => ({ version: 'v1', document: doc }),
    resolveAsset: async () => ({ imageUrl: 'https://example.test/' + (++signatures) })
  })
  await page.menuRefreshPromise
  assert.equal(signatures, 2)
  assert.equal(page.data.shop.headerBackgroundImage, '/tmp/recovered')
  await page.handleHeaderError({ currentTarget: { dataset: { asset: 'header', src: '/tmp/old' } } })
  assert.equal(page.data.headerImageFailed, false)
  await page.handleHeaderError({ currentTarget: { dataset: { asset: 'header', src: '/tmp/recovered' } } })
  assert.equal(page.data.headerImageFailed, true)
  assert.equal(signatures, 2)
})

test('菜单接口暂时失败时仍尝试加载缓存菜单的图片', async () => {
  const wx = makeWx()
  const doc = document()
  doc.dishes[0].imageAssetId = 'asset_one'
  doc.assets.asset_one = { imageKey: 'menu/images/asset_one/original.jpg', thumbnailKey: 'menu/thumbnails/asset_one/original.webp' }
  wx.storage.set(CACHE_KEY, { version: 'v1', document: doc })
  const page = makePage(wx, { getMenu: async () => { throw new Error('菜单接口暂时失败') }, resolveAsset: async () => ({ thumbnailUrl: 'https://example.test/rice', expiresAt: Date.now() + 3600000 }) })
  await page.menuRefreshPromise
  assert.equal(page.findDish('rice').image, 'https://example.test/rice')
  assert.match(page.data.cloudStatus, /缓存/)
})

test('店名只绑定长按管理入口，首页不再显示管理按钮', () => {
  const markup = fs.readFileSync(path.resolve(__dirname, '../miniprogram/pages/menu/menu.wxml'), 'utf8')
  assert.match(markup, /class="shop-name" bindlongpress="openMenuAdmin"/)
  assert.doesNotMatch(markup, /bindtap="openMenuAdmin"|>菜单管理<|bindtap="[^"]*"[^>]*class="shop-name"/)
})

test('历史预览显示只读身份且不渲染发布控件', () => {
  const markup = fs.readFileSync(path.resolve(__dirname, '../miniprogram/pages/menu/menu.wxml'), 'utf8')
  assert.match(markup, /\{\{previewIdentityText\}\}/)
  assert.match(markup, /previewMode && !historyPreview && hasMenu/)
})

test('长按入口仅明确授权时进入管理，异常权限与网络失败保持静默', async () => {
  for (const access of [{ allowed: true }, { allowed: true, canEdit: true }, { allowed: false }, { allowed: true, canEdit: false }, {}, null, { allowed: 'true' }, new Error('断网')]) {
    const wx = makeWx()
    const page = makePage(wx, {
      getMenu: async () => ({ version: 'v1', document: document() }),
      access: async () => { if (access instanceof Error) throw access; return access }
    })
    await page.menuRefreshPromise
    const before = clone(page.data)
    await page.openMenuAdmin()
    const expected = access && access.allowed === true && access.canEdit !== false ? 1 : 0
    assert.equal(wx.navigations, expected)
    if (expected) assert.equal(wx.lastUrl, '/pages/menu-admin/menu-admin')
    assert.deepEqual(wx.toasts, [])
    assert.deepEqual(clone(page.data), before)
  }
})

test('连续长按合并校验，结束后可重新校验', async () => {
  const wx = makeWx()
  let resolveAccess
  let calls = 0
  const page = makePage(wx, {
    getMenu: async () => ({ version: 'v1', document: document() }),
    access: () => { calls++; return new Promise((resolve) => { resolveAccess = resolve }) }
  })
  await page.menuRefreshPromise
  const first = page.openMenuAdmin()
  assert.equal(page.openMenuAdmin(), first)
  await Promise.resolve()
  assert.equal(calls, 1)
  resolveAccess({ allowed: false })
  await first
  const second = page.openMenuAdmin()
  await Promise.resolve()
  assert.equal(calls, 2)
  resolveAccess({ allowed: true })
  await second
  assert.equal(wx.navigations, 1)
})

test('离开、返回或卸载页面后忽略未完成的长按授权结果', async () => {
  for (const lifecycle of ['hide', 'return', 'unload']) {
    const wx = makeWx()
    let resolveAccess
    const page = makePage(wx, {
      getMenu: async () => ({ version: 'v1', document: document() }),
      access: () => new Promise((resolve) => { resolveAccess = resolve })
    })
    await page.menuRefreshPromise
    const pending = page.openMenuAdmin()
    await Promise.resolve()
    if (lifecycle === 'unload') page.onUnload()
    else page.onHide()
    if (lifecycle === 'return') page.onShow()
    resolveAccess({ allowed: true })
    await pending
    assert.equal(wx.navigations, 0)
    assert.deepEqual(wx.toasts, [])
  }
})

test('预览页长按标题不会请求权限或进入管理', async () => {
  const wx = makeWx()
  let calls = 0
  const page = makePage(wx, {
    getPreview: async () => ({ revision: 1, document: document() }),
    getMenu: async () => ({ version: 'v1', document: document() }),
    access: async () => { calls++; return { allowed: true } }
  }, true)
  await page.menuRefreshPromise
  await page.openMenuAdmin()
  assert.equal(calls, 0)
  assert.equal(wx.navigations, 0)
})
