const test = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const vm = require('node:vm')
const path = require('node:path')

function draft() {
  return { revision: 3, document: { schemaVersion: 1, shop: { name: '小厨房' }, categories: [{ id: 'c', name: '主食', order: 0 }], dishes: [{ id: 'd', name: '面条', desc: '', categoryId: 'c', price: '0', tags: [], options: [{ id: '辣度', name: '辣度', choices: ['微辣'] }], enabled: true, imageAssetId: '' }], assets: {} } }
}
function create(api = {}, wxOverrides = {}) {
  let definition
  const messages = []
  const wx = { showToast: (value) => messages.push(value), showModal: (value) => value.success({ confirm: true }), enableAlertBeforeUnload() {}, disableAlertBeforeUnload() {}, navigateTo: (value) => messages.push(value), showActionSheet: () => {}, ...wxOverrides }
  const menuApi = { access: async () => ({}), getDraft: async () => draft(), getMenu: async () => ({ version: 'v1', document: draft().document }), getRelease: async () => ({ version: 'v1', document: draft().document }), ...api }
  const context = { setTimeout, clearTimeout, require: (name) => name.endsWith('menu-header') ? require('../miniprogram/services/menu-header') : name.endsWith('menu-document') ? require('../miniprogram/services/menu-document') : name.endsWith('menu-admin-validation') ? require('../miniprogram/services/menu-admin-validation') : menuApi, wx, Page: (value) => { definition = value } }
  vm.runInNewContext(fs.readFileSync(path.join(__dirname, '../miniprogram/pages/menu-admin/menu-admin.js'), 'utf8'), context)
  const page = { ...definition, data: JSON.parse(JSON.stringify(definition.data)) }
  page.setData = (updates) => {
    for (const [key, value] of Object.entries(updates)) {
      const parts = key.replace(/\[(\d+)\]/g, '.$1').split('.')
      let target = page.data
      for (const part of parts.slice(0, -1)) target = target[part] || (target[part] = {})
      target[parts.at(-1)] = value
    }
  }
  return { page, messages }
}

test('unauthorized manager never loads draft', async () => {
  let reads = 0
  const { page } = create({ access: async () => { throw Object.assign(new Error('拒绝'), { statusCode: 403 }) }, getDraft: async () => { reads++; return draft() } })
  await page.onLoad()
  assert.equal(reads, 0)
  assert.equal(page.data.denied, true)
  assert.equal(page.data.document, null)
})

test('revoked management permission clears previously authorized draft', async () => {
  const { page } = create()
  await page.onLoad()
  page.reportError({ statusCode: 403 })
  assert.equal(page.data.ready, false)
  assert.equal(page.data.document, null)
  assert.equal(page.data.denied, true)
})

test('busy menu lock preserves local form without demanding a destructive reload', async () => {
  const { page } = create()
  await page.onLoad()
  page.markChanged()
  page.reportError({ statusCode: 409, code: 'MENU_BUSY' })
  assert.equal(page.data.conflict, false)
  assert.equal(page.data.dirty, true)
  assert.match(page.data.error, /稍后重试/)
})

test('editing choice label preserves its previous stable identifier', async () => {
  const { page } = create()
  await page.onLoad()
  page.changeField({ currentTarget: { dataset: { path: 'document.dishes[0].options[0].choices[0].name' } }, detail: { value: '稍微辣' } })
  assert.equal(page.data.document.dishes[0].options[0].choices[0].id, '微辣')
  assert.equal(page.data.dirty, true)
})

test('conflicting save preserves form and revision and prevents navigation', async () => {
  const { page, messages } = create({ saveDraft: async () => { throw Object.assign(new Error('冲突'), { statusCode: 409 }) } })
  await page.onLoad()
  page.data.document.shop.name = '我的修改'
  page.markChanged()
  await page.preview()
  assert.equal(page.data.document.shop.name, '我的修改')
  assert.equal(page.data.revision, 3)
  assert.equal(page.data.dirty, true)
  assert.equal(page.data.conflict, true)
  assert.equal(messages.some((item) => item.url), false)
})

