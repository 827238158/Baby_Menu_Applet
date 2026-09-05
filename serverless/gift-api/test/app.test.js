'use strict'

const assert = require('node:assert/strict')
const test = require('node:test')

const { createApp } = require('../src/app')
const { PERSISTENT_THUMBNAIL_RULE, createCosRepository } = require('../src/cos-repository')
const { createTokenService } = require('../src/token-service')

const OPEN_ID = 'openid-authorized-user'
const GIFT_ID = 'gift_12345678'
const IMAGE_KEY = 'gift-folder/images/' + GIFT_ID + '/image.jpg'
const THUMBNAIL_KEY = 'gift-folder/thumbnails/' + GIFT_ID + '/thumbnail.jpg'
const PERSISTENT_THUMBNAIL_KEY = 'gift-folder/thumbnails/' + GIFT_ID + '/image.webp'
const DECOR_ID = 'decor_12345678'
const DECOR_IMAGE_KEY = 'gift-folder/decor/images/' + DECOR_ID + '/image.jpg'
const DECOR_THUMBNAIL_KEY = 'gift-folder/decor/thumbnails/' + DECOR_ID + '/thumbnail.jpg'
const DECOR_PERSISTENT_THUMBNAIL_KEY = 'gift-folder/decor/thumbnails/' + DECOR_ID + '/image.webp'

function clone(value) {
  return value == null ? value : JSON.parse(JSON.stringify(value))
}

function createRepository() {
  const legacyGifts = new Map()
  const deletedImages = []
  const imageInfo = new Map([
    [IMAGE_KEY, { size: 1024, contentType: 'image/jpeg' }],
    [THUMBNAIL_KEY, { size: 256, contentType: 'image/jpeg' }],
    [DECOR_IMAGE_KEY, { size: 1024, contentType: 'image/jpeg' }],
    [DECOR_THUMBNAIL_KEY, { size: 256, contentType: 'image/jpeg' }]
  ])
  let index = null
  let lock = null
  let decorIndex = null
  let decorLock = null
  let putIndexDelay = 0
  let imageObjects = []
  let decorImageObjects = []
  let thumbnailProcessingError = null
  let thumbnailProcessingInfo = { size: 320, contentType: 'image/webp' }

  return {
    deletedImages,
    imageInfo,
    legacyGifts,
    formUploadCalls: [],
    thumbnailProcessingCalls: [],
    get index() {
      return clone(index)
    },
    set index(value) {
      index = clone(value)
    },
    set putIndexDelay(value) {
      putIndexDelay = value
    },
    set imageObjects(value) {
      imageObjects = clone(value)
    },
    get decorIndex() {
      return clone(decorIndex)
    },
    set decorIndex(value) {
      decorIndex = clone(value)
    },
    set decorImageObjects(value) {
      decorImageObjects = clone(value)
    },
    set mutationLock(value) {
      lock = clone(value)
    },
    set thumbnailProcessingError(value) {
      thumbnailProcessingError = value
    },
    set thumbnailProcessingInfo(value) {
      thumbnailProcessingInfo = clone(value)
    },
    async createPersistentThumbnail(imageKey, thumbnailKey) {
      this.thumbnailProcessingCalls.push({ imageKey, thumbnailKey })
      if (thumbnailProcessingError) throw thumbnailProcessingError
      imageInfo.set(thumbnailKey, clone(thumbnailProcessingInfo))
    },
    async deleteImage(key) {
      deletedImages.push(key)
      imageInfo.delete(key)
    },
    async getDownloadUrl(key) {
      return 'https://cos.example/' + key + '?signed=1'
    },
    async getDecorIndex() {
      return clone(decorIndex)
    },
    async getDecorMutationLock() {
      return clone(decorLock)
    },
    getFormUpload(key, contentType, size, expires, currentTime) {
      this.formUploadCalls.push({ key, contentType, size, expires, currentTime })
      return {
        imageKey: key,
        uploadUrl: 'https://bucket.cos.example/',
        formData: { key, 'Content-Type': contentType },
        expiresAt: currentTime + expires * 1000
      }
    },
    async getIndex() {
      return clone(index)
    },
    async getImageInfo(key) {
      if (!imageInfo.has(key)) {
        const error = new Error('not found')
        error.statusCode = 404
        throw error
      }
      const value = imageInfo.get(key)
      if (value instanceof Error) throw value
      return value
    },
    async getMutationLock() {
      return clone(lock)
    },
    async getUploadUrl(key) {
      return 'https://cos.example/' + key + '?upload=1'
    },
    isImageKey(key) {
      return (key.startsWith('gift-folder/images/') || key.startsWith('gift-folder/thumbnails/')) && !key.includes('..')
    },
    isImageKeyForGift(key, id) {
      return (key.startsWith('gift-folder/images/' + id + '/') || key.startsWith('gift-folder/thumbnails/' + id + '/')) && !key.includes('..')
    },
    isDecorImageKey(key) {
      return (key.startsWith('gift-folder/decor/images/') || key.startsWith('gift-folder/decor/thumbnails/')) && !key.includes('..')
    },
    isDecorImageKeyForItem(key, id) {
      return (key.startsWith('gift-folder/decor/images/' + id + '/') || key.startsWith('gift-folder/decor/thumbnails/' + id + '/')) && !key.includes('..')
    },
    isNotFoundError(error) {
      return Boolean(error && error.statusCode === 404)
    },
    async listImageObjects() {
      return clone(imageObjects)
    },
    async listDecorImageObjects() {
      return clone(decorImageObjects)
    },
    async listLegacyGifts() {
      return Array.from(legacyGifts.values()).map(clone)
    },
    async putIndex(value) {
      if (putIndexDelay) {
        await new Promise((resolve) => setTimeout(resolve, putIndexDelay))
      }
      index = clone(value)
    },
    async putDecorIndex(value) {
      decorIndex = clone(value)
    },
    async releaseDecorMutationLock(owner) {
      if (!decorLock || decorLock.owner !== owner) return false
      decorLock = null
      return true
    },
    async releaseMutationLock(owner) {
      if (!lock || lock.owner !== owner) return false
      lock = null
      return true
    },
    async tryAcquireMutationLock(value) {
      if (lock) return false
      lock = clone(value)
      return true
    },
    async tryAcquireDecorMutationLock(value) {
      if (decorLock) return false
      decorLock = clone(value)
      return true
    }
  }
}

