const test = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const vm = require('node:vm')

const { validateDishForm } = require('../miniprogram/services/menu-admin-validation')

function sampleDish() {
  return {
    id: 'dish_1', name: '番茄面', desc: '清淡', price: '0', categoryId: 'main', order: 0,
    enabled: true, tags: ['早餐'], imageAssetId: 'old_image',
    options: [{ id: 'spicy', name: '辣度', required: true, choices: [{ id: 'mild', name: '微辣' }] }]
  }
}

function createPage(apiOverrides = {}, wxOverrides = {}) {
  let definition
  const listeners = {}
  const emitted = []
  const channel = {
    on(name, handler) { listeners[name] = handler },
    emit(name, payload) { emitted.push({ name, payload }) }
  }
  const wx = {
    enableAlertBeforeUnload() {}, disableAlertBeforeUnload() {}, setNavigationBarTitle() {}, navigateBack() {},
    showModal: (options) => options.success({ confirm: true }), pageScrollTo() {}, nextTick: (fn) => fn(),
    ...wxOverrides
  }
  const api = { uploadImage: async () => ({ assetId: 'new_image', imageKey: 'menu/image.jpg', thumbnailKey: 'menu/thumb.webp' }), ...apiOverrides }
  const context = {
    setTimeout, clearTimeout, wx, Page: (value) => { definition = value },
    require: (name) => name.endsWith('menu-admin-validation') ? require('../miniprogram/services/menu-admin-validation') : api
  }
  vm.runInNewContext(fs.readFileSync(path.join(__dirname, '../miniprogram/pages/menu-dish-editor/menu-dish-editor.js'), 'utf8'), context)
  const page = { ...definition, data: JSON.parse(JSON.stringify(definition.data)), getOpenerEventChannel: () => channel }
  page.setData = (updates) => {
    for (const [key, value] of Object.entries(updates)) {
      const parts = key.replace(/\[(\d+)\]/g, '.$1').split('.')
      let target = page.data
      for (const part of parts.slice(0, -1)) target = target[part] || (target[part] = {})
      target[parts.at(-1)] = value
    }
  }
  page.onLoad()
  return { page, listeners, emitted, wx }
}

function init(pageBundle, overrides = {}) {
  const source = sampleDish()
  pageBundle.listeners['dishEditor:init']({
    mode: 'edit', dish: source, categories: [{ id: 'main', name: '主食' }, { id: 'drink', name: '饮品' }],
    images: { old_image: '/tmp/old.jpg' }, ...overrides
  })
  return source
}

test('shared validation returns stable field locations', () => {
  const dish = sampleDish()
  dish.name = ' '
  assert.deepEqual(validateDishForm(dish, ['main']), { message: '请填写菜名', fieldId: 'dish-name' })
  dish.name = '面'
  dish.options[0].choices[0].name = ''
  assert.deepEqual(validateDishForm(dish, new Set(['main'])), { message: '请填写规格的所有选项', fieldId: 'option-0-choice-0' })
  dish.options = [{ id: 'note', name: '备注', type: 'text', maxlength: 201 }]
  assert.deepEqual(validateDishForm(dish, ['main']), { message: '备注字数应为 1 到 200 的整数', fieldId: 'option-0-maxlength' })
})

test('init creates an isolated local copy and enables warning after edits', () => {
  let warnings = 0
  const bundle = createPage({}, { enableAlertBeforeUnload: () => { warnings++ } })
  const source = init(bundle)
  bundle.page.changeField({ currentTarget: { dataset: { field: 'name', fieldId: 'dish-name' } }, detail: { value: '新名字' } })
  assert.equal(bundle.page.data.dish.name, '新名字')
  assert.equal(source.name, '番茄面')
  assert.equal(bundle.page.data.dirty, true)
  assert.equal(warnings, 1)
})

test('invalid completion stays on page and scrolls to exact field', () => {
  let selector = ''
  const bundle = createPage({}, { pageScrollTo: (options) => { selector = options.selector } })
  init(bundle)
  bundle.page.data.dish.name = ''
  bundle.page.complete()
  assert.equal(bundle.emitted.length, 0)
  assert.equal(selector, '#dish-name')
  assert.equal(bundle.page.data.fieldErrors['dish-name'], '请填写菜名')
})