test('category deletion removes its enabled and disabled dishes after red confirmation', async () => {
  let modal
  const { page } = create({}, { showModal: (value) => { modal = value; value.success({ confirm: true }) } })
  await page.onLoad()
  page.data.document.categories.push({ id: 'other', name: '其他', order: 1 })
  page.data.document.dishes.push({ ...page.data.document.dishes[0], id: 'disabled', enabled: false }, { ...page.data.document.dishes[0], id: 'kept', categoryId: 'other' })
  await page.removeRow({ currentTarget: { dataset: { kind: 'categories', index: 0 } } })
  assert.equal(page.data.document.categories.length, 1)
  assert.equal(page.data.document.dishes.length, 1)
  assert.equal(page.data.document.dishes[0].id, 'kept')
  assert.equal(page.data.document.dishes[0].order, 0)
  assert.equal(page.data.dirty, true)
  assert.equal(modal.content, '删除该分类会将分类下所有菜品一并删除')
  assert.equal(modal.confirmColor, '#d14343')
})

test('preview explicitly saves draft first, with fixed zero price', async () => {
  let saved
  const { page, messages } = create({ saveDraft: async (revision, document) => { saved = { revision, document }; return { revision: 4, document } } })
  await page.onLoad()
  page.data.document.dishes[0].price = '999'
  page.markChanged()
  await page.preview()
  assert.equal(saved.revision, 3)
  assert.equal(saved.document.dishes[0].price, '0')
  assert.equal(page.data.dirty, false)
  assert.equal(messages.at(-1).url, '/pages/menu-preview/menu-preview')
})

test('history restore replaces draft only through revision checked API', async () => {
  let called
  const { page } = create({ restore: async (...args) => { called = args; return { ...draft(), revision: 4 } } })
  await page.onLoad()
  await page.restoreHistory({ currentTarget: { dataset: { version: 'v-old' } } })
  assert.deepEqual(called, [3, 'v-old'])
  assert.equal(page.data.revision, 4)
  assert.equal(page.data.dirty, false)
})

test('image upload failure preserves previous image and all form fields', async () => {
  const { page } = create({ uploadImage: async () => { throw new Error('图片处理失败') } }, {
    showActionSheet: (options) => options.success({ tapIndex: 1 }),
    chooseMedia: (options) => options.success({ tempFiles: [{ tempFilePath: '/tmp/image.jpg' }] })
  })
  await page.onLoad()
  page.data.document.dishes[0].imageAssetId = 'previous_image'
  page.data.document.dishes[0].name = '本地编辑'
  await page.chooseImage({ currentTarget: { dataset: { path: 'document.dishes[0].imageAssetId' } } })
  assert.equal(page.data.document.dishes[0].imageAssetId, 'previous_image')
  assert.equal(page.data.document.dishes[0].name, '本地编辑')
  assert.equal(page.data.busy, false)
  assert.match(page.data.error, /处理失败/)
})

test('upload adds complete asset metadata and changes only requested shop field', async () => {
  const asset = { assetId: 'image_1234', imageKey: 'menu/images/image_1234/a.jpg', thumbnailKey: 'menu/thumbnails/image_1234/a.webp' }
  let alerts = 0
  const { page } = create({ uploadImage: async () => asset }, {
    showActionSheet: (options) => options.success({ tapIndex: 0 }),
    chooseMedia: (options) => options.success({ tempFiles: [{ tempFilePath: '/tmp/image.jpg' }] }),
    enableAlertBeforeUnload: () => { alerts++ }
  })
  await page.onLoad()
  await page.chooseImage({ currentTarget: { dataset: { path: 'document.shop.shareImage' } } })
  assert.equal(page.data.document.shop.shareImage, asset.assetId)
  assert.equal(page.data.document.assets.image_1234.thumbnailKey, asset.thumbnailKey)
  assert.equal(page.data.document.dishes[0].imageAssetId, '')
  assert.equal(alerts, 1)
})

test('invalid text maxlength prevents network save without changing form', async () => {
  let writes = 0
  const { page, messages } = create({ saveDraft: async () => { writes++ } })
  await page.onLoad()
  page.data.document.dishes[0].options = [{ id: 'memo', name: '备注', type: 'text', maxlength: '0', required: false }]
  page.markChanged()
  assert.equal(await page.saveDraft(), false)
  assert.equal(writes, 0)
  assert.equal(page.data.dirty, true)
  assert.ok(messages.some((item) => item.title && /整数/.test(item.title)))
})