function createFixture(options = {}) {
  let currentTime = options.now || 1700000000000
  const repository = options.repository || createRepository()
  const logs = []
  const config = {
    allowedOpenIds: new Set(options.allowedOpenIds || [OPEN_ID]),
    cleanupTimerName: 'GiftImageCleanupDaily',
    cosPrefix: 'gift-folder',
    legacyPutUploadUntil: options.legacyPutUploadUntil || 0,
    loginRateLimitMax: options.loginRateLimitMax || 10,
    loginRateLimitWindowMs: 60 * 1000,
    maxImageBytes: 8 * 1024 * 1024,
    maxJsonBodyBytes: 8 * 1024,
    mutationLockLeaseMs: 30 * 1000,
    mutationLockWaitMs: options.mutationLockWaitMs || 1000,
    openIdDiscovery: Boolean(options.openIdDiscovery),
    orphanCleanupBatchSize: 200,
    orphanGraceMs: 24 * 60 * 60 * 1000,
    sessionSecret: 'a-secure-test-secret-with-at-least-32-characters',
    sessionTtlSeconds: 7 * 24 * 60 * 60,
    uploadUrlTtlSeconds: 300
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
        if (code === 'bad-code') throw new Error('invalid code')
        return { openId: options.loginOpenId || OPEN_ID }
      }
    },
    now: () => currentTime,
    randomBytes: () => Math.random().toString(16).slice(2).padEnd(16, '0'),
    logger: {
      info(...args) { logs.push(['info', ...args]) },
      warn(...args) { logs.push(['warn', ...args]) },
      error(...args) { logs.push(['error', ...args]) }
    }
  })
  const issued = tokenService.issue(OPEN_ID)

  return {
    app,
    config,
    logs,
    repository,
    token: issued.token,
    advance(milliseconds) { currentTime += milliseconds }
  }
}

function request(method, path, body, token, headers = {}) {
  return {
    httpMethod: method,
    path,
    headers: Object.assign({}, headers, token ? { authorization: 'Bearer ' + token } : {}),
    body: body === undefined ? '' : JSON.stringify(body)
  }
}

function bodyOf(result) {
  return JSON.parse(result.body)
}

function seedIndex(repository, gifts, revision = 1) {
  repository.index = {
    schemaVersion: 2,
    revision,
    updatedAt: 1700000000000,
    gifts
  }
}

function seedDecorIndex(repository, items, revision = 1) {
  repository.decorIndex = {
    schemaVersion: 2,
    revision,
    updatedAt: 1700000000000,
    items
  }
}

function gift(id, createdAt, overrides = {}) {
  return Object.assign({
    id,
    name: id,
    description: '',
    imageKey: '',
    thumbnailKey: '',
    createdAt,
    updatedAt: createdAt
  }, overrides)
}

