'use strict'

const crypto = require('node:crypto')

const IMAGE_TYPES = new Map([
  ['image/jpeg', 'jpg'],
  ['image/png', 'png'],
  ['image/webp', 'webp']
])
const GIFT_ID_PATTERN = /^gift_[A-Za-z0-9_-]{8,72}$/

class HttpError extends Error {
  constructor(statusCode, code, message) {
    super(message)
    this.statusCode = statusCode
    this.code = code
  }
}

function response(statusCode, payload) {
  return {
    statusCode,
    headers: {
      'content-type': 'application/json; charset=utf-8',
      'cache-control': 'no-store'
    },
    body: JSON.stringify(payload)
  }
}

function success(data, statusCode = 200) {
  return response(statusCode, { data })
}

function parseBody(event) {
  if (!event.body) {
    return {}
  }

  if (typeof event.body === 'object') {
    return event.body
  }

  try {
    const text = event.isBase64Encoded
      ? Buffer.from(event.body, 'base64').toString('utf8')
      : event.body
    return JSON.parse(text)
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

function normalizeText(value, maxLength, fieldName) {
  const text = typeof value === 'string' ? value.trim() : ''

  if (text.length > maxLength) {
    throw new HttpError(400, 'FIELD_TOO_LONG', fieldName + '内容过长')
  }

  return text
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
  function requireUser(event) {
    const authorization = getHeader(event.headers, 'authorization')
    const token = authorization.startsWith('Bearer ') ? authorization.slice(7) : ''
    const payload = tokenService.verify(token)

    if (!payload) {
      throw new HttpError(401, 'UNAUTHORIZED', '登录状态已失效')
    }

    // 每次请求重新校验白名单，移除用户后权限立即失效。
    if (!config.allowedOpenIds.has(payload.sub)) {
      throw new HttpError(403, 'FORBIDDEN', '当前微信账号无权访问礼品夹')
    }

    return payload.sub
  }

  async function validateImage(imageKey, giftId) {
    if (!imageKey) {
      return
    }

    if (!repository.isImageKeyForGift(imageKey, giftId)) {
      throw new HttpError(400, 'INVALID_IMAGE_KEY', '图片路径无效')
    }

    let info
    try {
      info = await repository.getImageInfo(imageKey)
    } catch (error) {
      throw new HttpError(400, 'IMAGE_NOT_FOUND', '上传的图片不存在')
    }

    if (!IMAGE_TYPES.has(info.contentType)) {
      throw new HttpError(400, 'INVALID_IMAGE_TYPE', '图片格式不受支持')
    }

    if (!info.size || info.size > config.maxImageBytes) {
      throw new HttpError(400, 'IMAGE_TOO_LARGE', '图片大小不能超过 8MB')
    }
  }

  async function presentGift(gift) {
    const result = {
      id: gift.id,
      name: gift.name || '',
      description: gift.description || '',
      imageKey: gift.imageKey || '',
      thumbnailUrl: '',
      createdAt: gift.createdAt,
      updatedAt: gift.updatedAt
    }

    const thumbnailKey = gift.thumbnailKey || gift.imageKey
    if (thumbnailKey) {
      result.thumbnailUrl = await repository.getDownloadUrl(thumbnailKey)
    }

    return result
  }

  async function getIndex() {
    const stored = await repository.getIndex()

    if (stored && Array.isArray(stored.gifts)) {
      return stored.gifts
    }

    // 首次升级时从旧 JSON 重建索引，避免既有礼品丢失。
    const gifts = await repository.listGifts()
    gifts.sort((left, right) => Number(right.createdAt) - Number(left.createdAt))
    await repository.putIndex({ gifts, updatedAt: now() })
    return gifts
  }

  async function saveIndex(gifts) {
    const sorted = gifts.slice().sort((left, right) => Number(right.createdAt) - Number(left.createdAt))
    await repository.putIndex({ gifts: sorted, updatedAt: now() })
  }

  function parseCursor(value) {
    if (!value) return 0
    try {
      const offset = Number(Buffer.from(String(value), 'base64url').toString('utf8'))
      return Number.isInteger(offset) && offset >= 0 ? offset : 0
    } catch (error) {
      return 0
    }
  }

  function createCursor(offset) {
    return Buffer.from(String(offset), 'utf8').toString('base64url')
  }

  async function login(event) {
    const body = parseBody(event)
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
      // 发现模式只写日志，不会放行未授权用户。
      logger.info('[OPENID_DISCOVERY] openid=' + identity.openId)
    }

    if (!config.allowedOpenIds.has(identity.openId)) {
      throw new HttpError(403, 'FORBIDDEN', '当前微信账号无权访问礼品夹')
    }

    return success(tokenService.issue(identity.openId))
  }

  async function listGifts(event) {
    const query = event.queryStringParameters || {}
    const limit = Math.min(Math.max(Number(query.limit) || 20, 1), 20)
    const offset = parseCursor(query.cursor)
    const gifts = await getIndex()
    const page = gifts.slice(offset, offset + limit)
    const nextOffset = offset + page.length

    return success({
      items: await Promise.all(page.map(presentGift)),
      total: gifts.length,
      hasMore: nextOffset < gifts.length,
      nextCursor: nextOffset < gifts.length ? createCursor(nextOffset) : ''
    })
  }

  async function createGift(event) {
    const body = parseBody(event)
    const id = validateGiftId(body.id)

    if (await repository.getGift(id)) {
      throw new HttpError(409, 'GIFT_EXISTS', '礼品已经存在')
    }

    const gift = {
      id,
      name: normalizeText(body.name, 40, '礼品名称'),
      description: normalizeText(body.description, 200, '简介'),
      imageKey: String(body.imageKey || ''),
      thumbnailKey: String(body.thumbnailKey || ''),
      createdAt: now(),
      updatedAt: now()
    }

    if (!gift.name && !gift.description && !gift.imageKey) {
      throw new HttpError(400, 'EMPTY_GIFT', '请添加图片或文字')
    }

    await validateImage(gift.imageKey, id)
    await validateImage(gift.thumbnailKey, id)
    await repository.putGift(gift)
    const gifts = await getIndex()
    await saveIndex([gift].concat(gifts.filter((item) => item.id !== id)))
    return success(await presentGift(gift), 201)
  }

  async function updateGift(event, id) {
    const body = parseBody(event)
    const existing = await repository.getGift(id)

    if (!existing) {
      throw new HttpError(404, 'GIFT_NOT_FOUND', '礼品不存在')
    }

    const gift = {
      id,
      name: normalizeText(body.name, 40, '礼品名称'),
      description: normalizeText(body.description, 200, '简介'),
      imageKey: String(body.imageKey || ''),
      thumbnailKey: String(body.thumbnailKey || ''),
      createdAt: Number(existing.createdAt) || now(),
      updatedAt: now()
    }

    if (!gift.name && !gift.description && !gift.imageKey) {
      throw new HttpError(400, 'EMPTY_GIFT', '请添加图片或文字')
    }

    await validateImage(gift.imageKey, id)
    await validateImage(gift.thumbnailKey, id)
    await repository.putGift(gift)
    const gifts = await getIndex()
    await saveIndex([gift].concat(gifts.filter((item) => item.id !== id)))

    if (existing.imageKey && existing.imageKey !== gift.imageKey) {
      try {
        await repository.deleteImage(existing.imageKey)
      } catch (error) {
        logger.warn('旧礼品图片清理失败', { id, imageKey: existing.imageKey })
      }
    }
    if (existing.thumbnailKey && existing.thumbnailKey !== gift.thumbnailKey && existing.thumbnailKey !== existing.imageKey) {
      try {
        await repository.deleteImage(existing.thumbnailKey)
      } catch (error) {
        logger.warn('旧礼品缩略图清理失败', { id, imageKey: existing.thumbnailKey })
      }
    }

    return success(await presentGift(gift))
  }

  async function deleteGift(id) {
    const existing = await repository.getGift(id)

    if (!existing) {
      throw new HttpError(404, 'GIFT_NOT_FOUND', '礼品不存在')
    }

    await repository.deleteGift(id)
    const gifts = await getIndex()
    await saveIndex(gifts.filter((item) => item.id !== id))

    if (existing.imageKey) {
      try {
        await repository.deleteImage(existing.imageKey)
      } catch (error) {
        logger.warn('礼品图片清理失败', { id, imageKey: existing.imageKey })
      }
    }
    if (existing.thumbnailKey && existing.thumbnailKey !== existing.imageKey) {
      try {
        await repository.deleteImage(existing.thumbnailKey)
      } catch (error) {
        logger.warn('礼品缩略图清理失败', { id, imageKey: existing.thumbnailKey })
      }
    }

    return success({ id })
  }

  async function createUpload(event) {
    const body = parseBody(event)
    const giftId = validateGiftId(body.giftId)
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
    const uploadUrl = await repository.getUploadUrl(
      imageKey,
      config.uploadUrlTtlSeconds
    )

    return success({
      imageKey,
      uploadUrl,
      contentType,
      expiresAt: now() + config.uploadUrlTtlSeconds * 1000
    })
  }

  async function deleteOrphan(event) {
    const body = parseBody(event)
    const imageKey = String(body.imageKey || '')

    if (!repository.isImageKey(imageKey)) {
      throw new HttpError(400, 'INVALID_IMAGE_KEY', '图片路径无效')
    }

    const match = imageKey.match(/\/images\/(gift_[A-Za-z0-9_-]{8,72})\//)
    const gift = match ? await repository.getGift(match[1]) : null

    if (gift && gift.imageKey === imageKey) {
      throw new HttpError(409, 'IMAGE_IN_USE', '图片仍被礼品使用')
    }

    await repository.deleteImage(imageKey)
    return success({ imageKey })
  }

  return async function handle(event = {}) {
    const method = String(event.httpMethod || 'GET').toUpperCase()
    const path = normalizePath(event.path)

    try {
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
        return await updateGift(event, validateGiftId(giftMatch[1]))
      }
      if (giftMatch && method === 'DELETE') {
        return await deleteGift(validateGiftId(giftMatch[1]))
      }
      const imageMatch = path.match(/^\/gifts\/([^/]+)\/image$/)
      if (imageMatch && method === 'GET') {
        const gift = await repository.getGift(validateGiftId(imageMatch[1]))
        if (!gift || !gift.imageKey) {
          throw new HttpError(404, 'IMAGE_NOT_FOUND', '礼品图片不存在')
        }
        return success({ imageUrl: await repository.getDownloadUrl(gift.imageKey) })
      }

      if (method === 'POST' && path === '/uploads/presign') {
        return await createUpload(event)
      }

      if (method === 'DELETE' && path === '/uploads/orphan') {
        return await deleteOrphan(event)
      }

      throw new HttpError(404, 'NOT_FOUND', '接口不存在')
    } catch (error) {
      if (error instanceof HttpError) {
        return response(error.statusCode, {
          error: {
            code: error.code,
            message: error.message
          }
        })
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
  createApp
}