test('declining reload keeps unsaved changes and unload warning', async () => {
  let reads = 0
  const { page } = create({ getDraft: async () => { reads++; return draft() } }, {
    showModal: (options) => options.success({ confirm: false })
  })
  await page.onLoad()
  page.data.document.shop.name = '不能丢失'
  page.markChanged()
  await page.reload()
  assert.equal(reads, 1)
  assert.equal(page.data.document.shop.name, '不能丢失')
  assert.equal(page.data.dirty, true)
})

test('history formats server timestamps and structured summary for display', async () => {
  const { page } = create({ getHistory: async () => ({ items: [{ version: 'v1', publishedAt: 1700000000000, summary: { categories: 2, dishes: 5, enabledDishes: 4 } }] }) })
  await page.onLoad()
  await page.loadHistory()
  assert.match(page.data.history[0].summaryLabel, /2 个分类 · 5 道菜品 · 4 道展示/)
  assert.equal(typeof page.data.history[0].publishedLabel, 'string')
})

test('cancel category deletion preserves the entire draft', async () => {
  const { page } = create({}, { showModal: (value) => value.success({ confirm: false }) })
  await page.onLoad()
  const before = JSON.stringify(page.data.document)
  await page.removeRow({ currentTarget: { dataset: { kind: 'categories', index: 0 } } })
  assert.equal(JSON.stringify(page.data.document), before)
  assert.equal(page.data.dirty, false)
  assert.equal(page.data.busy, false)
})

test('empty category and last category can be deleted', async () => {
  const { page } = create()
  await page.onLoad()
  page.data.document.dishes = []
  await page.removeRow({ currentTarget: { dataset: { kind: 'categories', index: 0 } } })
  assert.equal(page.data.document.categories.length, 0)
  assert.equal(page.data.categoryViews.length, 0)
  assert.equal(page.data.categoryFilters.length, 1)
})

test('dish editor commit updates by stable id and canceling create leaves no empty row', async () => {
  let navigation
  const { page } = create({}, { navigateTo: (options) => { navigation = options } })
  await page.onLoad()
  page.openDish({ currentTarget: { dataset: { id: 'd' } } })
  assert.equal(navigation.url, '/pages/menu-dish-editor/menu-dish-editor')
  navigation.events['dishEditor:commit']({ dish: { ...page.data.document.dishes[0], id: 'changed', name: '改名', price: '99' }, assets: {}, images: {} })
  assert.equal(page.data.document.dishes[0].id, 'd')
  assert.equal(page.data.document.dishes[0].name, '改名')
  assert.equal(page.data.document.dishes[0].price, '0')
  const before = page.data.document.dishes.length
  page.addDish()
  assert.equal(page.data.document.dishes.length, before)
})

test('sorting unequal cards prevents overlapping mutations and preserves stable data', async () => {
  const { page } = create()
  await page.onLoad()
  page.data.document.dishes.push({ ...page.data.document.dishes[0], id: 'second' })
  page.data.sortMode = true
  page.refreshViews()
  page.createSelectorQuery = () => {
    const query = { select: () => query, boundingClientRect: () => query, exec: (done) => done([{ top: 0, bottom: 300, height: 300 }, { top: 320, bottom: 420, height: 100 }]) }
    return query
  }
  const event = { currentTarget: { dataset: { kind: 'dishes', index: 0, delta: 1 } } }
  const pending = page.moveRow(event)
  assert.equal(page.data.moving, true)
  assert.match(page.data.moveStyles.d, /translateY\(120px\)/)
  assert.match(page.data.moveStyles.second, /translateY\(-320px\)/)
  await page.moveRow(event)
  page.addDish()
  await pending
  assert.equal(page.data.document.dishes.length, 2)
  assert.equal(page.data.document.dishes[1].id, 'd')
  assert.equal(page.data.moving, false)
})

