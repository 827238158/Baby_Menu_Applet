'use strict'

const crypto = require('node:crypto')

const IMAGE_TYPES = new Map([
  ['image/jpeg', 'jpg'],
  ['image/png', 'png'],
  ['image/webp', 'webp']
])
const GIFT_ID_PATTERN = /^gift_[A-Za-z0-9_-]{8,72}$/
const DECOR_ID_PATTERN = /^decor_[A-Za-z0-9_-]{8,72}$/
const COLLECTION_ITEM_ID_PATTERN = /^(?:gift|decor)_[A-Za-z0-9_-]{8,72}$/
const INDEX_SCHEMA_VERSION = 2
const LOGIN_RATE_LIMIT_MAX_ENTRIES = 1000

class HttpError extends Error {
  constructor(statusCode, code, message, headers = {}) {
    super(message)
    this.statusCode = statusCode
    this.code = code
    this.headers = headers
  }
}

function response(statusCode, payload, headers = {}) {
  return {
    statusCode,
    headers: Object.assign({
      'content-type': 'application/json; charset=utf-8',
      'cache-control': 'no-store'
    }, headers),
    body: JSON.stringify(payload)
  }
}

function success(data, statusCode = 200) {
  return response(statusCode, { data })
}

function parseBody(event, maxBytes) {
  if (!event.body) {
    return {}
  }

  let text
  if (typeof event.body === 'object') {
    try {
      text = JSON.stringify(event.body)
    } catch (error) {
      throw new HttpError(400, 'INVALID_JSON', '请求内容不是有效 JSON')
    }
  } else {
    text = event.isBase64Encoded
      ? Buffer.from(event.body, 'base64').toString('utf8')
      : String(event.body)
  }

  if (Buffer.byteLength(text, 'utf8') > maxBytes) {
    throw new HttpError(413, 'REQUEST_TOO_LARGE', '请求内容过大')
  }

  try {
    return typeof event.body === 'object' ? event.body : JSON.parse(text)
  } catch (error) {
    throw new HttpError(400, 'INVALID_JSON', '请求内容不是有效 JSON')
  }
}

function getHeader(headers, name) {
  const target = name.toLowerCase()

  for (const [key, value] of Object.entries(headers || {})) {
    if (key.toLowerCase() === target) {
      return String(value)
    }
  }

  return ''
}

function normalizePath(path) {
  const normalized = String(path || '/').replace(/\/+/g, '/')
  return normalized.length > 1 ? normalized.replace(/\/$/, '') : normalized
}

function validateGiftId(id) {
  const value = String(id || '')

  if (!GIFT_ID_PATTERN.test(value)) {
    throw new HttpError(400, 'INVALID_GIFT_ID', '礼品 ID 格式无效')
  }

  return value
}

function validateDecorId(id) {
  const value = String(id || '')

  if (!DECOR_ID_PATTERN.test(value)) {
    throw new HttpError(400, 'INVALID_DECOR_ID', '装修好物 ID 格式无效')
  }

  return value
}

function validateCollectionItemId(id) {
  const value = String(id || '')
  if (!COLLECTION_ITEM_ID_PATTERN.test(value)) {
    throw new HttpError(400, 'INVALID_COLLECTION_ITEM_ID', '收藏项 ID 格式无效')
  }
  return value
}

function normalizeText(value, maxLength, fieldName) {
  const text = typeof value === 'string' ? value.trim() : ''

  if (text.length > maxLength) {
    throw new HttpError(400, 'FIELD_TOO_LONG', fieldName + '内容过长')
  }

  return text
}

function compareGifts(left, right) {
  const timeDifference = Number(right.createdAt) - Number(left.createdAt)
  if (timeDifference) return timeDifference

  const leftId = String(left.id || '')
  const rightId = String(right.id || '')
  if (leftId === rightId) return 0
  return leftId > rightId ? -1 : 1
}

function sortGifts(gifts) {
  return gifts.slice().sort(compareGifts)
}

function sleep(milliseconds) {
  return new Promise((resolve) => setTimeout(resolve, milliseconds))
}

