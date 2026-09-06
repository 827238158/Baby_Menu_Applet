const SESSION_STORAGE_KEY = 'baby_gift_api_session_v1'

function createApiError(code, message, statusCode) {
  const error = new Error(message || '请求失败')
  error.code = code || 'REQUEST_FAILED'
  error.statusCode = statusCode || 0
  return error
}

function createCloudClient(wxApi, config) {
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

  function rawRequest({ path, method = 'GET', data, token, timeout = 10000 }) {
    requireWx()

    if (!isConfigured()) {
      return Promise.reject(
        createApiError('CLOUD_NOT_CONFIGURED', '云端服务尚未配置')
      )
    }

    return new Promise((resolve, reject) => {
      wxApi.request({
        url: getBaseUrl() + path,
        method,
        data,
        timeout,
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

  return { rawRequest, authorizedRequest, clearSession, isConfigured }
}

module.exports = { createCloudClient, createApiError, SESSION_STORAGE_KEY }