test('白名单登录、请求体上限和暖实例 IP 限流生效', async () => {
  const fixture = createFixture({ loginRateLimitMax: 2 })
  const headers = { 'x-scf-remote-addr': '203.0.113.10' }
  const first = await fixture.app(request('POST', '/auth/login', { code: 'wx-code' }, '', headers))
  const second = await fixture.app(request('POST', '/auth/login', { code: 'wx-code' }, '', headers))
  const limited = await fixture.app(request('POST', '/auth/login', { code: 'wx-code' }, '', headers))

  assert.equal(first.statusCode, 200)
  assert.equal(second.statusCode, 200)
  assert.equal(limited.statusCode, 429)
  assert.equal(limited.headers['retry-after'], '60')

  const oversized = await fixture.app({
    httpMethod: 'POST',
    path: '/auth/login',
    headers: { 'x-scf-remote-addr': '203.0.113.11' },
    body: JSON.stringify({ code: 'x'.repeat(9000) })
  })
  assert.equal(oversized.statusCode, 413)
})

test('业务接口拒绝缺失、过期和已移出白名单的令牌', async () => {
  const fixture = createFixture()
  assert.equal((await fixture.app(request('GET', '/gifts'))).statusCode, 401)

  fixture.advance(8 * 24 * 60 * 60 * 1000)
  assert.equal((await fixture.app(request('GET', '/gifts', undefined, fixture.token))).statusCode, 401)

  const fresh = createFixture()
  fresh.config.allowedOpenIds.clear()
  assert.equal((await fresh.app(request('GET', '/gifts', undefined, fresh.token))).statusCode, 403)
})

test('索引 v2 是唯一真源，CRUD 返回云端总数且不写旧礼品 JSON', async () => {
  const fixture = createFixture()
  const created = await fixture.app(request('POST', '/gifts', {
    id: GIFT_ID,
    name: '陶瓷杯',
    description: '',
    imageKey: ''
  }, fixture.token))

  assert.equal(created.statusCode, 201)
  assert.equal(bodyOf(created).data.total, 1)
  assert.equal(fixture.repository.index.schemaVersion, 2)
  assert.equal(fixture.repository.legacyGifts.size, 0)

  const updated = await fixture.app(request('PUT', '/gifts/' + GIFT_ID, {
    name: '',
    description: '喜欢这个颜色',
    imageKey: ''
  }, fixture.token))
  assert.equal(bodyOf(updated).data.total, 1)

  const deleted = await fixture.app(request('DELETE', '/gifts/' + GIFT_ID, undefined, fixture.token))
  assert.equal(bodyOf(deleted).data.total, 0)
  assert.equal(fixture.repository.index.gifts.length, 0)
})

test('旧索引按当前线上内容原样升级，缺失索引才读取旧礼品 JSON', async () => {
  const repository = createRepository()
  repository.index = { gifts: [gift(GIFT_ID, 2)], updatedAt: 2 }
  repository.legacyGifts.set('gift_legacy12', gift('gift_legacy12', 1))
  const fixture = createFixture({ repository })

  const listed = await fixture.app(request('GET', '/gifts', undefined, fixture.token))
  assert.deepEqual(bodyOf(listed).data.items.map((item) => item.id), [GIFT_ID])
  assert.equal(repository.index.schemaVersion, 2)

  const emptyRepository = createRepository()
  emptyRepository.legacyGifts.set(GIFT_ID, gift(GIFT_ID, 1))
  const rebuilt = createFixture({ repository: emptyRepository })
  await rebuilt.app(request('GET', '/gifts', undefined, rebuilt.token))
  assert.equal(emptyRepository.index.gifts[0].id, GIFT_ID)
})

test('并发新增通过 COS 锁串行化，不会互相覆盖索引', async () => {
  const repository = createRepository()
  repository.putIndexDelay = 20
  const fixture = createFixture({ repository })
  const ids = ['gift_concur001', 'gift_concur002']

  const results = await Promise.all(ids.map((id) => fixture.app(request('POST', '/gifts', {
    id,
    name: id,
    description: '',
    imageKey: ''
  }, fixture.token))))

  assert.deepEqual(results.map((item) => item.statusCode).sort(), [201, 201])
  assert.deepEqual(repository.index.gifts.map((item) => item.id).sort(), ids)
})

test('写锁冲突返回可重试错误，过期锁可安全接管', async () => {
  const busy = createFixture({ mutationLockWaitMs: 1 })
  busy.repository.mutationLock = {
    owner: 'another-owner',
    expiresAt: 1700000000000 + 60 * 1000
  }
  const blocked = await busy.app(request('POST', '/gifts', {
    id: GIFT_ID,
    name: '被阻塞的礼品'
  }, busy.token))
  assert.equal(blocked.statusCode, 503)
  assert.equal(bodyOf(blocked).error.code, 'GIFT_BUSY')
  assert.equal(blocked.headers['retry-after'], '1')

  const stale = createFixture()
  stale.repository.mutationLock = {
    owner: 'expired-owner',
    expiresAt: 1700000000000 - 1
  }
  const recovered = await stale.app(request('POST', '/gifts', {
    id: GIFT_ID,
    name: '过期锁后的礼品'
  }, stale.token))
  assert.equal(recovered.statusCode, 201)
  assert.equal(stale.repository.index.gifts.length, 1)
})

