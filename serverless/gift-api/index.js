'use strict'

const COS = require('cos-nodejs-sdk-v5')

const { createApp } = require('./src/app')
const { loadConfig } = require('./src/config')
const { createCosRepository } = require('./src/cos-repository')
const { createTokenService } = require('./src/token-service')
const { createWechatAuth } = require('./src/wechat-auth')

let app

function buildApp() {
  const config = loadConfig()
  const cos = new COS({
    SecretId: process.env.TENCENTCLOUD_SECRETID,
    SecretKey: process.env.TENCENTCLOUD_SECRETKEY,
    SecurityToken: process.env.TENCENTCLOUD_SESSIONTOKEN
  })
  const repository = createCosRepository({
    cos,
    bucket: config.cosBucket,
    region: config.cosRegion,
    prefix: config.cosPrefix,
    downloadUrlTtlSeconds: config.downloadUrlTtlSeconds,
    secretId: process.env.TENCENTCLOUD_SECRETID,
    secretKey: process.env.TENCENTCLOUD_SECRETKEY,
    securityToken: process.env.TENCENTCLOUD_SESSIONTOKEN
  })

  return createApp({
    config,
    repository,
    tokenService: createTokenService({
      secret: config.sessionSecret,
      ttlSeconds: config.sessionTtlSeconds
    }),
    wechatAuth: createWechatAuth({
      appId: config.wxAppId,
      appSecret: config.wxAppSecret
    })
  })
}

exports.main_handler = async (event) => {
  try {
    app = app || buildApp()
    return await app(event)
  } catch (error) {
    console.error('礼品 API 初始化失败', error)
    return {
      statusCode: 500,
      headers: {
        'content-type': 'application/json; charset=utf-8',
        'cache-control': 'no-store'
      },
      body: JSON.stringify({
        error: {
          code: 'CONFIGURATION_ERROR',
          message: '服务配置不完整'
        }
      })
    }
  }
}