test('init focusField displays the supplied message and scrolls after render', () => {
  let selector = ''
  let nextTicks = 0
  const bundle = createPage({}, {
    nextTick: (callback) => { nextTicks++; callback() },
    pageScrollTo: (options) => { selector = options.selector }
  })
  init(bundle, { focusField: 'option-0-name', focusMessage: '请填写规格名称' })
  assert.equal(bundle.page.data.fieldErrors['option-0-name'], '请填写规格名称')
  assert.equal(bundle.page.data.error, '请填写规格名称')
  assert.equal(selector, '#option-0-name')
  assert.equal(nextTicks, 1)
})

test('init can derive focus message from shared validation', () => {
  const bundle = createPage()
  const dish = sampleDish()
  dish.name = ''
  init(bundle, { dish, focusField: 'dish-name' })
  assert.equal(bundle.page.data.fieldErrors['dish-name'], '请填写菜名')
})

test('commit sanitizes data and returns only the selected newly uploaded asset', async () => {
  let disabled = 0
  const bundle = createPage({}, {
    showActionSheet: (options) => options.success({ tapIndex: 1 }),
    chooseMedia: (options) => options.success({ tempFiles: [{ tempFilePath: '/tmp/new.jpg' }] }),
    disableAlertBeforeUnload: () => { disabled++ }
  })
  init(bundle)
  await bundle.page.chooseImage()
  bundle.page.data.dish.name = '  新菜  '
  bundle.page.data.dish.price = '99'
  bundle.page.complete()
  const commit = bundle.emitted.at(-1)
  assert.equal(commit.name, 'dishEditor:commit')
  assert.equal(commit.payload.dish.name, '新菜')
  assert.equal(commit.payload.dish.price, '0')
  assert.equal(commit.payload.dish.imageAssetId, 'new_image')
  assert.deepEqual(JSON.parse(JSON.stringify(commit.payload.assets)), { new_image: { imageKey: 'menu/image.jpg', thumbnailKey: 'menu/thumb.webp' } })
  assert.deepEqual(JSON.parse(JSON.stringify(commit.payload.images)), { new_image: '/tmp/new.jpg' })
  assert.ok(disabled >= 1)
})

test('upload failure preserves the dish image and other local fields', async () => {
  const bundle = createPage({ uploadImage: async () => { throw new Error('处理失败') } }, {
    showActionSheet: (options) => options.success({ tapIndex: 0 }),
    chooseMedia: (options) => options.success({ tempFiles: [{ tempFilePath: '/tmp/bad.jpg' }] })
  })
  init(bundle)
  bundle.page.data.dish.name = '保留内容'
  await bundle.page.chooseImage()
  assert.equal(bundle.page.data.dish.name, '保留内容')
  assert.equal(bundle.page.data.dish.imageAssetId, 'old_image')
  assert.equal(bundle.page.data.imageUrl, '/tmp/old.jpg')
  assert.equal(bundle.page.data.uploading, false)
  assert.match(bundle.page.data.error, /处理失败/)
})

test('missing opener image resolves privately and ignores stale asset results', async () => {
  let resolveImage
  const pending = new Promise((resolve) => { resolveImage = resolve })
  const bundle = createPage({ resolveAsset: () => pending })
  init(bundle, { images: {} })
  assert.equal(bundle.page.data.imageLoading, true)
  bundle.page.setData({ 'dish.imageAssetId': 'replacement' })
  resolveImage({ thumbnailUrl: 'https://example.test/old.webp' })
  await pending
  await new Promise((resolve) => setImmediate(resolve))
  assert.equal(bundle.page.data.imageUrl, '')
  assert.equal(bundle.page.data.dish.imageAssetId, 'replacement')
})

test('edit deletion emits stable id while create mode has no deletion action', async () => {
  const edit = createPage()
  init(edit)
  await edit.page.deleteDish()
  assert.deepEqual(edit.emitted, [{ name: 'dishEditor:delete', payload: 'dish_1' }])

  const create = createPage()
  init(create, { mode: 'create', dish: { categoryId: 'main' } })
  await create.page.deleteDish()
  assert.equal(create.emitted.length, 0)
})

test('WXML keeps validation messages local and upload feedback inside image field', () => {
  const source = fs.readFileSync(path.join(__dirname, '../miniprogram/pages/menu-dish-editor/menu-dish-editor.wxml'), 'utf8')
  assert.ok(source.includes('id="dish-name"'))
  assert.ok(source.includes('class="upload-mask"'))
  assert.ok(source.includes('mode === \'edit\''))
  assert.ok(source.includes('在公开菜单中显示'))
  assert.ok(source.includes('访客可以看到这道菜'))
  assert.ok(source.includes('菜品资料仍会保留'))
})
