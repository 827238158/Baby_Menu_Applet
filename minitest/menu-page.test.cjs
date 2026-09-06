'use strict'

const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const test = require('node:test')
const vm = require('node:vm')

const PAGE_PATH = path.join(__dirname, '..', 'miniprogram', 'services', 'menu-page.js')
const STORAGE_KEY = 'baby_menu_cart_v1'
const MENU_DATA = {
  shop: { name: '测试菜单' },
  categories: [{
    id: 'drinks',
    name: '饮品',
    items: [{
      id: 'tea',
      name: '果茶',
      price: '0',
      options: [
        {
          id: 'size',
          name: '杯型',
          required: true,
          choices: [
            { id: 'small', name: '小杯' },
            { id: 'large', name: '大杯' }
          ]
        },
        {
          id: 'remark',
          name: '备注',
          type: 'text',
          required: false,
          maxlength: 40
        }
      ]
    }]
  }]
}

function setByPath(target, key, value) {
  const parts = key.split('.')
  let current = target
  while (parts.length > 1) {
    const part = parts.shift()
    current[part] = current[part] || {}
    current = current[part]
  }
  current[parts[0]] = value
}

function createWxMock(storedItems) {
  const storage = new Map()
  if (storedItems !== undefined) storage.set(STORAGE_KEY, storedItems)

  return {
    storage,
    toasts: [],
    failWrites: false,
    showShareMenu() {},
    getStorageSync(key) {
      return storage.get(key)
    },
    setStorageSync(key, value) {
      if (this.failWrites) throw new Error('storage full')
      storage.set(key, value)
    },
    removeStorageSync(key) {
      if (this.failWrites) throw new Error('storage full')
      storage.delete(key)
    },
    showToast(options) {
      this.toasts.push(options)
    },
    navigateTo() {},
    setClipboardData() {}
  }
}

function loadPage(wxMock) {
  let definition
  const source = fs.readFileSync(PAGE_PATH, 'utf8')
  const sandbox = {
    __menuData: MENU_DATA,
    module: { exports: {} },
    require: require('node:module').createRequire(PAGE_PATH),
    console,
    Page(config) {
      definition = config
    },
    wx: wxMock,
    setTimeout,
    clearTimeout
  }

  vm.runInNewContext(source, sandbox, { filename: PAGE_PATH })
  definition = sandbox.module.exports.createMenuPage({ initialMenu: MENU_DATA, wxApi: wxMock })
  const page = Object.assign({}, definition)
  page.data = JSON.parse(JSON.stringify(definition.data))
  page.setData = function setData(patch, callback) {
    for (const [key, value] of Object.entries(patch)) {
      setByPath(this.data, key, value)
    }
    if (callback) callback()
  }
  page.onLoad()
  return page
}

test('规范化 JSON 组合键不会被分隔符碰撞', () => {
  const wxMock = createWxMock()
  const page = loadPage(wxMock)
  const dish = page.findDish('tea')
  const first = page.getSelectionKey(dish, { size: 'small', remark: 'x|remark:y' })
  const second = page.getSelectionKey(dish, { size: 'small', remark: 'x:remark|y' })

  assert.match(first, /^v2:/)
  assert.notEqual(first, second)
})

test('可无歧义解析的旧缓存会验证并重写为 v2', () => {
  const wxMock = createWxMock([{
    id: 'tea',
    selectionKey: 'tea|size:small|remark:',
    quantity: 2,
    name: '伪造名称',
    optionText: '伪造规格'
  }])
  const page = loadPage(wxMock)
  const stored = wxMock.storage.get(STORAGE_KEY)

  assert.equal(page.data.selectedItems.length, 1)
  assert.equal(page.data.selectedItems[0].name, '果茶')
  assert.equal(page.data.selectedItems[0].optionText, '小杯')
  assert.match(stored[0].selectionKey, /^v2:/)
  assert.deepEqual(JSON.parse(JSON.stringify(stored[0].optionSelections)), {
    size: 'small',
    remark: ''
  })
})

test('非法数量和已失效规格不会恢复到购物车', () => {
  const wxMock = createWxMock([
    { id: 'tea', selectionKey: 'tea|size:small|remark:', quantity: 1.5 },
    { id: 'tea', selectionKey: 'tea|size:small|remark:', quantity: Infinity },
    { id: 'tea', selectionKey: 'tea|size:removed|remark:', quantity: 1 },
    { id: 'tea', selectionKey: 'tea|size:small|remark:', quantity: 100 },
    { id: 'tea', optionSelections: { size: 'small', remark: '', removedOption: 'x' }, quantity: 1 },
    { id: 'tea', selectionKey: 'tea|size:small|remark:', quantity: '2' }
  ])
  const page = loadPage(wxMock)

  assert.equal(page.data.selectedItems.length, 0)
  assert.equal(wxMock.storage.has(STORAGE_KEY), false)
})

test('单项数量上限为 99', () => {
  const wxMock = createWxMock()
  const page = loadPage(wxMock)
  const dish = page.findDish('tea')
  const optionSelections = { size: 'small', remark: '' }
  const selectionKey = page.getSelectionKey(dish, optionSelections)

  assert.equal(page.updateSelected([{ id: 'tea', optionSelections, quantity: 99 }]), true)
  page.increaseCartItem({ currentTarget: { dataset: { key: selectionKey } } })

  assert.equal(page.data.selectedItems[0].quantity, 99)
  assert.equal(wxMock.toasts.at(-1).title, '每项最多 99 份')
})

test('存储失败时不提交页面购物车状态', () => {
  const wxMock = createWxMock()
  const page = loadPage(wxMock)
  const dish = page.findDish('tea')
  wxMock.failWrites = true

  page.addDishWithSelections(dish, { size: 'small', remark: '' })

  assert.equal(page.data.selectedItems.length, 0)
  assert.equal(wxMock.toasts.at(-1).title, '购物车保存失败')
})

test('加购时只为目标数量和购物袋设置微动效标记', () => {
  const wxMock = createWxMock()
  const page = loadPage(wxMock)
  const dish = page.findDish('tea')

  page.addDishWithSelections(dish, { size: 'small', remark: '' })

  assert.match(page.data.selectedItems[0].quantityMotionClass, /^quantity-pop-[ab]$/)
  assert.equal(page.data.activeItems[0].quantityMotionClass, page.data.cartMotionClass)
})