test('sort boundaries and missing geometry do not block subsequent editing', async () => {
  const { page } = create()
  await page.onLoad()
  page.data.sortMode = true
  await page.moveRow({ currentTarget: { dataset: { kind: 'dishes', index: 0, delta: -1 } } })
  assert.equal(page.data.dirty, false)
  page.data.document.dishes.push({ ...page.data.document.dishes[0], id: 'second' })
  page.createSelectorQuery = () => { throw new Error('measurement unavailable') }
  await page.moveRow({ currentTarget: { dataset: { kind: 'dishes', index: 0, delta: 1 } } })
  assert.equal(page.data.document.dishes[0].id, 'second')
  assert.equal(page.data.moving, false)
})

test('tab indicator follows final selection and adding category scrolls after render', async () => {
  const scrolls = []
  let navigation
  const { page } = create({}, { nextTick: (fn) => fn(), pageScrollTo: (value) => scrolls.push(value.selector), navigateTo: (value) => { navigation = value } })
  await page.onLoad()
  for (const tab of ['shop', 'categories', 'dishes']) page.switchTab({ currentTarget: { dataset: { tab } } })
  assert.equal(page.data.tabIndex, 0)
  page.addDish()
  assert.equal(navigation.url, '/pages/menu-dish-editor/menu-dish-editor')
  page.addCategory()
  assert.equal(scrolls.at(-1), '#category-row-1')
})

test('header drag preserves legacy position until movement and cancel restores crop', async () => {
  const { page } = create()
  await page.onLoad()
  page.data.document.shop.headerBackgroundImage = 'header'
  page.data.document.shop.headerBackgroundPosition = 'center 60%'
  page.createSelectorQuery = () => {
    const query = { select: () => query, boundingClientRect: (fn) => { fn({ width: 350, height: 100 }); return query }, exec() {} }
    return query
  }
  page.headerLoad({ currentTarget: { dataset: { asset: 'stale' } }, detail: { width: 400, height: 400 } })
  assert.equal(page.data.headerLoaded, false)
  page.headerLoad({ currentTarget: { dataset: { asset: 'header' } }, detail: { width: 400, height: 400 } })
  const original = page.data.headerStyle
  const touch = (y) => ({ touches: [{ clientX: 0, clientY: y }] })
  page.toggleHeaderAdjust()
  page.headerTouchStart(touch(0))
  assert.equal(page.data.headerDragging, true)
  page.headerTouchEnd()
  assert.equal(page.data.headerDragging, false)
  assert.equal(page.data.document.shop.headerBackgroundPosition, 'center 60%')
  assert.equal(page.data.dirty, false)
  page.headerTouchStart(touch(0))
  page.headerTouchMove(touch(60))
  assert.notEqual(page.data.headerStyle, original)
  page.headerTouchCancel()
  assert.equal(page.data.headerDragging, false)
  assert.equal(page.data.headerStyle, original)
  assert.equal(page.data.dirty, false)
  page.headerTouchStart(touch(0))
  page.headerTouchMove(touch(60))
  page.headerTouchEnd()
  assert.equal(page.data.document.shop.headerBackgroundPosition, '50% 36%')
  assert.equal(page.data.headerDragging, false)
  assert.equal(page.data.dirty, true)
})

test('successful save clears native unsaved warning', async () => {
  let enabled = 0; let disabled = 0
  const { page } = create({ saveDraft: async (_, document) => ({ revision: 4, document }) }, { enableAlertBeforeUnload: () => enabled++, disableAlertBeforeUnload: () => disabled++ })
  await page.onLoad()
  page.markChanged()
  await page.saveDraft()
  assert.equal(enabled, 1)
  assert.equal(disabled, 2)
  assert.equal(page.data.dirty, false)
})

test('header touchmove is caught only in explicit adjustment mode', () => {
  const source = fs.readFileSync(path.join(__dirname, '../miniprogram/pages/menu-admin/menu-admin.wxml'), 'utf8')
  assert.ok(source.includes('catchtouchmove="{{headerAdjusting ? \'headerTouchMove\' : \'\'}}"'))
  assert.ok(!source.includes('bindtouchmove="headerTouchMove"'))
})

test('admin text inputs are visibly disabled while their events are locked', () => {
  const source = fs.readFileSync(path.join(__dirname, '../miniprogram/pages/menu-admin/menu-admin.wxml'), 'utf8')
  assert.match(source, /bindinput="changeCategoryName"[^>]+disabled="\{\{busy \|\| moving\}\}"/)
  assert.equal((source.match(/bindinput="changeField"[^>]+disabled="\{\{busy\}\}"/g) || []).length, 3)
})

