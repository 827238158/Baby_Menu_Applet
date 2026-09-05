'use strict'

const assert = require('node:assert/strict')
const test = require('node:test')

const giftApiModule = require('../miniprogram/services/gift-api.js')

function createWxMock(handler, options = {}) {
  const storage = new Map()
  const requests = []
  const uploads = []

  if (options.session) {
    storage.set(giftApiModule.SESSION_STORAGE_KEY, options.session)
  }

  return {
    requests,
    uploads,
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
    uploadFile(options) {
      uploads.push(options)
      if (options.uploadUrl) {
        throw new Error('uploadFile 参数异常')
      }
      if (typeof options.success === 'function') {
        options.success({
          statusCode: options.failUpload ? 503 : 204,
          data: ''
        })
      }
    },
    getFileSystemManager() {
      return {
        getFileInfo({ success }) {
          success({ size: options.fileSize || 1024 })
        },
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

test('图片通过受约束的 POST Object 表单流式上传 COS', async () => {
  const imageKey = 'gift-folder/images/gift_12345678/test.jpg'
  const wxMock = createWxMock((options) => {
    if (options.url.endsWith('/uploads/form-policy')) {
      options.success({
        statusCode: 200,
        data: {
          data: {
            imageKey,
            uploadUrl: 'https://bucket.cos.example/',
            contentType: 'image/jpeg',
            formData: {
              key: imageKey,
              policy: 'signed-policy',
              'Content-Type': 'image/jpeg'
            }
          }
        }
      })
      return
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
  assert.equal(wxMock.uploads.length, 1)
  assert.equal(wxMock.uploads[0].filePath, 'wxfile://selected.jpg')
  assert.equal(wxMock.uploads[0].name, 'file')
  assert.equal(wxMock.uploads[0].formData.policy, 'signed-policy')
  assert.equal(wxMock.requests.some((item) => item.method === 'PUT'), false)
})

test('装修好物使用独立路由和 decor 图片命名空间', async () => {
  const decorImageKey = 'gift-folder/decor/images/decor_12345678/test.jpg'
  const wxMock = createWxMock((options) => {
    if (options.url.includes('/collections/decor/items?')) {
      options.success({
        statusCode: 200,
        data: { data: { items: [], total: 0, hasMore: false, nextCursor: '' } }
      })
      return
    }
    if (options.url.endsWith('/collections/decor/uploads/form-policy')) {
      assert.equal(options.data.itemId, 'decor_12345678')
      options.success({
        statusCode: 200,
        data: {
          data: {
            imageKey: decorImageKey,
            uploadUrl: 'https://bucket.cos.example/',
            contentType: 'image/jpeg',
            formData: { key: decorImageKey }
          }
        }
      })
    }
  }, { session: validSession() })
  const api = giftApiModule.createGiftApi(wxMock, {
    apiBaseUrl: 'https://gift.example'
  })

  const listed = await api.listDecorItems('', 20)
  const uploaded = await api.uploadImage(
    'wxfile://decor.jpg',
    'decor_12345678',
    'image',
    'decor'
  )

  assert.equal(listed.total, 0)
  assert.equal(uploaded, decorImageKey)
  assert.equal(wxMock.uploads[0].formData.key, decorImageKey)
})

test('收藏项通过统一移动接口切换分类', async () => {
  const wxMock = createWxMock((options) => {
    assert.match(options.url, /\/collections\/items\/gift_12345678\/move$/)
    assert.equal(options.method, 'POST')
    assert.equal(options.data.targetCollection, 'decor')
    options.success({
      statusCode: 200,
      data: {
        data: {
          item: { id: 'gift_12345678', name: '边几' },
          sourceTotal: 0,
          targetTotal: 1
        }
      }
    })
  }, { session: validSession() })
  const api = giftApiModule.createGiftApi(wxMock, { apiBaseUrl: 'https://gift.example' })

  const result = await api.moveCollectionItem('gift_12345678', 'decor')
  assert.equal(result.item.id, 'gift_12345678')
  assert.equal(result.targetTotal, 1)
})

test('图片上传失败时返回明确错误，不会继续保存礼品', async () => {
  const wxMock = createWxMock((options) => {
    if (options.url.endsWith('/uploads/form-policy')) {
      options.success({
        statusCode: 200,
        data: {
          data: {
            imageKey: 'gift-folder/images/gift_12345678/test.jpg',
            uploadUrl: 'https://bucket.cos.example/',
            contentType: 'image/jpeg',
            formData: { key: 'gift-folder/images/gift_12345678/test.jpg' }
          }
        }
      })
      return
    }

  }, {
    session: validSession()
  })
  const api = giftApiModule.createGiftApi(wxMock, {
    apiBaseUrl: 'https://gift.example'
  })

  wxMock.uploadFile = (options) => {
    wxMock.uploads.push(options)
    options.success({ statusCode: 503, data: '' })
  }

  await assert.rejects(
    api.uploadImage('wxfile://selected.jpg', 'gift_12345678'),
    (error) => error.code === 'IMAGE_UPLOAD_FAILED'
  )
  assert.equal(
    wxMock.requests.some((item) => item.url.endsWith('/gifts')),
    false
  )
})

test('原图只上传一次，随后请求数据万象生成礼品缩略图', async () => {
  const imageKey = 'gift-folder/images/gift_12345678/original.jpg'
  const thumbnailKey = 'gift-folder/thumbnails/gift_12345678/original.webp'
  const wxMock = createWxMock((options) => {
    if (options.url.endsWith('/uploads/form-policy')) {
      assert.equal(options.data.asset, 'image')
      options.success({
        statusCode: 200,
        data: {
          data: {
            imageKey,
            uploadUrl: 'https://bucket.cos.example/',
            contentType: 'image/jpeg',
            formData: { key: imageKey }
          }
        }
      })
      return
    }

    if (options.url.endsWith('/uploads/thumbnail')) {
      assert.equal(options.method, 'POST')
      assert.deepEqual(options.data, {
        giftId: 'gift_12345678',
        imageKey
      })
      options.success({
        statusCode: 200,
        data: { data: { thumbnailKey } }
      })
    }
  }, { session: validSession() })
  const api = giftApiModule.createGiftApi(wxMock, {
    apiBaseUrl: 'https://gift.example'
  })

  const uploaded = await api.uploadImages(
    'wxfile://original.jpg',
    'gift_12345678'
  )

  assert.deepEqual(uploaded, { imageKey, thumbnailKey })
  assert.equal(wxMock.uploads.length, 1)
  assert.equal(wxMock.uploads[0].filePath, 'wxfile://original.jpg')
})

test('装修原图上传后调用独立的缩略图生成路由', async () => {
  const imageKey = 'gift-folder/decor/images/decor_12345678/original.png'
  const thumbnailKey = 'gift-folder/decor/thumbnails/decor_12345678/original.webp'
  const wxMock = createWxMock((options) => {
    if (options.url.endsWith('/collections/decor/uploads/form-policy')) {
      assert.equal(options.data.asset, 'image')
      assert.equal(options.data.itemId, 'decor_12345678')
      options.success({
        statusCode: 200,
        data: {
          data: {
            imageKey,
            uploadUrl: 'https://bucket.cos.example/',
            contentType: 'image/png',
            formData: { key: imageKey }
          }
        }
      })
      return
    }

    if (options.url.endsWith('/collections/decor/uploads/thumbnail')) {
      assert.equal(options.method, 'POST')
      assert.deepEqual(options.data, {
        itemId: 'decor_12345678',
        imageKey
      })
      options.success({
        statusCode: 200,
        data: { data: { thumbnailKey } }
      })
    }
  }, { session: validSession(), imageType: 'png' })
  const api = giftApiModule.createGiftApi(wxMock, {
    apiBaseUrl: 'https://gift.example'
  })

  const uploaded = await api.uploadImages(
    'wxfile://decor.png',
    'decor_12345678',
    'decor'
  )

  assert.deepEqual(uploaded, { imageKey, thumbnailKey })
  assert.equal(wxMock.uploads.length, 1)
})

test('缩略图接口成功但缺少 Key 时清理原图并拒绝保存', async () => {
  const imageKey = 'gift-folder/images/gift_12345678/original.jpg'
  let cleanupRequested = false
  const wxMock = createWxMock((options) => {
    if (options.url.endsWith('/uploads/form-policy')) {
      options.success({
        statusCode: 200,
        data: {
          data: {
            imageKey,
            uploadUrl: 'https://bucket.cos.example/',
            contentType: 'image/jpeg',
            formData: { key: imageKey }
          }
        }
      })
      return
    }

    if (options.url.endsWith('/uploads/thumbnail')) {
      options.success({ statusCode: 200, data: { data: {} } })
      return
    }

    if (options.url.endsWith('/uploads/orphan')) {
      cleanupRequested = true
      options.success({ statusCode: 200, data: { data: { imageKey } } })
    }
  }, { session: validSession() })
  const api = giftApiModule.createGiftApi(wxMock, {
    apiBaseUrl: 'https://gift.example'
  })

  await assert.rejects(
    api.uploadImages('wxfile://original.jpg', 'gift_12345678'),
    (error) => error.code === 'THUMBNAIL_PROCESSING_INVALID_RESPONSE'
  )
  assert.equal(cleanupRequested, true)
})

test('缩略图生成失败时等待孤儿原图清理完成再返回原错误', async () => {
  const imageKey = 'gift-folder/images/gift_12345678/original.jpg'
  let cleanupRequest
  const wxMock = createWxMock((options) => {
    if (options.url.endsWith('/uploads/form-policy')) {
      options.success({
        statusCode: 200,
        data: {
          data: {
            imageKey,
            uploadUrl: 'https://bucket.cos.example/',
            contentType: 'image/jpeg',
            formData: { key: imageKey }
          }
        }
      })
      return
    }

    if (options.url.endsWith('/uploads/thumbnail')) {
      options.success({
        statusCode: 503,
        data: {
          error: {
            code: 'THUMBNAIL_PROCESSING_UNAVAILABLE',
            message: '缩略图生成失败'
          }
        }
      })
      return
    }

    if (options.url.endsWith('/uploads/orphan')) {
      cleanupRequest = options
    }
  }, { session: validSession() })
  const api = giftApiModule.createGiftApi(wxMock, {
    apiBaseUrl: 'https://gift.example'
  })

  let settled = false
  const uploadPromise = api.uploadImages(
    'wxfile://original.jpg',
    'gift_12345678'
  )
  uploadPromise.then(
    () => { settled = true },
    () => { settled = true }
  )

  await new Promise((resolve) => setImmediate(resolve))
  assert.ok(cleanupRequest)
  assert.equal(cleanupRequest.method, 'DELETE')
  assert.equal(cleanupRequest.data.imageKey, imageKey)
  assert.equal(settled, false)

  cleanupRequest.success({
    statusCode: 200,
    data: { data: { imageKey } }
  })
  await assert.rejects(
    uploadPromise,
    (error) => error.code === 'THUMBNAIL_PROCESSING_UNAVAILABLE'
  )
})

test('装修缩略图生成失败时使用 decor 孤儿清理路由', async () => {
  const imageKey = 'gift-folder/decor/images/decor_12345678/original.jpg'
  const requests = []
  const wxMock = createWxMock((options) => {
    requests.push(options)
    if (options.url.endsWith('/collections/decor/uploads/form-policy')) {
      options.success({
        statusCode: 200,
        data: {
          data: {
            imageKey,
            uploadUrl: 'https://bucket.cos.example/',
            contentType: 'image/jpeg',
            formData: { key: imageKey }
          }
        }
      })
      return
    }

    if (options.url.endsWith('/collections/decor/uploads/thumbnail')) {
      options.success({
        statusCode: 503,
        data: {
          error: {
            code: 'THUMBNAIL_PROCESSING_UNAVAILABLE',
            message: '缩略图生成失败'
          }
        }
      })
      return
    }

    if (options.url.endsWith('/collections/decor/uploads/orphan')) {
      options.success({ statusCode: 200, data: { data: { imageKey } } })
    }
  }, { session: validSession() })
  const api = giftApiModule.createGiftApi(wxMock, {
    apiBaseUrl: 'https://gift.example'
  })

  await assert.rejects(
    api.uploadImages('wxfile://decor.jpg', 'decor_12345678', 'decor'),
    (error) => error.code === 'THUMBNAIL_PROCESSING_UNAVAILABLE'
  )
  const cleanup = requests.find((item) => (
    item.url.endsWith('/collections/decor/uploads/orphan')
  ))
  assert.ok(cleanup)
  assert.equal(cleanup.method, 'DELETE')
  assert.equal(cleanup.data.imageKey, imageKey)
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
