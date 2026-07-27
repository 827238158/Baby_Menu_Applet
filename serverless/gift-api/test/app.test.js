'use strict'

const assert = require('node:assert/strict')
const test = require('node:test')

const { createApp } = require('../src/app')
const { createTokenService } = require('../src/token-service')

const OPEN_ID = 'openid-authorized-user'
const GIFT_ID = 'gift_12345678'
const IMAGE_KEY = 'gift-folder/images/' + GIFT_ID + '/image.jpg'

function createRepository() {
  const gifts = new Map()
  const deletedImages = []
  const imageInfo = new Map([
    [IMAGE_KEY, { size: 1024, contentType: 'image/jpeg' }]
  ])

  return {
    gifts,
    deletedImages,
    async deleteGift(id) {
      gifts.delete(id)
    },
    async deleteImage(key) {
      deletedImages.push(key)
    },
    async getDownloadUrl(key) {
      return 'https://cos.example/' + key + '?signed=1'
    },
    async getGift(id) {
      return gifts.get(id) || null
    },
    async getImageInfo(key) {
      if (!imageInfo.has(key)) {
        const error = new Error('not found')
        error.statusCode = 404
        throw error
      }
      return imageInfo.get(key)
    },
    async getUploadUrl(key) {
      return 'https://cos.example/' + key + '?upload=1'
    },
    isImageKey(key) {
      return key.startsWith('gift-folder/images/') && !key.includes('..')
    },
    isImageKeyForGift(key, id) {
      return key.startsWith('gift-folder/images/' + id + '/') && !key.includes('..')
    },
    async listGifts() {
      return Array.from(gifts.values())
    },
    async putGift(gift) {
      gifts.set(gift.id, Object.assign({}, gift))
    }
  }
}

function createFixture(options = {}) {
  let currentTime = options.now || 1700000000000
  const repository = options.repository || createRepository()
  const logs = []
  const config = {
    allowedOpenIds: new Set(options.allowedOpenIds || [OPEN_ID]),
    cosPrefix: 'gift-folder',
    openIdDiscovery: Boolean(options.openIdDiscovery),
    sessionSecret: 'a-secure-test-secret-with-at-least-32-characters',
    sessionTtlSeconds: 7 * 24 * 60 * 60,
    uploadUrlTtlSeconds: 300,
    maxImageBytes: 8 * 1024 * 1024
  }
  const tokenService = createTokenService({
    secret: config.sessionSecret,
    ttlSeconds: config.sessionTtlSeconds,
    now: () => currentTime
  })
  const app = createApp({
    config,
    repository,
    tokenService,
    wechatAuth: {
      async exchangeCode(code) {
        if (code === 'bad-code') {
          throw new Error('invalid code')
        }
        return { openId: options.loginOpenId || OPEN_ID }
      }
    },
    now: () => currentTime,
    randomBytes: () => 'abcdef0123456789',
    logger: {
      info(...args) {
        logs.push(['info', ...args])
      },
      warn(...args) {
        logs.push(['warn', ...args])
      },
      error(...args) {
        logs.push(['error', ...args])
      }
    }
  })
  const issued = tokenService.issue(OPEN_ID)

  return {
    app,
    config,
    logs,
    repository,
    token: issued.token,
    advance(milliseconds) {
      currentTime += milliseconds
    }
  }
}

function request(method, path, body, token) {
  return {
    httpMethod: method,
    path,
    headers: token ? { authorization: 'Bearer ' + token } : {},
    body: body === undefined ? '' : JSON.stringify(body)
  }
}

function bodyOf(result) {
  return JSON.parse(result.body)
}

test('白名单用户可登录并取得会话令牌', async () => {
  const fixture = createFixture()
  const result = await fixture.app(request('POST', '/auth/login', { code: 'wx-code' }))
  const body = bodyOf(result)

  assert.equal(result.statusCode, 200)
  assert.equal(typeof body.data.token, 'string')
  assert.ok(body.data.expiresAt > 1700000000000)
})

test('未授权用户被拒绝，发现模式只把 OpenID 写入日志', async () => {
  const fixture = createFixture({
    loginOpenId: 'openid-not-allowed',
    openIdDiscovery: true
  })
  const result = await fixture.app(request('POST', '/auth/login', { code: 'wx-code' }))

  assert.equal(result.statusCode, 403)
  assert.equal(bodyOf(result).error.code, 'FORBIDDEN')
  assert.match(fixture.logs[0][1], /openid-not-allowed/)
})

