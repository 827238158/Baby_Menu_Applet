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
const WXML_PATH = path.join(
  __dirname,
  '..',
  'miniprogram',
  'pages',
  'gifts',
  'gifts.wxml'
)
const CARD_WXML_PATH = path.join(
  __dirname,
  '..',
  'miniprogram',
  'components',
  'collection-item-card',
  'collection-item-card.wxml'
)
const PAGE_JSON_PATH = path.join(
  __dirname,
  '..',
  'miniprogram',
  'pages',
  'gifts',
  'gifts.json'
)
const STORAGE_KEY = 'baby_gift_folder_v1'
const DECOR_STORAGE_KEY = 'baby_decor_folder_v1'

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

function createWxMock(initialGifts = [], initialDecor = []) {
  const storage = new Map([
    [STORAGE_KEY, initialGifts],
    [DECOR_STORAGE_KEY, initialDecor]
  ])
  const toasts = []
  const actionSheets = []
  const modals = []
  const mediaChoices = []
  const imageEdits = []
  const saveRequests = []
  const removedSavedFiles = []
  const pageScrolls = []

  return {
    storage,
    toasts,
    actionSheets,
    modals,
    mediaChoices,
    imageEdits,
    saveRequests,
    removedSavedFiles,
    pageScrolls,
    actionSheetTapIndex: undefined,
    modalConfirm: false,
    getStorageSync(key) {
      return storage.get(key)
    },
    setStorageSync(key, value) {
      storage.set(key, value)
    },
    showToast(options) {
      toasts.push(options)
    },
    showActionSheet(options) {
      actionSheets.push(options)
      if (Number.isInteger(this.actionSheetTapIndex) && options.success) {
        options.success({ tapIndex: this.actionSheetTapIndex })
      }
    },
    chooseMedia(options) {
      mediaChoices.push(options)
    },
    editImage(options) {
      imageEdits.push(options)
    },
    showModal(options) {
      modals.push(options)
      if (options.success) {
        options.success({
          confirm: this.modalConfirm,
          cancel: !this.modalConfirm
        })
      }
    },
    navigateBack() {},
    pageScrollTo(options) {
      pageScrolls.push(options)
    },
    getFileSystemManager() {
      return {
        saveFile(options) {
          saveRequests.push(options)
        },
        removeSavedFile({ filePath, success }) {
          removedSavedFiles.push(filePath)
          if (success) success()
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

test('云端授权成功后才展示礼品列表，避免未授权账号看到本地缓存', async () => {
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
  assert.equal(page.data.gifts.length, 0)
  assert.equal(page.data.isInitialLoading, true)

  await waitForMicrotasks()
  assert.equal(page.data.gifts[0].name, '云端礼品')
  assert.equal(page.data.isInitialLoading, false)
  assert.equal(wxMock.storage.get(STORAGE_KEY)[0].id, 'gift_cloud123')
})

test('图片标识未变化时复用缓存展示地址并保留最新签名地址回退', async () => {
  const cachedImagePath = 'https://cos.example/cached.jpg?old-sign'
  const freshImageUrl = 'https://cos.example/fresh.jpg?new-sign'
  const cachedGift = {
    id: 'gift_same123',
    name: '缓存礼品',
    description: '',
    imagePath: cachedImagePath,
    imageUrl: cachedImagePath,
    imageKey: 'gift-folder/images/gift_same123/image.jpg',
    createdAt: 1,
    updatedAt: 1
  }
  const wxMock = createWxMock([cachedGift])
  const page = loadPage({
    isConfigured: () => true,
    listGifts: async () => ({
      items: [{
        id: cachedGift.id,
        name: '云端礼品',
        description: '',
        imageKey: cachedGift.imageKey,
        thumbnailUrl: freshImageUrl,
        createdAt: 1,
        updatedAt: 2
      }],
      total: 1,
      hasMore: false,
      nextCursor: ''
    })
  }, wxMock)

  page.onShow()
  await waitForMicrotasks()

  assert.equal(page.data.gifts[0].imagePath, cachedImagePath)
  assert.equal(page.data.gifts[0].imageUrl, freshImageUrl)
  assert.equal(wxMock.storage.get(STORAGE_KEY)[0].imagePath, cachedImagePath)
  assert.equal(wxMock.storage.get(STORAGE_KEY)[0].imageUrl, freshImageUrl)
})

test('图片标识变化时使用云端新图片地址', async () => {
  const wxMock = createWxMock([{
    id: 'gift_changed123',
    name: '旧礼品',
    description: '',
    imagePath: 'https://cos.example/old.jpg',
    imageUrl: 'https://cos.example/old.jpg',
    imageKey: 'gift-folder/images/gift_changed123/old.jpg',
    createdAt: 1,
    updatedAt: 1
  }])
  const freshImageUrl = 'https://cos.example/new.jpg?new-sign'
  const page = loadPage({
    isConfigured: () => true,
    listGifts: async () => ({
      items: [{
        id: 'gift_changed123',
        name: '新礼品',
        description: '',
        imageKey: 'gift-folder/images/gift_changed123/new.jpg',
        thumbnailUrl: freshImageUrl,
        createdAt: 1,
        updatedAt: 2
      }],
      total: 1,
      hasMore: false,
      nextCursor: ''
    })
  }, wxMock)

  page.onShow()
  await waitForMicrotasks()

  assert.equal(page.data.gifts[0].imagePath, freshImageUrl)
  assert.equal(page.data.gifts[0].imageUrl, freshImageUrl)
})

test('页面实例加载成功后重复 onShow 不会再次请求云端', async () => {
  const wxMock = createWxMock()
  let listCalls = 0
  const page = loadPage({
    isConfigured: () => true,
    listGifts: async () => {
      listCalls += 1
      return { items: [], total: 0, hasMore: false, nextCursor: '' }
    }
  }, wxMock)

  page.onShow()
  await waitForMicrotasks()
  page.onShow()
  await waitForMicrotasks()

  assert.equal(listCalls, 1)
  assert.equal(page.data.isInitialLoading, false)
})

test('云端请求失败后结束骨架并回退本地缓存', async () => {
  const cachedGift = {
    id: 'gift_cached123',
    name: '缓存礼品',
    description: '',
    imagePath: '',
    imageKey: '',
    createdAt: 1,
    updatedAt: 1
  }
  const wxMock = createWxMock([cachedGift])
  const page = loadPage({
    isConfigured: () => true,
    listGifts: async () => {
      throw new Error('网络连接失败')
    }
  }, wxMock)

  page.onShow()
  await waitForMicrotasks()

  assert.equal(page.data.isInitialLoading, false)
  assert.equal(page.data.gifts[0].id, cachedGift.id)
  assert.equal(wxMock.toasts.at(-1).title, '网络连接失败')
})

test('双分段懒加载装修好物并保持两区独立状态', async () => {
  let giftRequests = 0
  let decorRequests = 0
  const wxMock = createWxMock()
  const page = loadPage({
    isConfigured: () => true,
    listGifts: async () => {
      giftRequests += 1
      return {
        items: [{
          id: 'gift_cloud123',
          name: '云端礼品',
          description: '',
          createdAt: 2,
          updatedAt: 2
        }],
        total: 1,
        hasMore: false,
        nextCursor: ''
      }
    },
    listDecorItems: async () => {
      decorRequests += 1
      return {
        items: [{
          id: 'decor_cloud123',
          name: '胡桃木边几',
          description: '',
          createdAt: 3,
          updatedAt: 3
        }],
        total: 1,
        hasMore: false,
        nextCursor: ''
      }
    }
  }, wxMock)

  page.onShow()
  await waitForMicrotasks()
  assert.equal(page.data.gifts[0].id, 'gift_cloud123')
  assert.equal(decorRequests, 0)
  page.handleListScroll({ detail: { scrollTop: 128 } })

  page.switchCollection({ currentTarget: { dataset: { collection: 'decor' } } })
  assert.equal(page.data.activeCollection, 'decor')
  assert.equal(page.data.isInitialLoading, true)
  assert.equal(page.data.listScrollTop, 0)
  await waitForMicrotasks()

  assert.equal(page.data.gifts[0].id, 'decor_cloud123')
  assert.equal(page.data.collectionTitle, '装修好物')
  assert.equal(wxMock.storage.get(DECOR_STORAGE_KEY)[0].id, 'decor_cloud123')
  assert.equal(giftRequests, 1)
  assert.equal(decorRequests, 1)
  assert.equal(wxMock.pageScrolls.length, 0)

  page.handleListScroll({ detail: { scrollTop: 42 } })
  page.switchCollection({ currentTarget: { dataset: { collection: 'gift' } } })
  assert.equal(page.data.gifts[0].id, 'gift_cloud123')
  assert.equal(page.data.listScrollTop, 128)
  assert.equal(giftRequests, 1)
})

test('礼品列表包含加载骨架、启用图片懒加载并关闭默认淡入', () => {
  const source = fs.readFileSync(WXML_PATH, 'utf8')
  const cardSource = fs.readFileSync(CARD_WXML_PATH, 'utf8')
  const styleSource = fs.readFileSync(WXML_PATH.replace(/\.wxml$/, '.wxss'), 'utf8')

  assert.match(source, /gift-skeleton-card/)
  assert.match(source, /isInitialLoading/)
  assert.match(source, /bindscrolltolower="loadMoreGifts"/)
  assert.match(source, /<scroll-view[\s\S]*class="collection-list-scroll"/)
  assert.match(styleSource, /\.collection-list-scroll\s*\{[\s\S]*height:\s*0;/)
  assert.match(cardSource, /lazy-load="\{\{true\}\}"/)
  assert.match(cardSource, /fade-in="\{\{false\}\}"/)
})

test('心愿夹包含双分段、滑动指示器和装修房屋占位图', () => {
  const source = fs.readFileSync(WXML_PATH, 'utf8')
  const cardSource = fs.readFileSync(CARD_WXML_PATH, 'utf8')

  assert.match(source, /collection-segment-indicator/)
  assert.match(source, /data-collection="gift"/)
  assert.match(source, /data-collection="decor"/)
  assert.match(source, /collection-item-card/)
  assert.match(cardSource, /placeholder-house/)
  assert.match(source, /我的心愿夹/)
})

test('礼品卡片组件引用可以从页面目录解析到完整组件文件', () => {
  const pageConfig = JSON.parse(fs.readFileSync(PAGE_JSON_PATH, 'utf8'))
  const componentReference = pageConfig.usingComponents['collection-item-card']
  const componentBase = path.resolve(path.dirname(PAGE_JSON_PATH), componentReference)

  assert.equal(componentReference, '../../components/collection-item-card/collection-item-card')
  for (const extension of ['.js', '.json', '.wxml', '.wxss']) {
    assert.equal(fs.existsSync(componentBase + extension), true, componentBase + extension)
  }
})

test('图片表单由图片区触发选图，不显示选填和常驻来源按钮', () => {
  const source = fs.readFileSync(WXML_PATH, 'utf8')

  assert.match(source, /class="image-picker" bindtap="showImageSourceActions"/)
  assert.match(source, /class="image-picker-remove"[\s\S]*catchtap="confirmRemoveFormImage"/)
  assert.match(source, /<view[^>]*class="image-picker-remove"/)
  assert.doesNotMatch(source, /<button[^>]*class="image-picker-remove"/)
  assert.doesNotMatch(source, /image-picker-optional/)
  assert.doesNotMatch(source, /image-source-button/)
  assert.doesNotMatch(source, /image-picker-actions/)
})

test('图片来源菜单按拍照和相册顺序调用微信选图', () => {
  const cameraWx = createWxMock()
  cameraWx.actionSheetTapIndex = 0
  const cameraPage = loadPage({ isConfigured: () => false }, cameraWx)
  cameraPage.openCreateForm()

  cameraPage.showImageSourceActions()

  assert.equal(cameraWx.actionSheets[0].itemList.join('|'), '拍照|从相册选择')
  assert.equal(cameraWx.mediaChoices[0].sourceType[0], 'camera')

  const albumWx = createWxMock()
  albumWx.actionSheetTapIndex = 1
  const albumPage = loadPage({ isConfigured: () => false }, albumWx)
  albumPage.openCreateForm()

  albumPage.showImageSourceActions()

  assert.equal(albumWx.mediaChoices[0].sourceType[0], 'album')
})

test('拍照成功后先进入微信图片编辑器，再保存编辑结果', () => {
  const wxMock = createWxMock()
  const page = loadPage({ isConfigured: () => false }, wxMock)
  page.openCreateForm()
  let savedPath = ''
  page.saveSelectedImage = (filePath) => { savedPath = filePath }

  page.chooseImage('camera')
  wxMock.mediaChoices[0].success({
    tempFiles: [{ tempFilePath: 'wxfile://camera-original.jpg' }]
  })

  assert.equal(wxMock.imageEdits[0].src, 'wxfile://camera-original.jpg')
  assert.equal(savedPath, '')

  wxMock.imageEdits[0].success({ tempFilePath: 'wxfile://camera-edited.jpg' })
  assert.equal(savedPath, 'wxfile://camera-edited.jpg')
})

test('取消拍照图片编辑不保存原图，也不显示失败提示', () => {
  const wxMock = createWxMock()
  const page = loadPage({ isConfigured: () => false }, wxMock)
  page.openCreateForm()
  let savedPath = ''
  page.saveSelectedImage = (filePath) => { savedPath = filePath }
  const toastCountBeforeCancel = wxMock.toasts.length

  page.prepareSelectedImage('wxfile://camera-original.jpg', 'camera')
  wxMock.imageEdits[0].fail({ errMsg: 'editImage:fail cancel' })

  assert.equal(savedPath, '')
  assert.equal(wxMock.toasts.length, toastCountBeforeCancel)
})

test('旧客户端不支持图片编辑时保留拍照原图预览', () => {
  const wxMock = createWxMock()
  delete wxMock.editImage
  const page = loadPage({ isConfigured: () => false }, wxMock)
  page.openCreateForm()
  let savedPath = ''
  page.saveSelectedImage = (filePath) => { savedPath = filePath }

  page.prepareSelectedImage('wxfile://camera-original.jpg', 'camera')

  assert.equal(savedPath, 'wxfile://camera-original.jpg')
})

test('选图后只保存本地原图用于表单预览，不再本地压缩', () => {
  const source = fs.readFileSync(PAGE_PATH, 'utf8')
  const wxMock = createWxMock()
  const page = loadPage({ isConfigured: () => false }, wxMock)
  page.openCreateForm()

  page.saveSelectedImage('wxfile://selected-temp.jpg')
  wxMock.saveRequests[0].success({ savedFilePath: 'wxfile://selected-saved.jpg' })

  assert.equal(page.pendingImagePath, 'wxfile://selected-saved.jpg')
  assert.equal(page.data.form.imagePath, 'wxfile://selected-saved.jpg')
  assert.equal(Object.hasOwn(page, 'pendingThumbnailPath'), false)
  assert.doesNotMatch(source, /compressImage|createThumbnail|pendingThumbnailPath/)
})

test('移除预览图需要二次确认且只修改当前表单', () => {
  const wxMock = createWxMock()
  const page = loadPage({ isConfigured: () => false }, wxMock)
  page.data.form.imagePath = 'wxfile://selected.jpg'
  page.data.form.imageKey = 'gift-folder/images/selected.jpg'

  page.confirmRemoveFormImage()

  assert.equal(wxMock.modals[0].title, '移除图片')
  assert.equal(page.data.form.imagePath, 'wxfile://selected.jpg')

  wxMock.modalConfirm = true
  page.confirmRemoveFormImage()

  assert.equal(page.data.form.imagePath, '')
  assert.equal(page.data.form.imageKey, '')
})

test('保存、删除或表单关闭期间禁止选图和移除', () => {
  for (const state of ['isSaving', 'isDeleting', 'formClosing']) {
    const wxMock = createWxMock()
    wxMock.actionSheetTapIndex = 0
    wxMock.modalConfirm = true
    const page = loadPage({ isConfigured: () => false }, wxMock)
    page.data.form.imagePath = 'wxfile://selected.jpg'
    page.data[state] = true

    page.showImageSourceActions()
    page.confirmRemoveFormImage()
    page.removeFormImage()

    assert.equal(wxMock.actionSheets.length, 0)
    assert.equal(wxMock.modals.length, 0)
    assert.equal(page.data.form.imagePath, 'wxfile://selected.jpg')
  }
})

test('旧选图保存回调晚到时只清理自己的持久文件', () => {
  const wxMock = createWxMock()
  const page = loadPage({ isConfigured: () => false }, wxMock)
  page.openCreateForm()
  const firstGeneration = page.imageSelectionGeneration

  page.saveSelectedImage('wxfile://first-temp.jpg', firstGeneration)
  page.chooseImage('album')
  wxMock.saveRequests[0].success({ savedFilePath: 'wxfile://first-saved.jpg' })

  assert.deepEqual(wxMock.removedSavedFiles, ['wxfile://first-saved.jpg'])
  assert.equal(page.data.form.imagePath, '')
  assert.equal(page.pendingImagePath, '')
})

test('页面卸载后的选图回调不会写回页面并清理晚到文件', () => {
  const wxMock = createWxMock()
  const page = loadPage({ isConfigured: () => false }, wxMock)
  page.openCreateForm()
  const generation = page.imageSelectionGeneration

  page.saveSelectedImage('wxfile://pending-temp.jpg', generation)
  page.onUnload()
  wxMock.saveRequests[0].success({ savedFilePath: 'wxfile://late-saved.jpg' })

  assert.deepEqual(wxMock.removedSavedFiles, ['wxfile://late-saved.jpg'])
  assert.equal(page.data.form.imagePath, '')
})

test('创建失败重试复用同一礼品 ID，并采用云端总数', async () => {
  const wxMock = createWxMock()
  const receivedIds = []
  let attempts = 0
  const page = loadPage({
    isConfigured: () => true,
    createGift: async (payload) => {
      receivedIds.push(payload.id)
      attempts += 1
      if (attempts === 1) throw new Error('响应丢失')
      return Object.assign({}, payload, {
        total: 25,
        createdAt: 20,
        updatedAt: 20
      })
    }
  }, wxMock)
  page.openCreateForm()
  page.handleNameInput({ detail: { value: '幂等礼品' } })

  await page.saveGift()
  await page.saveGift()

  assert.equal(receivedIds.length, 2)
  assert.equal(receivedIds[0], receivedIds[1])
  assert.equal(page.data.giftCount, 25)
  assert.equal(page.data.hasMore, true)
})

test('分页合并按 ID 去重并保留云端总数', async () => {
  const wxMock = createWxMock()
  let call = 0
  const duplicate = {
    id: 'gift_duplicate1',
    name: '重复礼品',
    description: '',
    imageKey: '',
    thumbnailKey: '',
    createdAt: 2,
    updatedAt: 2
  }
  const page = loadPage({
    isConfigured: () => true,
    listGifts: async () => {
      call += 1
      return call === 1
        ? { items: [duplicate], total: 21, hasMore: true, nextCursor: 'cursor-1' }
        : {
            items: [
              Object.assign({}, duplicate, { name: '云端更新后的礼品', updatedAt: 3 }),
              Object.assign({}, duplicate, { id: 'gift_unique0001', createdAt: 1 })
            ],
            total: 21,
            hasMore: false,
            nextCursor: ''
          }
    }
  }, wxMock)

  await page.refreshCloudGifts(true)
  await page.refreshCloudGifts(false)

  assert.deepEqual(Array.from(page.data.gifts, (item) => item.id), ['gift_duplicate1', 'gift_unique0001'])
  assert.equal(page.data.gifts[0].name, '云端更新后的礼品')
  assert.equal(page.data.giftCount, 21)
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

test('在装修分段新增时使用 decor ID、接口和独立缓存', async () => {
  let received
  const wxMock = createWxMock()
  const page = loadPage({
    isConfigured: () => true,
    listGifts: async () => ({ items: [], total: 0, hasMore: false }),
    listDecorItems: async () => ({ items: [], total: 0, hasMore: false }),
    createDecorItem: async (item) => {
      received = item
      return Object.assign({}, item, {
        total: 1,
        createdAt: 10,
        updatedAt: 10
      })
    }
  }, wxMock)

  page.onShow()
  await waitForMicrotasks()
  page.switchCollection({ currentTarget: { dataset: { collection: 'decor' } } })
  await waitForMicrotasks()
  page.openCreateForm()
  page.handleNameInput({ detail: { value: '原木边几' } })
  await page.saveGift()

  assert.match(received.id, /^decor_/)
  assert.equal(received.name, '原木边几')
  assert.equal(page.data.gifts[0].id, received.id)
  assert.equal(wxMock.storage.get(DECOR_STORAGE_KEY)[0].id, received.id)
  assert.equal(wxMock.storage.get(STORAGE_KEY).length, 0)
})

test('编辑中的收藏项可以整体移动到另一分段', async () => {
  const wxMock = createWxMock()
  const cloudGift = {
    id: 'gift_move1234',
    name: '胡桃木边几',
    description: '适合客厅',
    imageKey: 'gift-folder/images/gift_move1234/image.jpg',
    thumbnailKey: 'gift-folder/thumbnails/gift_move1234/thumb.jpg',
    thumbnailUrl: 'https://cos.example/thumb.jpg',
    createdAt: 10,
    updatedAt: 10
  }
  const page = loadPage({
    isConfigured: () => true,
    listGifts: async () => ({ items: [cloudGift], total: 1, hasMore: false, nextCursor: '' }),
    moveCollectionItem: async (id, targetCollection) => {
      assert.equal(id, cloudGift.id)
      assert.equal(targetCollection, 'decor')
      return {
        item: Object.assign({}, cloudGift, { updatedAt: 11 }),
        sourceTotal: 0,
        targetTotal: 1
      }
    }
  }, wxMock)

  page.onShow()
  await waitForMicrotasks()
  page.openEditForm({ detail: { id: cloudGift.id }, currentTarget: { dataset: {} } })
  await page.moveCollectionItem(page.data.gifts[0], 'gift', 'decor')

  assert.equal(page.data.activeCollection, 'decor')
  assert.equal(page.data.isInitialLoading, false)
  assert.equal(page.data.gifts[0].id, cloudGift.id)
  assert.equal(page.collectionStates.gift.giftCount, 0)
  assert.equal(page.collectionStates.decor.giftCount, 1)
  assert.equal(wxMock.storage.get(STORAGE_KEY).length, 0)
  assert.equal(wxMock.storage.get(DECOR_STORAGE_KEY)[0].id, cloudGift.id)
})

test('图片上传失败时保留表单且不调用礼品保存', async () => {
  const wxMock = createWxMock()
  let createCalled = false
  const page = loadPage({
    isConfigured: () => true,
    uploadImages: async () => {
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

test('新图保存只向上传服务传入本地原图、ID 和分段', async () => {
  const wxMock = createWxMock()
  let uploadArguments
  const page = loadPage({
    isConfigured: () => true,
    uploadImages: async (...args) => {
      uploadArguments = args
      return {
        imageKey: 'gift-folder/decor/images/decor_12345678/original.jpg',
        thumbnailKey: 'gift-folder/decor/thumbnails/decor_12345678/original.webp'
      }
    },
    createDecorItem: async (item) => Object.assign({}, item, {
      total: 1,
      createdAt: 10,
      updatedAt: 10
    })
  }, wxMock)
  page.data.activeCollection = 'decor'
  page.formCollection = 'decor'
  page.data.formVisible = true
  page.data.form = {
    id: 'decor_12345678',
    imagePath: 'wxfile://selected.jpg',
    imageKey: '',
    thumbnailKey: '',
    name: '',
    description: ''
  }
  page.pendingImagePath = 'wxfile://selected.jpg'

  await page.saveGift()

  assert.deepEqual(Array.from(uploadArguments), [
    'wxfile://selected.jpg',
    'decor_12345678',
    'decor'
  ])
})

test('云端保存失败后继续清理新生成的原图和缩略图', async () => {
  const wxMock = createWxMock()
  const cleanedKeys = []
  const imageKey = 'gift-folder/images/gift_12345678/original.jpg'
  const thumbnailKey = 'gift-folder/thumbnails/gift_12345678/original.webp'
  const page = loadPage({
    isConfigured: () => true,
    uploadImages: async () => ({ imageKey, thumbnailKey }),
    createGift: async () => {
      throw new Error('保存失败')
    },
    deleteOrphan: async (key) => {
      cleanedKeys.push(key)
    }
  }, wxMock)
  page.data.formVisible = true
  page.data.form = {
    id: 'gift_12345678',
    imagePath: 'wxfile://selected.jpg',
    imageKey: '',
    thumbnailKey: '',
    name: '',
    description: ''
  }
  page.pendingImagePath = 'wxfile://selected.jpg'

  await page.saveGift()
  await waitForMicrotasks()

  assert.deepEqual(cleanedKeys.sort(), [imageKey, thumbnailKey].sort())
  assert.equal(page.data.formVisible, true)
  assert.equal(page.data.form.imagePath, 'wxfile://selected.jpg')
})

test('白名单外账号只显示受限状态，不展示本地缓存礼品', () => {
  const wxMock = createWxMock([{
    id: 'gift_cached123',
    name: '本地礼品',
    description: '',
    imagePath: '',
    createdAt: 1,
    updatedAt: 1
  }])
  const page = loadPage({ isConfigured: () => false }, wxMock)
  page.loadGifts()

  const error = new Error('当前微信账号无权访问礼品夹')
  error.code = 'FORBIDDEN'
  page.handleCloudError(error, '')

  assert.equal(page.data.accessDenied, true)
  assert.equal(page.data.gifts.length, 0)
  assert.equal(page.data.giftCount, 0)
  assert.equal(page.data.hasMore, false)
  assert.equal(page.data.isInitialLoading, false)
})

test('填写礼品名称仅更新本地表单，点击保存后才创建礼品', async () => {
  const wxMock = createWxMock()
  let received
  const page = loadPage({
    isConfigured: () => true,
    createGift: async (gift) => {
      received = gift
      return Object.assign({}, gift, { createdAt: 12, updatedAt: 12 })
    }
  }, wxMock)
  page.openCreateForm()
  page.handleNameInput({ detail: { value: '自动保存礼品' } })

  assert.equal(received, undefined)
  assert.equal(page.data.saveDisabled, false)

  await page.saveGift()

  assert.equal(received.name, '自动保存礼品')
  assert.equal(page.data.gifts.length, 1)
  assert.equal(page.data.formVisible, false)
})

test('无待保存内容时点击遮罩会启动抽屉滑出动画', () => {
  const wxMock = createWxMock()
  const page = loadPage({ isConfigured: () => false }, wxMock)
  page.openCreateForm()

  page.requestCloseForm()

  assert.equal(page.data.formClosing, true)
  assert.match(page.data.formSheetStyle, /translateY\(100%\)/)
  clearTimeout(page.closeTimer)
})

test('关闭抽屉时不会保存未提交的内容', () => {
  const wxMock = createWxMock()
  let createCalled = false
  const page = loadPage({
    isConfigured: () => true,
    createGift: async () => { createCalled = true }
  }, wxMock)
  page.openCreateForm()
  page.handleDescriptionInput({ detail: { value: '未提交内容' } })

  page.requestCloseForm()

  assert.equal(createCalled, false)
  assert.equal(page.data.formClosing, true)
  clearTimeout(page.closeTimer)
})

test('保存失败时保留表单与本地图片预览', async () => {
  const wxMock = createWxMock()
  const page = loadPage({
    isConfigured: () => true,
    createGift: async () => {
      throw new Error('网络连接失败')
    }
  }, wxMock)
  page.data.formVisible = true
  page.data.form = {
    id: '',
    imagePath: 'wxfile://local-preview.jpg',
    imageKey: '',
    thumbnailKey: '',
    name: '保存失败礼品',
    description: ''
  }

  await page.saveGift()
  await waitForMicrotasks()

  assert.equal(page.data.formVisible, true)
  assert.equal(page.data.formClosing, false)
  assert.equal(page.data.form.imagePath, 'wxfile://local-preview.jpg')
})

test('顶部下滑超过阈值时也会启动抽屉滑出动画', () => {
  const wxMock = createWxMock()
  const page = loadPage({ isConfigured: () => false }, wxMock)
  page.openCreateForm()

  page.handleFormDragStart({ touches: [{ clientY: 100 }] })
  page.handleFormDragEnd({ changedTouches: [{ clientY: 200 }] })

  assert.equal(page.data.formClosing, true)
  clearTimeout(page.closeTimer)
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

test('云端删除成功后等待卡片退场再移除列表数据', async () => {
  const gift = {
    id: 'gift_remove123',
    name: '待删除礼品',
    description: '',
    imagePath: '',
    imageKey: '',
    createdAt: 1,
    updatedAt: 1,
    displayName: '待删除礼品'
  }
  const paginatedGift = {
    id: 'gift_paginated123',
    name: '动画期间加载的礼品',
    description: '',
    imagePath: '',
    imageKey: '',
    createdAt: 2,
    updatedAt: 2,
    displayName: '动画期间加载的礼品'
  }
  const wxMock = createWxMock([gift])
  const page = loadPage({
    isConfigured: () => true,
    deleteGift: async () => ({ total: 1 })
  }, wxMock)
  const state = page.getCollectionState('gift')
  state.gifts = [gift]
  state.giftCount = 1
  page.data.gifts = [gift]
  page.data.giftCount = 1
  page.data.formVisible = true
  page.data.isEditing = true
  page.data.form = Object.assign({}, gift)

  setTimeout(() => {
    // 模拟删除动画期间完成的分页请求，列表与游标均已推进。
    state.gifts = [gift, paginatedGift]
    state.giftCount = 1
    state.hasMore = false
    state.nextCursor = 'cursor-after-paginated'
    page.persistGifts(state.gifts, 'gift')
    page.setActiveCollectionData('gift')
  }, 300)

  await page.deleteGift(gift)

  assert.equal(page.data.formVisible, false)
  assert.equal(page.data.removingGiftId, '')
  assert.equal(page.data.gifts.map((item) => item.id).join(','), paginatedGift.id)
  assert.equal(
    wxMock.storage.get(STORAGE_KEY).map((item) => item.id).join(','),
    paginatedGift.id
  )
  assert.equal(state.nextCursor, 'cursor-after-paginated')
  assert.equal(state.hasMore, false)
})