function createApp({
  config,
  repository,
  tokenService,
  wechatAuth,
  now = () => Date.now(),
  randomBytes = (size) => crypto.randomBytes(size).toString('hex'),
  logger = console
}) {
  const loginAttempts = new Map()
  const isCollectionImageKeyForItem = repository.isCollectionImageKeyForItem ||
    ((key, id) => repository.isImageKeyForGift(key, id) ||
      typeof repository.isDecorImageKeyForItem === 'function' && repository.isDecorImageKeyForItem(key, id))

  function bodyOf(event) {
    return parseBody(event, config.maxJsonBodyBytes || 8 * 1024)
  }

  function derivePersistentThumbnailKey(imageKey, itemId, collection) {
    const collectionPrefix = collection === 'decor' ? '/decor' : ''
    const imagePrefix = config.cosPrefix + collectionPrefix + '/images/' + itemId + '/'

    // 新接口只接受当前分段、当前收藏项 images 目录中的直接子对象。
    if (!imageKey.startsWith(imagePrefix) || imageKey.includes('..')) {
      throw new HttpError(400, 'INVALID_IMAGE_KEY', '原图路径无效')
    }

    const filename = imageKey.slice(imagePrefix.length)
    const extensionOffset = filename.lastIndexOf('.')
    if (!filename || filename.includes('/') || extensionOffset <= 0 || extensionOffset === filename.length - 1) {
      throw new HttpError(400, 'INVALID_IMAGE_KEY', '原图路径无效')
    }

    const basename = filename.slice(0, extensionOffset)
    return config.cosPrefix + collectionPrefix + '/thumbnails/' + itemId + '/' + basename + '.webp'
  }

  function requireUser(event) {
    const authorization = getHeader(event.headers, 'authorization')
    const token = authorization.startsWith('Bearer ') ? authorization.slice(7) : ''
    const payload = tokenService.verify(token)

    if (!payload) {
      throw new HttpError(401, 'UNAUTHORIZED', '登录状态已失效')
    }

    // 每次请求重新校验白名单，移除用户后权限立即失效。
    if (!config.allowedOpenIds.has(payload.sub)) {
      throw new HttpError(403, 'FORBIDDEN', '当前微信账号无权访问心愿夹')
    }

    return payload.sub
  }

  function enforceLoginRateLimit(event) {
    const currentTime = now()
    const windowMs = config.loginRateLimitWindowMs || 60 * 1000
    const maxAttempts = config.loginRateLimitMax || 10
    const sourceIp = getHeader(event.headers, 'x-scf-remote-addr') || 'unknown'

    for (const [key, value] of loginAttempts) {
      if (value.startedAt + windowMs <= currentTime) {
        loginAttempts.delete(key)
      }
    }
    if (loginAttempts.size >= LOGIN_RATE_LIMIT_MAX_ENTRIES && !loginAttempts.has(sourceIp)) {
      loginAttempts.delete(loginAttempts.keys().next().value)
    }

    const existing = loginAttempts.get(sourceIp)
    if (!existing || existing.startedAt + windowMs <= currentTime) {
      loginAttempts.set(sourceIp, { count: 1, startedAt: currentTime })
      return
    }

    existing.count += 1
    if (existing.count > maxAttempts) {
      const retryAfter = Math.max(1, Math.ceil((existing.startedAt + windowMs - currentTime) / 1000))
      throw new HttpError(429, 'LOGIN_RATE_LIMITED', '登录请求过于频繁，请稍后重试', {
        'retry-after': String(retryAfter)
      })
    }
  }

  async function validateImage(imageKey, giftId) {
    if (!imageKey) {
      return
    }

    if (!isCollectionImageKeyForItem(imageKey, giftId)) {
      throw new HttpError(400, 'INVALID_IMAGE_KEY', '图片路径无效')
    }

    let info
    try {
      info = await repository.getImageInfo(imageKey)
    } catch (error) {
      if (repository.isNotFoundError(error)) {
        throw new HttpError(400, 'IMAGE_NOT_FOUND', '上传的图片不存在')
      }
      logger.error('COS 图片校验失败', { giftId, imageKey, error })
      throw new HttpError(503, 'IMAGE_VALIDATION_UNAVAILABLE', '图片校验暂时不可用，请稍后重试')
    }

    if (!IMAGE_TYPES.has(info.contentType)) {
      throw new HttpError(400, 'INVALID_IMAGE_TYPE', '图片格式不受支持')
    }

    if (!info.size || info.size > config.maxImageBytes) {
      throw new HttpError(400, 'IMAGE_TOO_LARGE', '图片大小不能超过 8MB')
    }
  }

  function isValidPersistentThumbnail(info) {
    return Boolean(info &&
      info.contentType === 'image/webp' &&
      info.size > 0 &&
      info.size <= config.maxImageBytes)
  }

  async function createPersistentThumbnail(event, collection) {
    const body = bodyOf(event)
    const idField = collection === 'decor' ? 'itemId' : 'giftId'
    const itemId = validateCollectionItemId(body[idField])
    const imageKey = String(body.imageKey || '')
    const thumbnailKey = derivePersistentThumbnailKey(imageKey, itemId, collection)

    let sourceInfo
    try {
      sourceInfo = await repository.getImageInfo(imageKey)
    } catch (error) {
      if (repository.isNotFoundError(error)) {
        throw new HttpError(400, 'IMAGE_NOT_FOUND', '上传的原图不存在')
      }
      logger.error('COS 原图校验失败', { collection, itemId, imageKey, error })
      throw new HttpError(503, 'THUMBNAIL_PROCESSING_UNAVAILABLE', '缩略图生成暂时不可用，请稍后重试')
    }

    if (!IMAGE_TYPES.has(sourceInfo.contentType)) {
      throw new HttpError(400, 'INVALID_IMAGE_TYPE', '图片格式不受支持')
    }
    if (!sourceInfo.size || sourceInfo.size > config.maxImageBytes) {
      throw new HttpError(400, 'IMAGE_TOO_LARGE', '图片大小不能超过 8MB')
    }

    try {
      const existing = await repository.getImageInfo(thumbnailKey)
      if (isValidPersistentThumbnail(existing)) {
        return success({ thumbnailKey })
      }
    } catch (error) {
      if (!repository.isNotFoundError(error)) {
        logger.error('COS 缩略图幂等校验失败', { collection, itemId, thumbnailKey, error })
        throw new HttpError(503, 'THUMBNAIL_PROCESSING_UNAVAILABLE', '缩略图生成暂时不可用，请稍后重试')
      }
    }

    try {
      await repository.createPersistentThumbnail(imageKey, thumbnailKey)
      const generated = await repository.getImageInfo(thumbnailKey)
      if (!isValidPersistentThumbnail(generated)) {
        throw new Error('数据万象返回的缩略图格式或大小无效')
      }
      return success({ thumbnailKey })
    } catch (error) {
      // CI 失败后尽力删除确定性输出，避免半成品被后续请求误判为有效缩略图。
      await repository.deleteImage(thumbnailKey).catch((cleanupError) => {
        logger.warn('异常缩略图清理失败', { collection, itemId, thumbnailKey, error: cleanupError })
      })
      logger.error('数据万象持久化缩略图生成失败', { collection, itemId, imageKey, thumbnailKey, error })
      throw new HttpError(503, 'THUMBNAIL_PROCESSING_UNAVAILABLE', '缩略图生成暂时不可用，请稍后重试')
    }
  }

  async function presentGift(gift, total) {
    const result = {
      id: gift.id,
      name: gift.name || '',
      description: gift.description || '',
      imageKey: gift.imageKey || '',
      thumbnailKey: gift.thumbnailKey || '',
      thumbnailUrl: '',
      createdAt: gift.createdAt,
      updatedAt: gift.updatedAt
    }

    if (Number.isInteger(total)) {
      result.total = total
    }

    const thumbnailKey = gift.thumbnailKey || gift.imageKey
    if (thumbnailKey) {
      result.thumbnailUrl = await repository.getDownloadUrl(thumbnailKey)
    }

    return result
  }

  function normalizeIndex(stored, legacyGifts = []) {
    const hasStoredIndex = stored && Array.isArray(stored.gifts)
    const gifts = sortGifts(hasStoredIndex ? stored.gifts : legacyGifts)
    const revision = Number.isInteger(stored && stored.revision) && stored.revision >= 0
      ? stored.revision
      : 0

    return {
      index: {
        schemaVersion: INDEX_SCHEMA_VERSION,
        revision,
        updatedAt: Number(stored && stored.updatedAt) || now(),
        gifts
      },
      needsMigration: !hasStoredIndex || stored.schemaVersion !== INDEX_SCHEMA_VERSION
    }
  }

  async function readIndex() {
    const stored = await repository.getIndex()
    if (stored && Array.isArray(stored.gifts)) {
      return normalizeIndex(stored)
    }

    const legacyGifts = await repository.listLegacyGifts()
    return normalizeIndex(null, legacyGifts)
  }

  async function acquireMutationLock() {
    const owner = randomBytes(12)
    const waitDeadline = Date.now() + (config.mutationLockWaitMs || 2000)

    while (Date.now() <= waitDeadline) {
      const acquired = await repository.tryAcquireMutationLock({
        owner,
        createdAt: now(),
        expiresAt: now() + (config.mutationLockLeaseMs || 30 * 1000)
      })
      if (acquired) return owner

      const existing = await repository.getMutationLock()
      if (existing && Number(existing.expiresAt) <= now()) {
        await repository.releaseMutationLock(existing.owner).catch(() => false)
        continue
      }
      await sleep(40)
    }

    throw new HttpError(503, 'GIFT_BUSY', '礼品夹正在同步，请稍后重试', {
      'retry-after': '1'
    })
  }

  async function withIndexLock(callback) {
    const owner = await acquireMutationLock()
    try {
      return await callback()
    } finally {
      try {
        await repository.releaseMutationLock(owner)
      } catch (error) {
        logger.warn('COS 索引锁释放失败', { owner, error })
      }
    }
  }

  async function ensureIndex() {
    const state = await readIndex()
    if (!state.needsMigration) return state.index

    return withIndexLock(async () => {
      const latest = await readIndex()
      if (!latest.needsMigration) return latest.index

      const migrated = Object.assign({}, latest.index, {
        revision: Math.max(1, latest.index.revision),
        updatedAt: now()
      })
      await repository.putIndex(migrated)
      logger.info('礼品索引已升级到 schemaVersion 2', {
        total: migrated.gifts.length,
        revision: migrated.revision
      })
      return migrated
    })
  }

  async function mutateIndex(mutator) {
    return withIndexLock(async () => {
      const state = await readIndex()
      const mutation = await mutator(state.index)

      if (mutation.changed === false && !state.needsMigration) {
        return Object.assign({}, mutation, { index: state.index })
      }

      const nextIndex = {
        schemaVersion: INDEX_SCHEMA_VERSION,
        revision: state.index.revision + 1,
        updatedAt: now(),
        gifts: sortGifts(mutation.gifts || state.index.gifts)
      }
      await repository.putIndex(nextIndex)
      return Object.assign({}, mutation, { index: nextIndex })
    })
  }

  function parseCursor(value) {
    if (!value) return { type: 'start' }
    try {
      const decoded = Buffer.from(String(value), 'base64url').toString('utf8')
      if (/^\d+$/.test(decoded)) {
        return { type: 'offset', offset: Number(decoded) }
      }
      const cursor = JSON.parse(decoded)
      if (cursor && cursor.v === 2 && Number.isFinite(cursor.createdAt) && cursor.id) {
        return {
          type: 'keyset',
          createdAt: Number(cursor.createdAt),
          id: String(cursor.id)
        }
      }
    } catch (error) {}
    return { type: 'start' }
  }

  function createCursor(gift) {
    return Buffer.from(JSON.stringify({
      v: 2,
      createdAt: Number(gift.createdAt),
      id: String(gift.id)
    }), 'utf8').toString('base64url')
  }

  function isSameGiftPayload(existing, draft) {
    return existing.name === draft.name &&
      existing.description === draft.description &&
      (existing.imageKey || '') === draft.imageKey &&
      (existing.thumbnailKey || '') === draft.thumbnailKey
  }

  async function login(event) {
    enforceLoginRateLimit(event)
    const body = bodyOf(event)
    const code = String(body.code || '').trim()

    if (!code || code.length > 128) {
      throw new HttpError(400, 'INVALID_LOGIN_CODE', '微信登录凭证无效')
    }

    let identity
    try {
      identity = await wechatAuth.exchangeCode(code)
    } catch (error) {
      logger.warn('微信 code2session 失败', error.details || error.message)
      throw new HttpError(401, 'WECHAT_LOGIN_FAILED', '微信登录失败，请稍后重试')
    }

    if (config.openIdDiscovery) {
      logger.info('[OPENID_DISCOVERY] openid=' + identity.openId)
    }

    if (!config.allowedOpenIds.has(identity.openId)) {
      throw new HttpError(403, 'FORBIDDEN', '当前微信账号无权访问心愿夹')
    }

    return success(tokenService.issue(identity.openId))
  }

  async function listGifts(event) {
    const query = event.queryStringParameters || {}
    const limit = Math.min(Math.max(Number(query.limit) || 20, 1), 20)
    const cursor = parseCursor(query.cursor)
    const index = await ensureIndex()
    let candidates = index.gifts

    if (cursor.type === 'offset') {
      candidates = candidates.slice(cursor.offset)
    } else if (cursor.type === 'keyset') {
      candidates = candidates.filter((gift) => compareGifts(gift, cursor) > 0)
    }

    const page = candidates.slice(0, limit)
    const hasMore = candidates.length > page.length

    return success({
      items: await Promise.all(page.map((gift) => presentGift(gift))),
      total: index.gifts.length,
      hasMore,
      nextCursor: hasMore && page.length ? createCursor(page[page.length - 1]) : ''
    })
  }

  function createGiftDraft(body, id, createdAt) {
    return {
      id,
      name: normalizeText(body.name, 40, '礼品名称'),
      description: normalizeText(body.description, 200, '简介'),
      imageKey: String(body.imageKey || ''),
      thumbnailKey: String(body.thumbnailKey || ''),
      createdAt,
      updatedAt: createdAt
    }
  }

  async function createGift(event) {
    const body = bodyOf(event)
    const id = validateGiftId(body.id)
    const createdAt = now()
    const gift = createGiftDraft(body, id, createdAt)

    if (!gift.name && !gift.description && !gift.imageKey) {
      throw new HttpError(400, 'EMPTY_GIFT', '请添加图片或文字')
    }

    await validateImage(gift.imageKey, id)
    await validateImage(gift.thumbnailKey, id)

    const mutation = await mutateIndex(async (index) => {
      const existing = index.gifts.find((item) => item.id === id)
      if (existing) {
        if (isSameGiftPayload(existing, gift)) {
          return { changed: false, gift: existing, created: false }
        }
        throw new HttpError(409, 'GIFT_EXISTS', '礼品已经存在')
      }

      return {
        changed: true,
        gift,
        created: true,
        gifts: [gift].concat(index.gifts)
      }
    })
    const total = mutation.index.gifts.length
    return success(await presentGift(mutation.gift, total), mutation.created ? 201 : 200)
  }

  async function deleteCollectionImageIfUnreferenced(imageKey) {
    if (!imageKey) return false

    const [giftState, decorState] = await Promise.all([
      readIndex(),
      typeof repository.getDecorIndex === 'function'
        ? readDecorIndex()
        : Promise.resolve({ index: { items: [] } })
    ])
    const inUse = giftState.index.gifts.some((item) =>
      item.imageKey === imageKey || item.thumbnailKey === imageKey
    ) || decorState.index.items.some((item) =>
      item.imageKey === imageKey || item.thumbnailKey === imageKey
    )
    if (inUse) return false

    await repository.deleteImage(imageKey)
    return true
  }

  async function updateGift(event, id) {
    const body = bodyOf(event)
    const draft = createGiftDraft(body, id, now())

    if (!draft.name && !draft.description && !draft.imageKey) {
      throw new HttpError(400, 'EMPTY_GIFT', '请添加图片或文字')
    }

    await validateImage(draft.imageKey, id)
    await validateImage(draft.thumbnailKey, id)

    const mutation = await mutateIndex(async (index) => {
      const existing = index.gifts.find((item) => item.id === id)
      if (!existing) {
        throw new HttpError(404, 'GIFT_NOT_FOUND', '礼品不存在')
      }

      const gift = Object.assign({}, draft, {
        createdAt: Number(existing.createdAt) || now(),
        updatedAt: now()
      })
      return {
        changed: true,
        gift,
        previous: existing,
        gifts: [gift].concat(index.gifts.filter((item) => item.id !== id))
      }
    })

    const existing = mutation.previous
    const gift = mutation.gift
    if (existing.imageKey && existing.imageKey !== gift.imageKey) {
      deleteCollectionImageIfUnreferenced(existing.imageKey).catch((error) => {
        logger.warn('旧礼品图片清理失败', { id, imageKey: existing.imageKey, error })
      })
    }
    if (existing.thumbnailKey && existing.thumbnailKey !== gift.thumbnailKey && existing.thumbnailKey !== existing.imageKey) {
      deleteCollectionImageIfUnreferenced(existing.thumbnailKey).catch((error) => {
        logger.warn('旧礼品缩略图清理失败', { id, imageKey: existing.thumbnailKey, error })
      })
    }

    return success(await presentGift(gift, mutation.index.gifts.length))
  }

  async function deleteGift(id) {
    const mutation = await mutateIndex(async (index) => {
      const existing = index.gifts.find((item) => item.id === id)
      if (!existing) {
        throw new HttpError(404, 'GIFT_NOT_FOUND', '礼品不存在')
      }

      return {
        changed: true,
        previous: existing,
        gifts: index.gifts.filter((item) => item.id !== id)
      }
    })
    const existing = mutation.previous

    if (existing.imageKey) {
      deleteCollectionImageIfUnreferenced(existing.imageKey).catch((error) => {
        logger.warn('礼品图片清理失败', { id, imageKey: existing.imageKey, error })
      })
    }
    if (existing.thumbnailKey && existing.thumbnailKey !== existing.imageKey) {
      deleteCollectionImageIfUnreferenced(existing.thumbnailKey).catch((error) => {
        logger.warn('礼品缩略图清理失败', { id, imageKey: existing.thumbnailKey, error })
      })
    }

    return success({ id, total: mutation.index.gifts.length })
  }

  function createUploadDraft(event) {
    const body = bodyOf(event)
    const giftId = validateCollectionItemId(body.giftId)
    const contentType = String(body.contentType || '').toLowerCase()
    const size = Number(body.size)
    const extension = IMAGE_TYPES.get(contentType)

    if (!extension) {
      throw new HttpError(400, 'INVALID_IMAGE_TYPE', '图片格式不受支持')
    }
    if (!Number.isFinite(size) || size <= 0 || size > config.maxImageBytes) {
      throw new HttpError(400, 'IMAGE_TOO_LARGE', '图片大小不能超过 8MB')
    }

    const asset = String(body.asset || 'image') === 'thumbnail' ? 'thumbnail' : 'image'
    const objectPrefix = asset === 'thumbnail' ? 'thumbnails' : 'images'
    const imageKey = config.cosPrefix + '/' + objectPrefix + '/' + giftId + '/' +
      now() + '_' + randomBytes(8) + '.' + extension

    return { contentType, giftId, imageKey, size }
  }

  async function createFormUpload(event) {
    const upload = createUploadDraft(event)
    const signed = repository.getFormUpload(
      upload.imageKey,
      upload.contentType,
      upload.size,
      config.uploadUrlTtlSeconds,
      now()
    )
    return success(Object.assign({}, signed, { contentType: upload.contentType }))
  }

  async function createLegacyUpload(event) {
    if (!config.legacyPutUploadUntil || now() > config.legacyPutUploadUntil) {
      throw new HttpError(410, 'LEGACY_UPLOAD_DISABLED', '旧版图片上传已停用，请更新小程序')
    }

    const upload = createUploadDraft(event)
    logger.warn('旧版预签名 PUT 上传仍在兼容窗口内使用', {
      imageKey: upload.imageKey,
      expiresAt: config.legacyPutUploadUntil
    })
    const uploadUrl = await repository.getUploadUrl(upload.imageKey, config.uploadUrlTtlSeconds)
    return success({
      imageKey: upload.imageKey,
      uploadUrl,
      contentType: upload.contentType,
      expiresAt: now() + config.uploadUrlTtlSeconds * 1000
    })
  }

  async function deleteOrphan(event) {
    const body = bodyOf(event)
    const imageKey = String(body.imageKey || '')

    if (!repository.isImageKey(imageKey)) {
      throw new HttpError(400, 'INVALID_IMAGE_KEY', '图片路径无效')
    }

    const [index, decorIndex] = await Promise.all([
      ensureIndex(),
      typeof repository.getDecorIndex === 'function' ? ensureDecorIndex() : { items: [] }
    ])
    const inUse = index.gifts.some((gift) =>
      gift.imageKey === imageKey || gift.thumbnailKey === imageKey
    ) || decorIndex.items.some((item) =>
      item.imageKey === imageKey || item.thumbnailKey === imageKey
    )
    if (inUse) {
      throw new HttpError(409, 'IMAGE_IN_USE', '图片仍被礼品使用')
    }

    await repository.deleteImage(imageKey)
    return success({ imageKey })
  }

  async function validateDecorImage(imageKey, itemId) {
    if (!imageKey) return

    // 装修好物只能引用 decor 命名空间中属于自身 ID 的图片。
    if (!isCollectionImageKeyForItem(imageKey, itemId)) {
      throw new HttpError(400, 'INVALID_IMAGE_KEY', '图片路径无效')
    }

    let info
    try {
      info = await repository.getImageInfo(imageKey)
    } catch (error) {
      if (repository.isNotFoundError(error)) {
        throw new HttpError(400, 'IMAGE_NOT_FOUND', '上传的图片不存在')
      }
      logger.error('COS 装修好物图片校验失败', { itemId, imageKey, error })
      throw new HttpError(503, 'IMAGE_VALIDATION_UNAVAILABLE', '图片校验暂时不可用，请稍后重试')
    }

    if (!IMAGE_TYPES.has(info.contentType)) {
      throw new HttpError(400, 'INVALID_IMAGE_TYPE', '图片格式不受支持')
    }
    if (!info.size || info.size > config.maxImageBytes) {
      throw new HttpError(400, 'IMAGE_TOO_LARGE', '图片大小不能超过 8MB')
    }
  }

  async function presentDecorItem(item, total) {
    const result = {
      id: item.id,
      name: item.name || '',
      description: item.description || '',
      imageKey: item.imageKey || '',
      thumbnailKey: item.thumbnailKey || '',
      thumbnailUrl: '',
      createdAt: item.createdAt,
      updatedAt: item.updatedAt
    }
    if (Number.isInteger(total)) result.total = total

    const thumbnailKey = item.thumbnailKey || item.imageKey
    if (thumbnailKey) {
      result.thumbnailUrl = await repository.getDownloadUrl(thumbnailKey)
    }
    return result
  }

  function normalizeDecorIndex(stored) {
    if (stored && !Array.isArray(stored.items)) {
      // 已存在但结构异常的索引不能被空数组覆盖，留待备份恢复。
      throw new HttpError(503, 'DECOR_INDEX_INVALID', '装修好物索引异常，请稍后重试')
    }
    const hasStoredIndex = stored && Array.isArray(stored.items)
    const items = sortGifts(hasStoredIndex ? stored.items : [])
    const revision = Number.isInteger(stored && stored.revision) && stored.revision >= 0
      ? stored.revision
      : 0

    return {
      index: {
        schemaVersion: INDEX_SCHEMA_VERSION,
        revision,
        updatedAt: Number(stored && stored.updatedAt) || now(),
        items
      },
      needsMigration: !hasStoredIndex || stored.schemaVersion !== INDEX_SCHEMA_VERSION
    }
  }

  async function readDecorIndex() {
    return normalizeDecorIndex(await repository.getDecorIndex())
  }

  async function acquireDecorMutationLock() {
    const owner = randomBytes(12)
    const waitDeadline = Date.now() + (config.mutationLockWaitMs || 2000)

    while (Date.now() <= waitDeadline) {
      const acquired = await repository.tryAcquireDecorMutationLock({
        owner,
        createdAt: now(),
        expiresAt: now() + (config.mutationLockLeaseMs || 30 * 1000)
      })
      if (acquired) return owner

      const existing = await repository.getDecorMutationLock()
      if (existing && Number(existing.expiresAt) <= now()) {
        await repository.releaseDecorMutationLock(existing.owner).catch(() => false)
        continue
      }
      await sleep(40)
    }

    throw new HttpError(503, 'DECOR_BUSY', '装修好物正在同步，请稍后重试', {
      'retry-after': '1'
    })
  }

  async function withDecorIndexLock(callback) {
    const owner = await acquireDecorMutationLock()
    try {
      return await callback()
    } finally {
      try {
        await repository.releaseDecorMutationLock(owner)
      } catch (error) {
        logger.warn('COS 装修好物索引锁释放失败', { owner, error })
      }
    }
  }

  async function ensureDecorIndex() {
    const state = await readDecorIndex()
    if (!state.needsMigration) return state.index

    return withDecorIndexLock(async () => {
      const latest = await readDecorIndex()
      if (!latest.needsMigration) return latest.index

      const initialized = Object.assign({}, latest.index, {
        revision: Math.max(1, latest.index.revision),
        updatedAt: now()
      })
      await repository.putDecorIndex(initialized)
      logger.info('装修好物索引已初始化', {
        total: initialized.items.length,
        revision: initialized.revision
      })
      return initialized
    })
  }

  async function mutateDecorIndex(mutator) {
    return withDecorIndexLock(async () => {
      const state = await readDecorIndex()
      const mutation = await mutator(state.index)

      if (mutation.changed === false && !state.needsMigration) {
        return Object.assign({}, mutation, { index: state.index })
      }

      const nextIndex = {
        schemaVersion: INDEX_SCHEMA_VERSION,
        revision: state.index.revision + 1,
        updatedAt: now(),
        items: sortGifts(mutation.items || state.index.items)
      }
      await repository.putDecorIndex(nextIndex)
      return Object.assign({}, mutation, { index: nextIndex })
    })
  }

  async function listDecorItems(event) {
    const query = event.queryStringParameters || {}
    const limit = Math.min(Math.max(Number(query.limit) || 20, 1), 20)
    const cursor = parseCursor(query.cursor)
    const index = await ensureDecorIndex()
    let candidates = index.items

    if (cursor.type === 'offset') {
      candidates = candidates.slice(cursor.offset)
    } else if (cursor.type === 'keyset') {
      candidates = candidates.filter((item) => compareGifts(item, cursor) > 0)
    }

    const page = candidates.slice(0, limit)
    const hasMore = candidates.length > page.length
    return success({
      items: await Promise.all(page.map((item) => presentDecorItem(item))),
      total: index.items.length,
      hasMore,
      nextCursor: hasMore && page.length ? createCursor(page[page.length - 1]) : ''
    })
  }

  function createDecorDraft(body, id, createdAt) {
    return {
      id,
      name: normalizeText(body.name, 40, '好物名称'),
      description: normalizeText(body.description, 200, '简介'),
      imageKey: String(body.imageKey || ''),
      thumbnailKey: String(body.thumbnailKey || ''),
      createdAt,
      updatedAt: createdAt
    }
  }

  async function createDecorItem(event) {
    const body = bodyOf(event)
    const id = validateDecorId(body.id)
    const item = createDecorDraft(body, id, now())
    if (!item.name && !item.description && !item.imageKey) {
      throw new HttpError(400, 'EMPTY_DECOR_ITEM', '请添加图片或文字')
    }

    await validateDecorImage(item.imageKey, id)
    await validateDecorImage(item.thumbnailKey, id)

    const mutation = await mutateDecorIndex(async (index) => {
      const existing = index.items.find((entry) => entry.id === id)
      if (existing) {
        if (isSameGiftPayload(existing, item)) {
          return { changed: false, item: existing, created: false }
        }
        throw new HttpError(409, 'DECOR_ITEM_EXISTS', '装修好物已经存在')
      }
      return { changed: true, item, created: true, items: [item].concat(index.items) }
    })
    return success(
      await presentDecorItem(mutation.item, mutation.index.items.length),
      mutation.created ? 201 : 200
    )
  }

  async function updateDecorItem(event, id) {
    const body = bodyOf(event)
    const draft = createDecorDraft(body, id, now())
    if (!draft.name && !draft.description && !draft.imageKey) {
      throw new HttpError(400, 'EMPTY_DECOR_ITEM', '请添加图片或文字')
    }

    await validateDecorImage(draft.imageKey, id)
    await validateDecorImage(draft.thumbnailKey, id)
    const mutation = await mutateDecorIndex(async (index) => {
      const existing = index.items.find((entry) => entry.id === id)
      if (!existing) {
        throw new HttpError(404, 'DECOR_ITEM_NOT_FOUND', '装修好物不存在')
      }
      const item = Object.assign({}, draft, {
        createdAt: Number(existing.createdAt) || now(),
        updatedAt: now()
      })
      return {
        changed: true,
        item,
        previous: existing,
        items: [item].concat(index.items.filter((entry) => entry.id !== id))
      }
    })

    const previous = mutation.previous
    const item = mutation.item
    if (previous.imageKey && previous.imageKey !== item.imageKey) {
      deleteCollectionImageIfUnreferenced(previous.imageKey).catch((error) => {
        logger.warn('旧装修好物图片清理失败', { id, imageKey: previous.imageKey, error })
      })
    }
    if (previous.thumbnailKey && previous.thumbnailKey !== item.thumbnailKey && previous.thumbnailKey !== previous.imageKey) {
      deleteCollectionImageIfUnreferenced(previous.thumbnailKey).catch((error) => {
        logger.warn('旧装修好物缩略图清理失败', { id, imageKey: previous.thumbnailKey, error })
      })
    }
    return success(await presentDecorItem(item, mutation.index.items.length))
  }

  async function deleteDecorItem(id) {
    const mutation = await mutateDecorIndex(async (index) => {
      const existing = index.items.find((entry) => entry.id === id)
      if (!existing) {
        throw new HttpError(404, 'DECOR_ITEM_NOT_FOUND', '装修好物不存在')
      }
      return {
        changed: true,
        previous: existing,
        items: index.items.filter((entry) => entry.id !== id)
      }
    })
    const previous = mutation.previous
    if (previous.imageKey) {
      deleteCollectionImageIfUnreferenced(previous.imageKey).catch((error) => {
        logger.warn('装修好物图片清理失败', { id, imageKey: previous.imageKey, error })
      })
    }
    if (previous.thumbnailKey && previous.thumbnailKey !== previous.imageKey) {
      deleteCollectionImageIfUnreferenced(previous.thumbnailKey).catch((error) => {
        logger.warn('装修好物缩略图清理失败', { id, imageKey: previous.thumbnailKey, error })
      })
    }
    return success({ id, total: mutation.index.items.length })
  }

  function createDecorUploadDraft(event) {
    const body = bodyOf(event)
    const itemId = validateCollectionItemId(body.itemId)
    const contentType = String(body.contentType || '').toLowerCase()
    const size = Number(body.size)
    const extension = IMAGE_TYPES.get(contentType)
    if (!extension) {
      throw new HttpError(400, 'INVALID_IMAGE_TYPE', '图片格式不受支持')
    }
    if (!Number.isFinite(size) || size <= 0 || size > config.maxImageBytes) {
      throw new HttpError(400, 'IMAGE_TOO_LARGE', '图片大小不能超过 8MB')
    }

    const asset = String(body.asset || 'image') === 'thumbnail' ? 'thumbnail' : 'image'
    const objectPrefix = asset === 'thumbnail' ? 'thumbnails' : 'images'
    const imageKey = config.cosPrefix + '/decor/' + objectPrefix + '/' + itemId + '/' +
      now() + '_' + randomBytes(8) + '.' + extension
    return { contentType, imageKey, size }
  }

  async function createDecorFormUpload(event) {
    const upload = createDecorUploadDraft(event)
    const signed = repository.getFormUpload(
      upload.imageKey,
      upload.contentType,
      upload.size,
      config.uploadUrlTtlSeconds,
      now()
    )
    return success(Object.assign({}, signed, { contentType: upload.contentType }))
  }

  async function deleteDecorOrphan(event) {
    const body = bodyOf(event)
    const imageKey = String(body.imageKey || '')
    if (!repository.isDecorImageKey(imageKey)) {
      throw new HttpError(400, 'INVALID_IMAGE_KEY', '图片路径无效')
    }

    const [index, giftIndex] = await Promise.all([ensureDecorIndex(), ensureIndex()])
    const inUse = index.items.some((item) =>
      item.imageKey === imageKey || item.thumbnailKey === imageKey
    ) || giftIndex.gifts.some((gift) =>
      gift.imageKey === imageKey || gift.thumbnailKey === imageKey
    )
    if (inUse) {
      throw new HttpError(409, 'IMAGE_IN_USE', '图片仍被装修好物使用')
    }

    await repository.deleteImage(imageKey)
    return success({ imageKey })
  }

  async function moveCollectionItem(event, id) {
    const body = bodyOf(event)
    const targetCollection = String(body.targetCollection || '')
    if (targetCollection !== 'gift' && targetCollection !== 'decor') {
      throw new HttpError(400, 'INVALID_TARGET_COLLECTION', '目标分类无效')
    }

    // 固定按礼品锁、装修锁的顺序取锁，避免两个并发移动互相等待。
    const mutation = await withIndexLock(() => withDecorIndexLock(async () => {
      const giftState = await readIndex()
      const decorState = await readDecorIndex()
      const giftItem = giftState.index.gifts.find((item) => item.id === id)
      const decorItem = decorState.index.items.find((item) => item.id === id)

      if (!giftItem && !decorItem) {
        throw new HttpError(404, 'COLLECTION_ITEM_NOT_FOUND', '收藏项不存在')
      }

      if (targetCollection === 'gift' && giftItem && !decorItem) {
        return {
          item: giftItem,
          sourceCollection: 'decor',
          targetCollection,
          sourceTotal: decorState.index.items.length,
          targetTotal: giftState.index.gifts.length
        }
      }
      if (targetCollection === 'decor' && decorItem && !giftItem) {
        return {
          item: decorItem,
          sourceCollection: 'gift',
          targetCollection,
          sourceTotal: giftState.index.gifts.length,
          targetTotal: decorState.index.items.length
        }
      }

      const movingItem = targetCollection === 'gift' ? decorItem : giftItem
      const movedItem = Object.assign({}, movingItem, { updatedAt: now() })
      const nextGiftIndex = {
        schemaVersion: INDEX_SCHEMA_VERSION,
        revision: giftState.index.revision + 1,
        updatedAt: now(),
        gifts: sortGifts(targetCollection === 'gift'
          ? [movedItem].concat(giftState.index.gifts.filter((item) => item.id !== id))
          : giftState.index.gifts.filter((item) => item.id !== id))
      }
      const nextDecorIndex = {
        schemaVersion: INDEX_SCHEMA_VERSION,
        revision: decorState.index.revision + 1,
        updatedAt: now(),
        items: sortGifts(targetCollection === 'decor'
          ? [movedItem].concat(decorState.index.items.filter((item) => item.id !== id))
          : decorState.index.items.filter((item) => item.id !== id))
      }

      // 先写目标再删来源；若第二步失败，只会短暂重复，重试可继续完成，不会丢失收藏项。
      if (targetCollection === 'gift') {
        await repository.putIndex(nextGiftIndex)
        await repository.putDecorIndex(nextDecorIndex)
      } else {
        await repository.putDecorIndex(nextDecorIndex)
        await repository.putIndex(nextGiftIndex)
      }

      return {
        item: movedItem,
        sourceCollection: targetCollection === 'gift' ? 'decor' : 'gift',
        targetCollection,
        sourceTotal: targetCollection === 'gift' ? nextDecorIndex.items.length : nextGiftIndex.gifts.length,
        targetTotal: targetCollection === 'gift' ? nextGiftIndex.gifts.length : nextDecorIndex.items.length
      }
    }))

    const item = targetCollection === 'gift'
      ? await presentGift(mutation.item)
      : await presentDecorItem(mutation.item)
    return success(Object.assign({}, mutation, { item }))
  }

  async function cleanupOrphanImages() {
    const giftResult = await withIndexLock(async () => {
      const state = await readIndex()
      let index = state.index
      if (state.needsMigration) {
        index = Object.assign({}, index, {
          revision: Math.max(1, index.revision),
          updatedAt: now()
        })
        await repository.putIndex(index)
      }

      const referenced = new Set()
      for (const gift of index.gifts) {
        if (gift.imageKey) referenced.add(gift.imageKey)
        if (gift.thumbnailKey) referenced.add(gift.thumbnailKey)
      }
      // 移动后图片保留原 Key，因此两个索引都可能引用当前命名空间。
      const decorIndex = (await readDecorIndex()).index
      for (const item of decorIndex.items) {
        if (item.imageKey) referenced.add(item.imageKey)
        if (item.thumbnailKey) referenced.add(item.thumbnailKey)
      }
      const cutoff = now() - (config.orphanGraceMs || 24 * 60 * 60 * 1000)
      const objects = await repository.listImageObjects()
      const candidates = objects
        .filter((item) => item.lastModified && item.lastModified <= cutoff && !referenced.has(item.key))
        .slice(0, config.orphanCleanupBatchSize || 200)
      let deleted = 0
      let failed = 0

      for (const item of candidates) {
        try {
          await repository.deleteImage(item.key)
          deleted += 1
        } catch (error) {
          failed += 1
          logger.warn('孤儿图片定时清理失败', { imageKey: item.key, error })
        }
      }

      const result = {
        scanned: objects.length,
        candidates: candidates.length,
        deleted,
        failed
      }
      return result
    })

    // 两套索引各自加锁和统计，避免装修好物扫描影响旧礼品写入。
    const decorResult = await withDecorIndexLock(async () => {
      const state = await readDecorIndex()
      let index = state.index
      if (state.needsMigration) {
        index = Object.assign({}, index, {
          revision: Math.max(1, index.revision),
          updatedAt: now()
        })
        await repository.putDecorIndex(index)
      }

      const referenced = new Set()
      for (const item of index.items) {
        if (item.imageKey) referenced.add(item.imageKey)
        if (item.thumbnailKey) referenced.add(item.thumbnailKey)
      }
      const giftIndex = (await readIndex()).index
      for (const gift of giftIndex.gifts) {
        if (gift.imageKey) referenced.add(gift.imageKey)
        if (gift.thumbnailKey) referenced.add(gift.thumbnailKey)
      }
      const cutoff = now() - (config.orphanGraceMs || 24 * 60 * 60 * 1000)
      const objects = await repository.listDecorImageObjects()
      const candidates = objects
        .filter((item) => item.lastModified && item.lastModified <= cutoff && !referenced.has(item.key))
        .slice(0, config.orphanCleanupBatchSize || 200)
      let deleted = 0
      let failed = 0

      for (const item of candidates) {
        try {
          await repository.deleteImage(item.key)
          deleted += 1
        } catch (error) {
          failed += 1
          logger.warn('装修好物孤儿图片定时清理失败', { imageKey: item.key, error })
        }
      }
      return { scanned: objects.length, candidates: candidates.length, deleted, failed }
    })

    const result = {
      scanned: giftResult.scanned + decorResult.scanned,
      candidates: giftResult.candidates + decorResult.candidates,
      deleted: giftResult.deleted + decorResult.deleted,
      failed: giftResult.failed + decorResult.failed,
      gift: giftResult,
      decor: decorResult
    }
    logger.info('心愿夹孤儿图片定时清理完成', result)
    return result
  }

  return async function handle(event = {}) {
    const method = String(event.httpMethod || '').toUpperCase()
    const path = normalizePath(event.path)

    try {
      if (!method && event.Type === 'Timer' && event.TriggerName === config.cleanupTimerName) {
        return await cleanupOrphanImages()
      }

      if (method === 'GET' && path === '/health') {
        return success({ status: 'ok' })
      }

      if (method === 'POST' && path === '/auth/login') {
        return await login(event)
      }

      requireUser(event)

      if (method === 'GET' && path === '/gifts') {
        return await listGifts(event)
      }
      if (method === 'POST' && path === '/gifts') {
        return await createGift(event)
      }

      const giftMatch = path.match(/^\/gifts\/([^/]+)$/)
      if (giftMatch && method === 'PUT') {
        return await updateGift(event, validateCollectionItemId(giftMatch[1]))
      }
      if (giftMatch && method === 'DELETE') {
        return await deleteGift(validateCollectionItemId(giftMatch[1]))
      }

      const imageMatch = path.match(/^\/gifts\/([^/]+)\/image$/)
      if (imageMatch && method === 'GET') {
        const id = validateCollectionItemId(imageMatch[1])
        const index = await ensureIndex()
        const gift = index.gifts.find((item) => item.id === id)
        if (!gift || !gift.imageKey) {
          throw new HttpError(404, 'IMAGE_NOT_FOUND', '礼品图片不存在')
        }
        return success({ imageUrl: await repository.getDownloadUrl(gift.imageKey) })
      }

      if (method === 'POST' && path === '/uploads/form-policy') {
        return await createFormUpload(event)
      }
      if (method === 'POST' && path === '/uploads/thumbnail') {
        return await createPersistentThumbnail(event, 'gift')
      }
      if (method === 'POST' && path === '/uploads/presign') {
        return await createLegacyUpload(event)
      }
      if (method === 'DELETE' && path === '/uploads/orphan') {
        return await deleteOrphan(event)
      }

      if (method === 'GET' && path === '/collections/decor/items') {
        return await listDecorItems(event)
      }
      if (method === 'POST' && path === '/collections/decor/items') {
        return await createDecorItem(event)
      }

      const decorItemMatch = path.match(/^\/collections\/decor\/items\/([^/]+)$/)
      if (decorItemMatch && method === 'PUT') {
        return await updateDecorItem(event, validateCollectionItemId(decorItemMatch[1]))
      }
      if (decorItemMatch && method === 'DELETE') {
        return await deleteDecorItem(validateCollectionItemId(decorItemMatch[1]))
      }

      const decorImageMatch = path.match(/^\/collections\/decor\/items\/([^/]+)\/image$/)
      if (decorImageMatch && method === 'GET') {
        const id = validateCollectionItemId(decorImageMatch[1])
        const index = await ensureDecorIndex()
        const item = index.items.find((entry) => entry.id === id)
        if (!item || !item.imageKey) {
          throw new HttpError(404, 'IMAGE_NOT_FOUND', '装修好物图片不存在')
        }
        return success({ imageUrl: await repository.getDownloadUrl(item.imageKey) })
      }

      if (method === 'POST' && path === '/collections/decor/uploads/form-policy') {
        return await createDecorFormUpload(event)
      }
      if (method === 'POST' && path === '/collections/decor/uploads/thumbnail') {
        return await createPersistentThumbnail(event, 'decor')
      }
      if (method === 'DELETE' && path === '/collections/decor/uploads/orphan') {
        return await deleteDecorOrphan(event)
      }

      const moveItemMatch = path.match(/^\/collections\/items\/([^/]+)\/move$/)
      if (moveItemMatch && method === 'POST') {
        return await moveCollectionItem(event, validateCollectionItemId(moveItemMatch[1]))
      }

      throw new HttpError(404, 'NOT_FOUND', '接口不存在')
    } catch (error) {
      if (error instanceof HttpError) {
        return response(error.statusCode, {
          error: {
            code: error.code,
            message: error.message
          }
        }, error.headers)
      }

      logger.error('礼品 API 未处理异常', error)
      return response(500, {
        error: {
          code: 'INTERNAL_ERROR',
          message: '服务暂时不可用'
        }
      })
    }
  }
}

module.exports = {
  HttpError,
  compareGifts,
  createApp
}
