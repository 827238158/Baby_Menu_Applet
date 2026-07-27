'use strict'

const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const test = require('node:test')
const vm = require('node:vm')

const PAGE_PATH = path.join(
  __dirname,
  '..',
  'miniprogram',
  'pages',
  'gifts',
  'gifts.js'
)
const STORAGE_KEY = 'baby_gift_folder_v1'

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

function createWxMock(initialGifts = []) {
  const storage = new Map([[STORAGE_KEY, initialGifts]])
  const toasts = []

  return {
    storage,
    toasts,
    getStorageSync(key) {
      return storage.get(key)
    },
    setStorageSync(key, value) {
      storage.set(key, value)
    },
    showToast(options) {
      toasts.push(options)
    },
    showModal() {},
    navigateBack() {},
    getFileSystemManager() {
      return {
        removeSavedFile({ fail }) {
          if (fail) {
            fail()
          }
        }
      }
    }
  }
}

function loadPage(giftApi, wxMock) {
  let definition
  const source = fs.readFileSync(PAGE_PATH, 'utf8')
    .replace(
      "import menuData from '../../data/menu-data.js'",
      'const menuData = __menuData'
    )
    .replace(
      "const giftApi = require('../../services/gift-api.js')",
      'const giftApi = __giftApi'
    )
  const sandbox = {
    __giftApi: giftApi,
    __menuData: { shop: {} },
    console,
    Page(config) {
      definition = config
    },
    wx: wxMock,
    setTimeout,
    clearTimeout
  }

  vm.runInNewContext(source, sandbox, { filename: PAGE_PATH })

  const page = Object.assign({}, definition)
  page.data = JSON.parse(JSON.stringify(definition.data))
  page.setData = function setData(patch) {
    for (const [key, value] of Object.entries(patch)) {
      setByPath(this.data, key, value)
    }
  }
  page.onLoad()
  return page
}

function waitForMicrotasks() {
  return new Promise((resolve) => setImmediate(resolve))
}

test('页面先展示本地缓存，再用云端列表覆盖缓存', async () => {
  const localGift = {
    id: 'gift_local123',
    name: '本地缓存',
    description: '',
    imagePath: '',
    createdAt: 1,
    updatedAt: 1
  }
  const cloudGift = {
    id: 'gift_cloud123',
    name: '云端礼品',
    description: '',
    imageKey: '',
    imageUrl: '',
    createdAt: 2,
    updatedAt: 2
  }
  const wxMock = createWxMock([localGift])
  const page = loadPage({
    isConfigured: () => true,
    listGifts: async () => [cloudGift]
  }, wxMock)

  page.onShow()
  assert.equal(page.data.gifts[0].name, '本地缓存')

  await waitForMicrotasks()
  assert.equal(page.data.gifts[0].name, '云端礼品')
  assert.equal(wxMock.storage.get(STORAGE_KEY)[0].id, 'gift_cloud123')
})

test('仅文字礼品在云端成功后才进入页面与缓存', async () => {
  const wxMock = createWxMock()
  let received
  const page = loadPage({
    isConfigured: () => true,
    createGift: async (gift) => {
      received = gift
      return Object.assign({}, gift, {
        imageUrl: '',
        createdAt: 10,
        updatedAt: 10
      })
    }
  }, wxMock)

  page.data.formVisible = true
  page.data.form = {
    id: '',
    imagePath: '',
    imageKey: '',
    name: '手工杯',
    description: ''
  }
  page.initialForm = {
    id: '',
    imagePath: '',
    imageKey: '',
    name: '',
    description: ''
  }

  await page.saveGift()

  assert.equal(received.name, '手工杯')
  assert.equal(page.data.gifts.length, 1)
  assert.equal(wxMock.storage.get(STORAGE_KEY).length, 1)
  assert.equal(page.data.formVisible, false)
})

test('图片上传失败时保留表单且不调用礼品保存', async () => {
  const wxMock = createWxMock()
  let createCalled = false
  const page = loadPage({
    isConfigured: () => true,
    uploadImage: async () => {
      const error = new Error('图片上传失败')
      error.code = 'IMAGE_UPLOAD_FAILED'
      throw error
    },
    createGift: async () => {
      createCalled = true
    }
  }, wxMock)

  page.data.formVisible = true
  page.data.form = {
    id: '',
    imagePath: 'wxfile://selected.jpg',
    imageKey: '',
    name: '',
    description: ''
  }
  page.pendingImagePath = 'wxfile://selected.jpg'

  await page.saveGift()

  assert.equal(createCalled, false)
  assert.equal(page.data.formVisible, true)
  assert.equal(page.data.form.imagePath, 'wxfile://selected.jpg')
  assert.equal(page.data.gifts.length, 0)
  assert.equal(wxMock.toasts.at(-1).title, '图片上传失败')
})

test('云端删除失败时不修改页面列表和本地缓存', async () => {
  const gift = {
    id: 'gift_12345678',
    name: '保留礼品',
    description: '',
    imagePath: '',
    imageKey: '',
    createdAt: 1,
    updatedAt: 1,
    displayName: '保留礼品'
  }
  const wxMock = createWxMock([gift])
  const page = loadPage({
    isConfigured: () => true,
    deleteGift: async () => {
      throw new Error('删除失败')
    }
  }, wxMock)
  page.data.gifts = [gift]

  await page.deleteGift(gift)

  assert.equal(page.data.gifts.length, 1)
  assert.equal(wxMock.storage.get(STORAGE_KEY).length, 1)
  assert.equal(page.data.isDeleting, false)
})