test('创建重试保持幂等，相同 ID 不同内容仍冲突', async () => {
  const fixture = createFixture()
  const payload = { id: GIFT_ID, name: '礼品', description: '', imageKey: '' }
  assert.equal((await fixture.app(request('POST', '/gifts', payload, fixture.token))).statusCode, 201)
  assert.equal((await fixture.app(request('POST', '/gifts', payload, fixture.token))).statusCode, 200)

  const conflict = await fixture.app(request('POST', '/gifts', Object.assign({}, payload, { name: '其他' }), fixture.token))
  assert.equal(conflict.statusCode, 409)
})

test('礼品响应返回 thumbnailKey，原图只在打开时签发', async () => {
  const fixture = createFixture()
  seedIndex(fixture.repository, [gift(GIFT_ID, 1, {
    imageKey: IMAGE_KEY,
    thumbnailKey: THUMBNAIL_KEY
  })])

  const listed = await fixture.app(request('GET', '/gifts', undefined, fixture.token))
  const item = bodyOf(listed).data.items[0]
  assert.equal(item.thumbnailKey, THUMBNAIL_KEY)
  assert.match(item.thumbnailUrl, /thumbnails/)
  assert.equal(Object.hasOwn(item, 'imageUrl'), false)

  const image = await fixture.app(request('GET', '/gifts/' + GIFT_ID + '/image', undefined, fixture.token))
  assert.match(bodyOf(image).data.imageUrl, /images/)
})

test('键集分页在第一页后插入或删除礼品时不重复、不跳过剩余旧数据', async () => {
  const fixture = createFixture()
  const original = Array.from({ length: 25 }, (_, index) =>
    gift('gift_page_' + String(index).padStart(8, '0'), 1000 - index)
  )
  seedIndex(fixture.repository, original)

  const first = await fixture.app(Object.assign(
    request('GET', '/gifts', undefined, fixture.token),
    { queryStringParameters: { limit: '20' } }
  ))
  const firstData = bodyOf(first).data
  fixture.repository.index = Object.assign({}, fixture.repository.index, {
    gifts: [gift('gift_new_00000001', 2000)].concat(original.filter((item) => item.id !== original[5].id))
  })

  const second = await fixture.app(Object.assign(
    request('GET', '/gifts', undefined, fixture.token),
    { queryStringParameters: { limit: '20', cursor: firstData.nextCursor } }
  ))
  const combined = firstData.items.concat(bodyOf(second).data.items).map((item) => item.id)
  assert.equal(new Set(combined).size, combined.length)
  assert.deepEqual(bodyOf(second).data.items.map((item) => item.id), original.slice(20).map((item) => item.id))
})

test('孤儿删除同时保护在用原图和缩略图', async () => {
  const fixture = createFixture()
  seedIndex(fixture.repository, [gift(GIFT_ID, 1, {
    imageKey: IMAGE_KEY,
    thumbnailKey: THUMBNAIL_KEY
  })])

  for (const imageKey of [IMAGE_KEY, THUMBNAIL_KEY]) {
    const result = await fixture.app(request('DELETE', '/uploads/orphan', { imageKey }, fixture.token))
    assert.equal(result.statusCode, 409)
  }
})

test('图片不存在与 COS 服务故障使用不同错误', async () => {
  const fixture = createFixture()
  const missing = await fixture.app(request('POST', '/gifts', {
    id: GIFT_ID,
    name: '',
    description: '',
    imageKey: 'gift-folder/images/' + GIFT_ID + '/missing.jpg'
  }, fixture.token))
  assert.equal(bodyOf(missing).error.code, 'IMAGE_NOT_FOUND')

  const outage = new Error('COS unavailable')
  outage.statusCode = 503
  fixture.repository.imageInfo.set(IMAGE_KEY, outage)
  const unavailable = await fixture.app(request('POST', '/gifts', {
    id: GIFT_ID,
    name: '',
    description: '',
    imageKey: IMAGE_KEY
  }, fixture.token))
  assert.equal(unavailable.statusCode, 503)
  assert.equal(bodyOf(unavailable).error.code, 'IMAGE_VALIDATION_UNAVAILABLE')
})