test('search and category filter derive visible dishes without changing the draft', async () => {
  const { page } = create()
  await page.onLoad()
  page.data.document.categories.push({ id: 'sweet', name: '甜品', order: 1 })
  page.data.document.dishes.push({ ...page.data.document.dishes[0], id: 'cake', name: '草莓蛋糕', desc: '清甜', categoryId: 'sweet', tags: ['下午茶'] })
  page.refreshViews()
  page.changeSearch({ detail: { value: '下午茶' } })
  assert.equal(page.data.visibleDishes.map((item) => item.id).join(','), 'cake')
  page.changeSearch({ detail: { value: '' } })
  page.changeCategoryFilter({ detail: { value: 2 } })
  assert.equal(page.data.visibleDishes.map((item) => item.id).join(','), 'cake')
  assert.equal(page.data.dirty, false)
})

test('draft status distinguishes dirty saved and published while ignoring stale checks', async () => {
  let resolveCurrent
  const current = new Promise((resolve) => { resolveCurrent = resolve })
  const { page } = create({ getMenu: () => current })
  await page.onLoad()
  page.markChanged()
  resolveCurrent({ document: draft().document })
  await current
  await new Promise((resolve) => setImmediate(resolve))
  assert.equal(page.data.statusKind, 'dirty')
  assert.equal(page.data.statusText, '草稿未同步')
})

test('published status compares the same public projection when hidden dishes exist', async () => {
  const value = draft()
  value.document.dishes.push({ ...value.document.dishes[0], id: 'hidden', name: '隐藏菜', enabled: false })
  const publicDocument = { ...value.document, dishes: value.document.dishes.filter((dish) => dish.enabled !== false) }
  const { page } = create({ getDraft: async () => value, getMenu: async () => ({ version: 'v-hidden', document: publicDocument }), getRelease: async () => ({ version: 'v-hidden', document: value.document }) })
  await page.onLoad()
  await new Promise((resolve) => setImmediate(resolve))
  assert.equal(page.data.statusKind, 'published')
  assert.equal(page.data.statusText, '当前已是最新版本')
})

test('saved hidden-dish edits remain pending until their full snapshot is published', async () => {
  const current = draft()
  current.document.dishes.push({ ...current.document.dishes[0], id: 'hidden', name: '旧隐藏菜', enabled: false })
  const saved = JSON.parse(JSON.stringify(current))
  saved.document.dishes[1].name = '修改后的隐藏菜'
  const { page } = create({
    getDraft: async () => saved,
    getMenu: async () => ({ version: 'v-old', document: { ...current.document, dishes: current.document.dishes.filter((dish) => dish.enabled !== false) } }),
    getRelease: async () => ({ version: 'v-old', document: current.document })
  })
  await page.onLoad()
  await new Promise((resolve) => setImmediate(resolve))
  assert.equal(page.data.statusKind, 'saved')
  assert.equal(page.data.statusText, '草稿已保存，待发布')
})

test('history detail navigates to a version-locked visual preview', async () => {
  const { page, messages } = create()
  await page.onLoad()
  page.viewHistory({ currentTarget: { dataset: { version: 'v 1' } } })
  assert.equal(messages.at(-1).url, '/pages/menu-preview/menu-preview?version=v%201')
})

test('dish tools stay compact and visible dishes do not repeat a status badge', () => {
  const wxml = fs.readFileSync(path.join(__dirname, '../miniprogram/pages/menu-admin/menu-admin.wxml'), 'utf8')
  const wxss = fs.readFileSync(path.join(__dirname, '../miniprogram/pages/menu-admin/menu-admin.wxss'), 'utf8')
  assert.ok(wxml.includes('class="section-inline-title"'))
  assert.ok(wxss.includes('.section-inline-title'))
  assert.ok(wxss.includes('white-space: nowrap'))
  assert.ok(wxml.includes('wx:if="{{item.enabled === false}}" class="visibility-badge">菜单中隐藏'))
  assert.ok(!wxml.includes('发布后展示'))
})
