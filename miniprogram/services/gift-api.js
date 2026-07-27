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
        createApiError('CLOUD_NOT_CONFIGURED', '礼品云端尚未配置')
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

  function readFile(filePath) {
    return new Promise((resolve, reject) => {
      wxApi.getFileSystemManager().readFile({
        filePath,
        success(result) {
          resolve(result.data)
        },
        fail() {
          reject(createApiError('IMAGE_READ_FAILED', '图片读取失败'))
        }
      })
    })
  }

  function putImage(upload, data) {
    return new Promise((resolve, reject) => {
      wxApi.request({
        url: upload.uploadUrl,
        method: 'PUT',
        data,
        timeout: 30000,
        header: {
          'content-type': upload.contentType
        },
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

  async function uploadImage(filePath, giftId) {
    const file = await getFileInfo(filePath)

    if (!file.size || file.size > 8 * 1024 * 1024) {
      throw createApiError('IMAGE_TOO_LARGE', '图片大小不能超过 8MB')
    }

    const upload = await authorizedRequest({
      path: '/uploads/presign',
      method: 'POST',
      data: {
        giftId,
        contentType: file.contentType,
        size: file.size
      }
    })
    const fileData = await readFile(filePath)

    await putImage(upload, fileData)
    return upload.imageKey
  }

  return {
    clearSession,
    isConfigured,
    listGifts() {
      return authorizedRequest({ path: '/gifts' })
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
    deleteOrphan(imageKey) {
      return authorizedRequest({
        path: '/uploads/orphan',
        method: 'DELETE',
        data: { imageKey }
      })
    },
    uploadImage
  }
}

const defaultWx = typeof wx === 'undefined' ? null : wx
const giftApi = createGiftApi(defaultWx)

giftApi.createGiftApi = createGiftApi
giftApi.SESSION_STORAGE_KEY = SESSION_STORAGE_KEY

module.exports = giftApi