test('POST Object 策略绑定实际键、类型和精确字节数', async () => {
  const repository = createRepository()
  const fixture = createFixture({ repository })
  const result = await fixture.app(request('POST', '/uploads/form-policy', {
    giftId: GIFT_ID,
    contentType: 'image/jpeg',
    size: 1024,
    asset: 'thumbnail'
  }, fixture.token))

  assert.equal(result.statusCode, 200)
  assert.match(bodyOf(result).data.imageKey, /thumbnails/)
  assert.deepEqual(repository.formUploadCalls[0].size, 1024)

  const realRepository = createCosRepository({
    cos: {},
    bucket: 'bucket-1250000000',
    region: 'ap-guangzhou',
    prefix: 'gift-folder',
    downloadUrlTtlSeconds: 60,
    secretId: 'secret-id',
    secretKey: 'secret-key',
    securityToken: 'session-token'
  })
  const signed = realRepository.getFormUpload(IMAGE_KEY, 'image/jpeg', 1024, 300, 1700000000000)
  const policy = JSON.parse(Buffer.from(signed.formData.policy, 'base64').toString('utf8'))
  assert.ok(policy.conditions.some((condition) => Array.isArray(condition) && condition.join('|') === 'content-length-range|1024|1024'))
  assert.ok(policy.conditions.some((condition) => Array.isArray(condition) && condition.join('|') === 'eq|$Content-Type|image/jpeg'))
  assert.ok(policy.conditions.some((condition) => Array.isArray(condition) && condition.join('|') === 'eq|$x-cos-security-token|session-token'))
  assert.equal(signed.formData['x-cos-security-token'], 'session-token')
})

test('礼品和装修好物可从原图持久化生成确定性 WebP 缩略图', async () => {
  const fixture = createFixture()

  const giftResult = await fixture.app(request('POST', '/uploads/thumbnail', {
    giftId: GIFT_ID,
    imageKey: IMAGE_KEY
  }, fixture.token))
  assert.equal(giftResult.statusCode, 200)
  assert.equal(bodyOf(giftResult).data.thumbnailKey, PERSISTENT_THUMBNAIL_KEY)

  const decorResult = await fixture.app(request('POST', '/collections/decor/uploads/thumbnail', {
    itemId: DECOR_ID,
    imageKey: DECOR_IMAGE_KEY
  }, fixture.token))
  assert.equal(decorResult.statusCode, 200)
  assert.equal(bodyOf(decorResult).data.thumbnailKey, DECOR_PERSISTENT_THUMBNAIL_KEY)
  assert.deepEqual(fixture.repository.thumbnailProcessingCalls, [
    { imageKey: IMAGE_KEY, thumbnailKey: PERSISTENT_THUMBNAIL_KEY },
    { imageKey: DECOR_IMAGE_KEY, thumbnailKey: DECOR_PERSISTENT_THUMBNAIL_KEY }
  ])
})

test('持久化缩略图接口要求鉴权并严格限制原图命名空间', async () => {
  const fixture = createFixture()
  const unauthorized = await fixture.app(request('POST', '/uploads/thumbnail', {
    giftId: GIFT_ID,
    imageKey: IMAGE_KEY
  }))
  assert.equal(unauthorized.statusCode, 401)

  const invalidCases = [
    ['/uploads/thumbnail', { giftId: GIFT_ID, imageKey: THUMBNAIL_KEY }],
    ['/uploads/thumbnail', {
      giftId: GIFT_ID,
      imageKey: 'gift-folder/images/gift_other0001/image.jpg'
    }],
    ['/collections/decor/uploads/thumbnail', { itemId: DECOR_ID, imageKey: IMAGE_KEY }]
  ]
  for (const [path, payload] of invalidCases) {
    const result = await fixture.app(request('POST', path, payload, fixture.token))
    assert.equal(result.statusCode, 400)
    assert.equal(bodyOf(result).error.code, 'INVALID_IMAGE_KEY')
  }

  const missing = await fixture.app(request('POST', '/uploads/thumbnail', {
    giftId: GIFT_ID,
    imageKey: 'gift-folder/images/' + GIFT_ID + '/missing.jpg'
  }, fixture.token))
  assert.equal(missing.statusCode, 400)
  assert.equal(bodyOf(missing).error.code, 'IMAGE_NOT_FOUND')
})

test('持久化缩略图生成失败或产物异常时统一返回 503 并清理输出', async () => {
  const processingFailure = createFixture()
  processingFailure.repository.thumbnailProcessingError = new Error('CI unavailable')
  const failed = await processingFailure.app(request('POST', '/uploads/thumbnail', {
    giftId: GIFT_ID,
    imageKey: IMAGE_KEY
  }, processingFailure.token))
  assert.equal(failed.statusCode, 503)
  assert.equal(bodyOf(failed).error.code, 'THUMBNAIL_PROCESSING_UNAVAILABLE')
  assert.deepEqual(processingFailure.repository.deletedImages, [PERSISTENT_THUMBNAIL_KEY])

  const invalidOutput = createFixture()
  invalidOutput.repository.thumbnailProcessingInfo = { size: 320, contentType: 'image/jpeg' }
  const rejected = await invalidOutput.app(request('POST', '/uploads/thumbnail', {
    giftId: GIFT_ID,
    imageKey: IMAGE_KEY
  }, invalidOutput.token))
  assert.equal(rejected.statusCode, 503)
  assert.equal(bodyOf(rejected).error.code, 'THUMBNAIL_PROCESSING_UNAVAILABLE')
  assert.deepEqual(invalidOutput.repository.deletedImages, [PERSISTENT_THUMBNAIL_KEY])
})

