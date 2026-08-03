'use strict'

const https = require('node:https')

function getJson(url) {
  return new Promise((resolve, reject) => {
    const request = https.get(url, (response) => {
      const chunks = []

      response.on('data', (chunk) => chunks.push(chunk))
      response.on('end', () => {
        try {
          resolve(JSON.parse(Buffer.concat(chunks).toString('utf8')))
        } catch (error) {
          reject(new Error('微信登录接口返回了无效 JSON'))
        }
      })
    })

    request.setTimeout(5000, () => {
      request.destroy(new Error('微信登录接口请求超时'))
    })
    request.on('error', reject)
  })
}

function createWechatAuth({ appId, appSecret, requestJson = getJson }) {
  async function exchangeCode(code) {
    const url = new URL('https://api.weixin.qq.com/sns/jscode2session')
    url.searchParams.set('appid', appId)
    url.searchParams.set('secret', appSecret)
    url.searchParams.set('js_code', code)
    url.searchParams.set('grant_type', 'authorization_code')

    const result = await requestJson(url)

    if (!result.openid) {
      const error = new Error('微信登录失败')
      error.code = 'WECHAT_LOGIN_FAILED'
      error.details = {
        errcode: result.errcode,
        errmsg: result.errmsg
      }
      throw error
    }

    return {
      openId: result.openid
    }
  }

  return {
    exchangeCode
  }
}

module.exports = {
  createWechatAuth
}