test('业务接口拒绝缺失、过期和已移出白名单的令牌', async () => {
  const fixture = createFixture()
  const missing = await fixture.app(request('GET', '/gifts'))
  assert.equal(missing.statusCode, 401)

  fixture.advance(8 * 24 * 60 * 60 * 1000)
  const expired = await fixture.app(request('GET', '/gifts', undefined, fixture.token))
  assert.equal(expired.statusCode, 401)

  const freshFixture = createFixture()
  freshFixture.config.allowedOpenIds.clear()
  const removed = await freshFixture.app(
    request('GET', '/gifts', undefined, freshFixture.token)
  )
  assert.equal(removed.statusCode, 403)
})

test('支持无图礼品的新增、查询、修改和删除', async () => {
  const fixture = createFixture()
  const created = await fixture.app(request('POST', '/gifts', {
    id: GIFT_ID,
    name: '陶瓷杯',
    description: '',
    imageKey: ''
  }, fixture.token))

  assert.equal(created.statusCode, 201)
  assert.equal(bodyOf(created).data.name, '陶瓷杯')

  const listed = await fixture.app(request('GET', '/gifts', undefined, fixture.token))
  assert.equal(bodyOf(listed).data.length, 1)

  const updated = await fixture.app(request('PUT', '/gifts/' + GIFT_ID, {
    name: '',
    description: '喜欢这个颜色',
    imageKey: ''
  }, fixture.token))
  assert.equal(updated.statusCode, 200)
  assert.equal(bodyOf(updated).data.description, '喜欢这个颜色')

  const deleted = await fixture.app(
    request('DELETE', '/gifts/' + GIFT_ID, undefined, fixture.token)
  )
  assert.equal(deleted.statusCode, 200)
  assert.equal(fixture.repository.gifts.size, 0)
})

test('图片签名路径由服务端生成并限制礼品目录', async () => {
  const fixture = createFixture()
  const signed = await fixture.app(request('POST', '/uploads/presign', {
    giftId: GIFT_ID,
    contentType: 'image/jpeg',
    size: 1024
  }, fixture.token))
  const signedBody = bodyOf(signed).data

  assert.equal(signed.statusCode, 200)
  assert.match(signedBody.imageKey, new RegExp('^gift-folder/images/' + GIFT_ID))
  assert.match(signedBody.uploadUrl, /upload=1/)

  const invalid = await fixture.app(request('POST', '/gifts', {
    id: GIFT_ID,
    name: '',
    description: '',
    imageKey: 'gift-folder/images/other-gift/escape.jpg'
  }, fixture.token))
  assert.equal(invalid.statusCode, 400)
  assert.equal(bodyOf(invalid).error.code, 'INVALID_IMAGE_KEY')
})

test('仅图片礼品保存前校验 COS 实际对象', async () => {
  const fixture = createFixture()
  const result = await fixture.app(request('POST', '/gifts', {
    id: GIFT_ID,
    name: '',
    description: '',
    imageKey: IMAGE_KEY
  }, fixture.token))

  assert.equal(result.statusCode, 201)
  assert.equal(bodyOf(result).data.imageKey, IMAGE_KEY)
  assert.match(bodyOf(result).data.imageUrl, /signed=1/)
})

test('替换图片后旧图清理失败不影响礼品更新', async () => {
  const repository = createRepository()
  const oldKey = 'gift-folder/images/' + GIFT_ID + '/old.jpg'
  repository.gifts.set(GIFT_ID, {
    id: GIFT_ID,
    name: '旧礼品',
    description: '',
    imageKey: oldKey,
    createdAt: 1600000000000,
    updatedAt: 1600000000000
  })
  repository.deleteImage = async () => {
    throw new Error('COS unavailable')
  }
  const fixture = createFixture({ repository })
  const result = await fixture.app(request('PUT', '/gifts/' + GIFT_ID, {
    name: '新礼品',
    description: '',
    imageKey: IMAGE_KEY
  }, fixture.token))

  assert.equal(result.statusCode, 200)
  assert.equal(repository.gifts.get(GIFT_ID).imageKey, IMAGE_KEY)
  assert.equal(fixture.logs[0][0], 'warn')
})

test('孤儿图片接口不能删除正在使用的图片或越权路径', async () => {
  const fixture = createFixture()
  fixture.repository.gifts.set(GIFT_ID, {
    id: GIFT_ID,
    name: '',
    description: '',
    imageKey: IMAGE_KEY,
    createdAt: 1,
    updatedAt: 1
  })

  const inUse = await fixture.app(request('DELETE', '/uploads/orphan', {
    imageKey: IMAGE_KEY
  }, fixture.token))
  assert.equal(inUse.statusCode, 409)

  const traversal = await fixture.app(request('DELETE', '/uploads/orphan', {
    imageKey: 'gift-folder/images/../gifts/' + GIFT_ID + '.json'
  }, fixture.token))
  assert.equal(traversal.statusCode, 400)
})