test('已存在有效 WebP 缩略图时直接返回且不重复调用数据万象', async () => {
  const fixture = createFixture()
  fixture.repository.imageInfo.set(PERSISTENT_THUMBNAIL_KEY, {
    size: 320,
    contentType: 'image/webp'
  })

  const result = await fixture.app(request('POST', '/uploads/thumbnail', {
    giftId: GIFT_ID,
    imageKey: IMAGE_KEY
  }, fixture.token))
  assert.equal(result.statusCode, 200)
  assert.equal(bodyOf(result).data.thumbnailKey, PERSISTENT_THUMBNAIL_KEY)
  assert.deepEqual(fixture.repository.thumbnailProcessingCalls, [])
})

test('COS 仓储使用 image_process 和桶内绝对 fileid 生成两区缩略图', async () => {
  const requests = []
  const repository = createCosRepository({
    cos: {
      request(params, callback) {
        requests.push(params)
        callback(null, { statusCode: 200 })
      }
    },
    bucket: 'bucket-1250000000',
    region: 'ap-guangzhou',
    prefix: 'gift-folder',
    downloadUrlTtlSeconds: 60
  })

  await repository.createPersistentThumbnail(IMAGE_KEY, PERSISTENT_THUMBNAIL_KEY)
  await repository.createPersistentThumbnail(DECOR_IMAGE_KEY, DECOR_PERSISTENT_THUMBNAIL_KEY)

  assert.equal(requests.length, 2)
  for (const [index, expected] of [
    [0, { imageKey: IMAGE_KEY, thumbnailKey: PERSISTENT_THUMBNAIL_KEY }],
    [1, { imageKey: DECOR_IMAGE_KEY, thumbnailKey: DECOR_PERSISTENT_THUMBNAIL_KEY }]
  ]) {
    const params = requests[index]
    assert.equal(params.Bucket, 'bucket-1250000000')
    assert.equal(params.Region, 'ap-guangzhou')
    assert.equal(params.Key, expected.imageKey)
    assert.equal(params.Method, 'POST')
    assert.equal(params.Action, 'image_process')
    assert.deepEqual(JSON.parse(params.Headers['Pic-Operations']), {
      is_pic_info: 0,
      rules: [{
        fileid: '/' + expected.thumbnailKey,
        rule: PERSISTENT_THUMBNAIL_RULE
      }]
    })
  }
})

test('COS 仓储将装修索引、锁和图片限定在 decor 前缀', async () => {
  const stored = new Map()
  const listedPrefixes = []
  const cos = {
    putObject(params, callback) {
      stored.set(params.Key, params.Body)
      callback(null, {})
    },
    getObject(params, callback) {
      if (stored.has(params.Key)) {
        callback(null, { Body: Buffer.from(stored.get(params.Key), 'utf8') })
        return
      }
      const error = new Error('not found')
      error.statusCode = 404
      callback(error)
    },
    deleteObject(params, callback) {
      stored.delete(params.Key)
      callback(null, {})
    },
    getBucket(params, callback) {
      listedPrefixes.push(params.Prefix)
      callback(null, { Contents: [], IsTruncated: false })
    }
  }
  const repository = createCosRepository({
    cos,
    bucket: 'bucket-1250000000',
    region: 'ap-guangzhou',
    prefix: 'gift-folder',
    downloadUrlTtlSeconds: 60
  })

  await repository.putDecorIndex({ schemaVersion: 2, revision: 1, items: [] })
  assert.ok(stored.has('gift-folder/decor/index.json'))
  assert.equal(await repository.tryAcquireDecorMutationLock({ owner: 'owner' }), true)
  assert.ok(stored.has('gift-folder/decor/system/index.lock'))
  await repository.listDecorImageObjects()
  assert.deepEqual(listedPrefixes.sort(), [
    'gift-folder/decor/images/',
    'gift-folder/decor/thumbnails/'
  ].sort())
})

test('旧 PUT 上传只在显式兼容截止时间内可用', async () => {
  const disabled = createFixture()
  assert.equal((await disabled.app(request('POST', '/uploads/presign', {
    giftId: GIFT_ID,
    contentType: 'image/jpeg',
    size: 1024
  }, disabled.token))).statusCode, 410)

  const enabled = createFixture({ legacyPutUploadUntil: 1700003600000 })
  assert.equal((await enabled.app(request('POST', '/uploads/presign', {
    giftId: GIFT_ID,
    contentType: 'image/jpeg',
    size: 1024
  }, enabled.token))).statusCode, 200)
})

