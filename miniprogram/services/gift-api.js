const giftCloudConfig = require('../config/gift-cloud.js')

const SESSION_STORAGE_KEY = 'baby_gift_api_session_v1'
const IMAGE_CONTENT_TYPES = {
  jpeg: 'image/jpeg',
  jpg: 'image/jpeg',
  png: 'image/png',
  webp: 'image/webp'
}

function createApiError(code, message, statusCode) {
  const error = new Error(message || '请求失败')
  error.code = code || 'REQUEST_FAILED'
  error.statusCode = statusCode || 0
  return error
}

function createGiftApi(wxApi, config = giftCloudConfig) {
  let loginPromise = null

  function getBaseUrl() {
    return String(config.apiBaseUrl || '').trim().replace(/\/+$/, '')
  }

  function isConfigured() {
    return /^https:\/\//.test(getBaseUrl())
  }

  function requireWx() {
    if (!wxApi) {
      throw new Error('微信运行环境不可用')
    }
  }

  function getStoredSession() {
    requireWx()

    try {
      const session = wxApi.getStorageSync(SESSION_STORAGE_KEY)
      if (
        session &&
        session.token &&
        Number(session.expiresAt) > Date.now() + 60 * 1000
      ) {
        return session
      }
    } catch (error) {}

    return null
  }

  function clearSession() {
    requireWx()

    try {
      wxApi.removeStorageSync(SESSION_STORAGE_KEY)
    } catch (error) {}
  }

  function wxLogin() {
    return new Promise((resolve, reject) => {
      wxApi.login({
        success(result) {
          if (result.code) {
            resolve(result.code)
            return
          }
          reject(createApiError('WECHAT_LOGIN_FAILED', '微信登录失败'))
        },
        fail() {
          reject(createApiError('WECHAT_LOGIN_FAILED', '微信登录失败'))
        }
      })
    })
  }

  function rawRequest({ path, method = 'GET', data, token }) {
    requireWx()

    if (!isConfigured()) {
      return Promise.reject(
        createApiError('CLOUD_NOT_CONFIGURED', '心愿夹云端尚未配置')
      )
    }

    return new Promise((resolve, reject) => {
      wxApi.request({
        url: getBaseUrl() + path,
        method,
        data,
        timeout: 10000,
        header: Object.assign(
          { 'content-type': 'application/json' },
          token ? { authorization: 'Bearer ' + token } : {}
        ),
        success(result) {
          let payload = result.data

          if (typeof payload === 'string') {
            try {
              payload = JSON.parse(payload)
            } catch (error) {
              payload = {}
            }
          }

          if (result.statusCode >= 200 && result.statusCode < 300) {
            resolve(payload && payload.data)
            return
          }

          const apiError = payload && payload.error || {}
          reject(createApiError(
            apiError.code,
            apiError.message || '请求失败，请稍后重试',
            result.statusCode
          ))
        },
        fail() {
          reject(createApiError('NETWORK_ERROR', '网络连接失败'))
        }
      })
    })
  }

  async function login(forceRefresh = false) {
    if (!forceRefresh) {
      const stored = getStoredSession()
      if (stored) {
        return stored
      }
    }

    if (loginPromise) {
      return loginPromise
    }

    loginPromise = (async () => {
      const code = await wxLogin()
      const session = await rawRequest({
        path: '/auth/login',
        method: 'POST',
        data: { code }
      })

      wxApi.setStorageSync(SESSION_STORAGE_KEY, session)
      return session
    })()

    try {
      return await loginPromise
    } finally {
      loginPromise = null
    }
  }

  async function authorizedRequest(options, canRetry = true) {
    const session = await login()

    try {
      return await rawRequest(Object.assign({}, options, {
        token: session.token
      }))
    } catch (error) {
      if (error.statusCode === 401 && canRetry) {
        clearSession()
        const refreshed = await login(true)
        return rawRequest(Object.assign({}, options, {
          token: refreshed.token
        }))
      }
      throw error
    }
  }

  function getFileInfo(filePath) {
    const fileSystem = wxApi.getFileSystemManager()

    return Promise.all([
      new Promise((resolve, reject) => {
        fileSystem.getFileInfo({
          filePath,
          success: resolve,
          fail: () => reject(createApiError('IMAGE_READ_FAILED', '图片读取失败'))
        })
      }),
      new Promise((resolve, reject) => {
        wxApi.getImageInfo({
          src: filePath,
          success: resolve,
          fail: () => reject(createApiError('IMAGE_READ_FAILED', '图片格式识别失败'))
        })
      })
    ]).then(([file, image]) => {
      const contentType = IMAGE_CONTENT_TYPES[String(image.type || '').toLowerCase()]

      if (!contentType) {
        throw createApiError('INVALID_IMAGE_TYPE', '仅支持 JPEG、PNG 或 WebP 图片')
      }

      return {
        size: Number(file.size) || 0,
        contentType
      }
    })
  }

  function postImage(upload, filePath) {
    return new Promise((resolve, reject) => {
      wxApi.uploadFile({
        url: upload.uploadUrl,
        filePath,
        name: 'file',
        formData: upload.formData,
        timeout: 30000,
        success(result) {
          if (result.statusCode >= 200 && result.statusCode < 300) {
            resolve()
            return
          }
          reject(createApiError('IMAGE_UPLOAD_FAILED', '图片上传失败'))
        },
        fail() {
          reject(createApiError('IMAGE_UPLOAD_FAILED', '图片上传失败'))
        }
      })
    })
  }

  async function uploadImage(filePath, itemId, asset = 'image', collection = 'gift') {
    const file = await getFileInfo(filePath)

    if (!file.size || file.size > 8 * 1024 * 1024) {
      throw createApiError('IMAGE_TOO_LARGE', '图片大小不能超过 8MB')
    }

    const isDecor = collection === 'decor'
    const upload = await authorizedRequest({
      path: isDecor
        ? '/collections/decor/uploads/form-policy'
        : '/uploads/form-policy',
      method: 'POST',
      data: Object.assign({
        contentType: file.contentType,
        size: file.size,
        asset
      }, isDecor ? { itemId } : { giftId: itemId })
    })
    await postImage(upload, filePath)
    return upload.imageKey
  }

  return {
    clearSession,
    isConfigured,
    listGifts(cursor = '', limit = 20) {
      const query = '?limit=' + encodeURIComponent(limit) +
        (cursor ? '&cursor=' + encodeURIComponent(cursor) : '')
      return authorizedRequest({ path: '/gifts' + query })
    },
    createGift(gift) {
      return authorizedRequest({
        path: '/gifts',
        method: 'POST',
        data: gift
      })
    },
    updateGift(gift) {
      return authorizedRequest({
        path: '/gifts/' + encodeURIComponent(gift.id),
        method: 'PUT',
        data: gift
      })
    },
    deleteGift(id) {
      return authorizedRequest({
        path: '/gifts/' + encodeURIComponent(id),
        method: 'DELETE'
      })
    },
    getGiftImage(id) {
      return authorizedRequest({ path: '/gifts/' + encodeURIComponent(id) + '/image' })
    },
    listDecorItems(cursor = '', limit = 20) {
      const query = '?limit=' + encodeURIComponent(limit) +
        (cursor ? '&cursor=' + encodeURIComponent(cursor) : '')
      return authorizedRequest({ path: '/collections/decor/items' + query })
    },
    createDecorItem(item) {
      return authorizedRequest({
        path: '/collections/decor/items',
        method: 'POST',
        data: item
      })
    },
    updateDecorItem(item) {
      return authorizedRequest({
        path: '/collections/decor/items/' + encodeURIComponent(item.id),
        method: 'PUT',
        data: item
      })
    },
    deleteDecorItem(id) {
      return authorizedRequest({
        path: '/collections/decor/items/' + encodeURIComponent(id),
        method: 'DELETE'
      })
    },
    getDecorImage(id) {
      return authorizedRequest({
        path: '/collections/decor/items/' + encodeURIComponent(id) + '/image'
      })
    },
    moveCollectionItem(id, targetCollection) {
      return authorizedRequest({
        path: '/collections/items/' + encodeURIComponent(id) + '/move',
        method: 'POST',
        data: { targetCollection }
      })
    },
    deleteOrphan(imageKey) {
      return authorizedRequest({
        path: '/uploads/orphan',
        method: 'DELETE',
        data: { imageKey }
      })
    },
    uploadImage,
    async uploadImages(originalPath, thumbnailPath, itemId, collection = 'gift') {
      const imageKey = await uploadImage(originalPath, itemId, 'image', collection)
      try {
        const thumbnailKey = await uploadImage(thumbnailPath, itemId, 'thumbnail', collection)
        return { imageKey, thumbnailKey }
      } catch (error) {
        // 等待孤儿原图清理结束，避免页面退出时后台请求被直接中断。
        await authorizedRequest({
          path: collection === 'decor'
            ? '/collections/decor/uploads/orphan'
            : '/uploads/orphan',
          method: 'DELETE',
          data: { imageKey }
        }).catch(() => {})
        throw error
      }
    },
    deleteCollectionOrphan(imageKey, collection = 'gift') {
      return authorizedRequest({
        path: collection === 'decor'
          ? '/collections/decor/uploads/orphan'
          : '/uploads/orphan',
        method: 'DELETE',
        data: { imageKey }
      })
    }
  }
}

const defaultWx = typeof wx === 'undefined' ? null : wx
const giftApi = createGiftApi(defaultWx)

giftApi.createGiftApi = createGiftApi
giftApi.SESSION_STORAGE_KEY = SESSION_STORAGE_KEY

module.exports = giftApi
