'use strict'

const assert = require('node:assert/strict')
const test = require('node:test')

const giftApiModule = require('../miniprogram/services/gift-api.js')

function createWxMock(handler, options = {}) {
  const storage = new Map()
  const requests = []

  if (options.session) {
    storage.set(giftApiModule.SESSION_STORAGE_KEY, options.session)
  }

  return {
    requests,
    storage,
    getStorageSync(key) {
      return storage.get(key)
    },
    setStorageSync(key, value) {
      storage.set(key, value)
    },
    removeStorageSync(key) {
      storage.delete(key)
    },
    login({ success }) {
      success({ code: 'fresh-wx-code' })
    },
    request(options) {
      requests.push(options)
      handler(options)
    },
    getFileSystemManager() {
      return {
        getFileInfo({ success }) {
          success({ size: options.fileSize || 1024 })
        },
        readFile({ success }) {
          success({ data: new ArrayBuffer(16) })
        }
      }
    },
    getImageInfo({ success }) {
      success({ type: options.imageType || 'jpeg' })
    }
  }
}

function validSession(token = 'stored-token') {
  return {
    token,
    expiresAt: Date.now() + 60 * 60 * 1000
  }
}

test('列表请求遇到 401 时清理旧令牌并自动登录重试一次', async () => {
  let giftAttempts = 0
  const wxMock = createWxMock((options) => {
    if (options.url.endsWith('/auth/login')) {
      options.success({
        statusCode: 200,
        data: {
          data: validSession('fresh-token')
        }
      })
      return
    }

    giftAttempts += 1
    if (giftAttempts === 1) {
      options.success({
        statusCode: 401,
        data: {
          error: { code: 'UNAUTHORIZED', message: 'expired' }
        }
      })
      return
    }

    options.success({
      statusCode: 200,
      data: { data: [{ id: 'gift_12345678', name: '礼品' }] }
    })
  }, {
    session: validSession()
  })
  const api = giftApiModule.createGiftApi(wxMock, {
    apiBaseUrl: 'https://gift.example'
  })
  const gifts = await api.listGifts()

  assert.equal(gifts.length, 1)
  assert.equal(giftAttempts, 2)
  assert.equal(
    wxMock.storage.get(giftApiModule.SESSION_STORAGE_KEY).token,
    'fresh-token'
  )
})

test('图片通过预签名 PUT 直接上传 COS', async () => {
  const imageKey = 'gift-folder/images/gift_12345678/test.jpg'
  const wxMock = createWxMock((options) => {
    if (options.url.endsWith('/uploads/presign')) {
      options.success({
        statusCode: 200,
        data: {
          data: {
            imageKey,
            uploadUrl: 'https://bucket.cos.example/test.jpg?signed=1',
            contentType: 'image/jpeg'
          }
        }
      })
      return
    }

    if (options.method === 'PUT') {
      options.success({ statusCode: 200, data: '' })
    }
  }, {
    session: validSession()
  })
  const api = giftApiModule.createGiftApi(wxMock, {
    apiBaseUrl: 'https://gift.example'
  })
  const result = await api.uploadImage(
    'wxfile://selected.jpg',
    'gift_12345678'
  )

  assert.equal(result, imageKey)
  assert.equal(wxMock.requests[1].method, 'PUT')
  assert.equal(wxMock.requests[1].header['content-type'], 'image/jpeg')
  assert.ok(wxMock.requests[1].data instanceof ArrayBuffer)
})

test('图片上传失败时返回明确错误，不会继续保存礼品', async () => {
  const wxMock = createWxMock((options) => {
    if (options.url.endsWith('/uploads/presign')) {
      options.success({
        statusCode: 200,
        data: {
          data: {
            imageKey: 'gift-folder/images/gift_12345678/test.jpg',
            uploadUrl: 'https://bucket.cos.example/test.jpg?signed=1',
            contentType: 'image/jpeg'
          }
        }
      })
      return
    }

    options.success({ statusCode: 503, data: '' })
  }, {
    session: validSession()
  })
  const api = giftApiModule.createGiftApi(wxMock, {
    apiBaseUrl: 'https://gift.example'
  })

  await assert.rejects(
    api.uploadImage('wxfile://selected.jpg', 'gift_12345678'),
    (error) => error.code === 'IMAGE_UPLOAD_FAILED'
  )
  assert.equal(
    wxMock.requests.some((item) => item.url.endsWith('/gifts')),
    false
  )
})

test('未配置函数 URL 时不会发起网络请求', async () => {
  const wxMock = createWxMock(() => {
    throw new Error('不应发起请求')
  })
  const api = giftApiModule.createGiftApi(wxMock, {
    apiBaseUrl: ''
  })

  assert.equal(api.isConfigured(), false)
  await assert.rejects(
    api.listGifts(),
    (error) => error.code === 'CLOUD_NOT_CONFIGURED'
  )
  assert.equal(wxMock.requests.length, 0)
})