test('每日 Timer 仅删除超过安全期且未被引用的图片', async () => {
  const fixture = createFixture()
  seedIndex(fixture.repository, [gift(GIFT_ID, 1, { imageKey: IMAGE_KEY })])
  fixture.repository.imageObjects = [
    { key: IMAGE_KEY, lastModified: 1, size: 10 },
    { key: THUMBNAIL_KEY, lastModified: 1, size: 10 },
    { key: 'gift-folder/images/gift_other0001/recent.jpg', lastModified: 1699999999000, size: 10 }
  ]

  const result = await fixture.app({
    Type: 'Timer',
    TriggerName: 'GiftImageCleanupDaily',
    Time: '2023-11-14T22:13:20Z'
  })
  assert.equal(result.deleted, 1)
  assert.deepEqual(fixture.repository.deletedImages, [THUMBNAIL_KEY])
})

test('装修好物 CRUD 使用独立索引且不改写礼品数据', async () => {
  const fixture = createFixture()
  seedIndex(fixture.repository, [gift(GIFT_ID, 1)])

  const created = await fixture.app(request('POST', '/collections/decor/items', {
    id: DECOR_ID,
    name: '落地灯',
    description: '',
    imageKey: DECOR_IMAGE_KEY,
    thumbnailKey: DECOR_THUMBNAIL_KEY
  }, fixture.token))
  assert.equal(created.statusCode, 201)
  assert.equal(bodyOf(created).data.total, 1)
  assert.equal(fixture.repository.index.gifts[0].id, GIFT_ID)
  assert.equal(fixture.repository.decorIndex.items[0].id, DECOR_ID)

  const listed = await fixture.app(request('GET', '/collections/decor/items', undefined, fixture.token))
  assert.equal(bodyOf(listed).data.items[0].thumbnailKey, DECOR_THUMBNAIL_KEY)
  assert.match(bodyOf(listed).data.items[0].thumbnailUrl, /decor\/thumbnails/)

  const image = await fixture.app(request('GET', '/collections/decor/items/' + DECOR_ID + '/image', undefined, fixture.token))
  assert.match(bodyOf(image).data.imageUrl, /decor\/images/)

  const updated = await fixture.app(request('PUT', '/collections/decor/items/' + DECOR_ID, {
    name: '',
    description: '适合客厅',
    imageKey: '',
    thumbnailKey: ''
  }, fixture.token))
  assert.equal(updated.statusCode, 200)
  assert.equal(bodyOf(updated).data.description, '适合客厅')

  const deleted = await fixture.app(request('DELETE', '/collections/decor/items/' + DECOR_ID, undefined, fixture.token))
  assert.equal(bodyOf(deleted).data.total, 0)
  assert.equal(fixture.repository.index.gifts.length, 1)
})

test('收藏项跨分类移动保留 ID 和图片，并支持幂等重试', async () => {
  const fixture = createFixture()
  seedIndex(fixture.repository, [gift(GIFT_ID, 1, {
    name: '胡桃木边几',
    imageKey: IMAGE_KEY,
    thumbnailKey: THUMBNAIL_KEY
  })])

  const moved = await fixture.app(request('POST', '/collections/items/' + GIFT_ID + '/move', {
    targetCollection: 'decor'
  }, fixture.token))
  const movedData = bodyOf(moved).data
  assert.equal(moved.statusCode, 200)
  assert.equal(movedData.item.id, GIFT_ID)
  assert.equal(movedData.item.imageKey, IMAGE_KEY)
  assert.equal(movedData.sourceTotal, 0)
  assert.equal(movedData.targetTotal, 1)
  assert.equal(fixture.repository.index.gifts.length, 0)
  assert.equal(fixture.repository.decorIndex.items[0].id, GIFT_ID)

  const retried = await fixture.app(request('POST', '/collections/items/' + GIFT_ID + '/move', {
    targetCollection: 'decor'
  }, fixture.token))
  assert.equal(bodyOf(retried).data.sourceTotal, 0)
  assert.equal(fixture.repository.decorIndex.items.length, 1)

  const image = await fixture.app(request(
    'GET',
    '/collections/decor/items/' + GIFT_ID + '/image',
    undefined,
    fixture.token
  ))
  assert.match(bodyOf(image).data.imageUrl, /gift-folder\/images/)

  const movedBack = await fixture.app(request('POST', '/collections/items/' + GIFT_ID + '/move', {
    targetCollection: 'gift'
  }, fixture.token))
  assert.equal(bodyOf(movedBack).data.item.id, GIFT_ID)
  assert.equal(fixture.repository.index.gifts.length, 1)
  assert.equal(fixture.repository.decorIndex.items.length, 0)
})

test('装修好物 ID、上传路径与礼品命名空间严格隔离', async () => {
  const fixture = createFixture()
  const invalidId = await fixture.app(request('POST', '/collections/decor/items', {
    id: GIFT_ID,
    name: '错误 ID'
  }, fixture.token))
  assert.equal(bodyOf(invalidId).error.code, 'INVALID_DECOR_ID')

  const crossImage = await fixture.app(request('POST', '/collections/decor/items', {
    id: DECOR_ID,
    name: '',
    description: '',
    imageKey: IMAGE_KEY
  }, fixture.token))
  assert.equal(bodyOf(crossImage).error.code, 'INVALID_IMAGE_KEY')

  const policy = await fixture.app(request('POST', '/collections/decor/uploads/form-policy', {
    itemId: DECOR_ID,
    contentType: 'image/jpeg',
    size: 1024,
    asset: 'thumbnail'
  }, fixture.token))
  assert.equal(policy.statusCode, 200)
  assert.match(bodyOf(policy).data.imageKey, /^gift-folder\/decor\/thumbnails\/decor_12345678\//)

  const wrongOrphan = await fixture.app(request('DELETE', '/collections/decor/uploads/orphan', {
    imageKey: IMAGE_KEY
  }, fixture.token))
  assert.equal(bodyOf(wrongOrphan).error.code, 'INVALID_IMAGE_KEY')
})

test('已存在的异常装修索引不会被空列表覆盖', async () => {
  const fixture = createFixture()
  fixture.repository.decorIndex = {
    schemaVersion: 2,
    revision: 4,
    updatedAt: 1700000000000,
    unexpected: []
  }

  const result = await fixture.app(
    request('GET', '/collections/decor/items', undefined, fixture.token)
  )

  assert.equal(result.statusCode, 503)
  assert.equal(bodyOf(result).error.code, 'DECOR_INDEX_INVALID')
  assert.equal(fixture.repository.decorIndex.revision, 4)
  assert.equal(fixture.repository.decorIndex.items, undefined)
})

test('装修好物键集分页与礼品分页独立', async () => {
  const fixture = createFixture()
  const items = Array.from({ length: 25 }, (_, index) =>
    gift('decor_page_' + String(index).padStart(8, '0'), 1000 - index)
  )
  seedDecorIndex(fixture.repository, items)

  const first = await fixture.app(Object.assign(
    request('GET', '/collections/decor/items', undefined, fixture.token),
    { queryStringParameters: { limit: '20' } }
  ))
  const firstData = bodyOf(first).data
  const second = await fixture.app(Object.assign(
    request('GET', '/collections/decor/items', undefined, fixture.token),
    { queryStringParameters: { limit: '20', cursor: firstData.nextCursor } }
  ))
  const combined = firstData.items.concat(bodyOf(second).data.items).map((item) => item.id)
  assert.equal(firstData.total, 25)
  assert.equal(new Set(combined).size, 25)
})

test('每日 Timer 同时保护礼品和装修好物在用图片', async () => {
  const fixture = createFixture()
  seedIndex(fixture.repository, [gift(GIFT_ID, 1, { imageKey: IMAGE_KEY })])
  seedDecorIndex(fixture.repository, [gift(DECOR_ID, 1, { imageKey: DECOR_IMAGE_KEY })])
  fixture.repository.imageObjects = [
    { key: IMAGE_KEY, lastModified: 1, size: 10 },
    { key: THUMBNAIL_KEY, lastModified: 1, size: 10 }
  ]
  fixture.repository.decorImageObjects = [
    { key: DECOR_IMAGE_KEY, lastModified: 1, size: 10 },
    { key: DECOR_THUMBNAIL_KEY, lastModified: 1, size: 10 }
  ]

  const result = await fixture.app({
    Type: 'Timer',
    TriggerName: 'GiftImageCleanupDaily'
  })
  assert.equal(result.deleted, 2)
  assert.equal(result.gift.deleted, 1)
  assert.equal(result.decor.deleted, 1)
  assert.deepEqual(fixture.repository.deletedImages.sort(), [DECOR_THUMBNAIL_KEY, THUMBNAIL_KEY].sort())
})

test('移动后清理 Timer 仍保护原命名空间中的图片', async () => {
  const fixture = createFixture()
  seedIndex(fixture.repository, [gift(GIFT_ID, 1, {
    imageKey: IMAGE_KEY,
    thumbnailKey: THUMBNAIL_KEY
  })])
  fixture.repository.imageObjects = [
    { key: IMAGE_KEY, lastModified: 1, size: 10 },
    { key: THUMBNAIL_KEY, lastModified: 1, size: 10 }
  ]

  await fixture.app(request('POST', '/collections/items/' + GIFT_ID + '/move', {
    targetCollection: 'decor'
  }, fixture.token))
  const result = await fixture.app({ Type: 'Timer', TriggerName: 'GiftImageCleanupDaily' })

  assert.equal(result.deleted, 0)
  assert.deepEqual(fixture.repository.deletedImages, [])
})
