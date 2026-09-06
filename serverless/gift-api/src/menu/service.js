'use strict'

const crypto = require('node:crypto')
const { ASSET_ID, createDocumentTools, emptyDocument, trimAssets, publicDocument } = require('./document')
const TYPES = { 'image/jpeg': 'jpg', 'image/png': 'png', 'image/webp': 'webp' }
const VERSION = /^r_[a-f0-9]{32}$/

function createMenuService({ repository, config = {}, HttpError, now = () => Date.now(), randomBytes = (size) => crypto.randomBytes(size).toString('hex'), logger = console }) {
  const store = repository.menu
  const { normalize } = createDocumentTools(HttpError)
  const maxImageBytes = config.maxImageBytes || 8 * 1024 * 1024
  const fail = (status, code, message) => { throw new HttpError(status, code, message) }
  const versionOf = (value) => {
    if (!VERSION.test(value || '')) fail(400, 'INVALID_VERSION', '菜单版本无效')
    return value
  }

  async function withLock(callback) {
    const owner = randomBytes(16)
    // 不按时间抢占锁；执行被中断时由管理员确认无运行实例后恢复。
    if (!await store.tryLock({ owner, createdAt: now() })) fail(409, 'MENU_BUSY', '菜单正在同步，请稍后重试')
    try { return await callback() } finally {
      await store.releaseLock(owner).catch((error) => logger.error('菜单写锁释放失败，需要人工核验', { error }))
    }
  }

  async function draft() {
    const stored = await store.getJson('draft.json')
    if (!stored) return { revision: 0, updatedAt: 0, document: emptyDocument() }
    if (!Number.isSafeInteger(stored.revision) || stored.revision < 1) throw new Error('菜单草稿修订号损坏')
    return Object.assign({}, stored, { document: normalize(stored.document) })
  }

  async function release(version) {
    const stored = await store.getJson('releases/' + versionOf(version) + '.json')
    if (!stored) fail(404, 'MENU_VERSION_NOT_FOUND', '菜单历史版本不存在')
    if (stored.version !== version || !Number.isFinite(stored.publishedAt)) throw new Error('菜单发布快照损坏')
    return Object.assign({}, stored, { document: normalize(stored.document) })
  }

  async function current() {
    const pointer = await store.getJson('current.json')
    return pointer ? release(pointer.version) : null
  }

  function checkRevision(expected, actual) {
    if (!Number.isSafeInteger(expected) || expected !== actual) fail(409, 'MENU_REVISION_CONFLICT', '草稿已被另一位编辑者修改，请保留当前内容并重新加载')
  }

  async function validateImages(document) {
    const checks = Object.values(document.assets).flatMap((asset) => [asset.imageKey, asset.thumbnailKey].map((key) => ({ key, asset })))
    let cursor = 0
    // 限制并发，避免整份菜单串行 HEAD 耗尽云函数时限。
    const results = await Promise.allSettled(Array.from({ length: Math.min(4, checks.length) }, async () => {
      while (cursor < checks.length) {
        const { key, asset } = checks[cursor++]
        let info
        try { info = await repository.getImageInfo(key) } catch (error) {
          if (repository.isNotFoundError(error)) fail(400, 'MENU_IMAGE_NOT_FOUND', '菜单图片不存在，请重新上传')
          throw error
        }
        if (!TYPES[info.contentType] || !info.size || info.size > maxImageBytes || key === asset.thumbnailKey && info.contentType !== 'image/webp') fail(400, 'INVALID_MENU_IMAGE', '菜单图片格式或大小无效')
      }
    }))
    const failure = results.find((result) => result.status === 'rejected')
    if (failure) throw failure.reason
  }

  async function save(body) {
    const document = trimAssets(normalize(body.document))
    return withLock(async () => {
      const existing = await draft()
      checkRevision(body.revision, existing.revision)
      await validateImages(document)
      const next = { revision: existing.revision + 1, updatedAt: now(), document }
      await store.putJson('draft.json', next)
      return next
    })
  }

  async function committedHistory() {
    const versions = []
    let item = await current()
    const seen = new Set()
    while (item) {
      if (seen.has(item.version)) throw new Error('菜单历史链循环')
      seen.add(item.version)
      versions.push(item)
      item = item.previousVersion ? await release(item.previousVersion) : null
    }
    return versions
  }

  async function publishLocked(body) {
    if (typeof body.requestId !== 'string' || !/^[A-Za-z0-9_-]{8,120}$/.test(body.requestId)) fail(400, 'INVALID_REQUEST_ID', '发布请求标识无效')
    const version = 'r_' + crypto.createHash('sha256').update(body.requestId).digest('hex').slice(0, 32)
    const existing = await store.getJson('releases/' + version + '.json')
    const live = await current()
    if (existing) {
      if (existing.requestId !== body.requestId || existing.revision !== body.revision) fail(409, 'MENU_REQUEST_CONFLICT', '发布标识已用于其他草稿')
      const history = await committedHistory()
      if (history.some((item) => item.version === version)) return { version }
      // 快照成功、指针失败可以重试；其间若有人发布了新版本，不允许倒退当前菜单。
      if ((live && live.version || '') !== existing.previousVersion) fail(409, 'MENU_PUBLICATION_CONFLICT', '已有更新版本发布，请重新预览后发布')
      checkRevision(body.revision, (await draft()).revision)
      await validateImages(normalize(existing.document))
      await store.putJson('current.json', { version })
      return { version }
    }
    const state = await draft()
    checkRevision(body.revision, state.revision)
    await validateImages(state.document)
    const snapshot = {
      version, revision: state.revision, requestId: body.requestId,
      publishedAt: now(), previousVersion: live && live.version || '',
      summary: { categories: state.document.categories.length, dishes: state.document.dishes.length, enabledDishes: state.document.dishes.filter((item) => item.enabled).length },
      document: trimAssets(state.document)
    }
    await store.putJson('releases/' + version + '.json', snapshot, true)
    await store.putJson('current.json', { version })
    return { version }
  }

  async function resolveAsset(assetId, admin) {
    if (!ASSET_ID.test(assetId) || ['__proto__', 'constructor', 'prototype'].includes(assetId)) fail(404, 'MENU_ASSET_NOT_FOUND', '菜单图片不存在')
    let asset
    const lookup = (document) => Object.prototype.hasOwnProperty.call(document.assets, assetId) ? document.assets[assetId] : null
    if (admin) {
      asset = lookup((await draft()).document)
      if (!asset) {
        for (const item of await committedHistory()) {
          if (lookup(item.document)) { asset = lookup(item.document); break }
        }
      }
    } else {
      const live = await current()
      asset = live && lookup(publicDocument(live.document))
    }
    if (!asset) fail(404, 'MENU_ASSET_NOT_FOUND', '菜单图片不存在')
    return {
      imageUrl: await repository.getDownloadUrl(asset.imageKey),
      thumbnailUrl: await repository.getDownloadUrl(asset.thumbnailKey),
      expiresAt: now() + (config.downloadUrlTtlSeconds || 300) * 1000
    }
  }

  async function uploadPolicy(body) {
    if (!TYPES[body.contentType] || !Number.isInteger(body.size) || body.size < 1 || body.size > maxImageBytes) fail(400, 'INVALID_MENU_IMAGE', '请选择 8MB 以内的 JPG、PNG 或 WebP 图片')
    return withLock(async () => {
      const assetId = 'asset_' + randomBytes(16)
      const imageKey = 'menu/images/' + assetId + '/original.' + TYPES[body.contentType]
      const pending = { assetId, imageKey, contentType: body.contentType, size: body.size, createdAt: now() }
      await store.putJson('system/uploads/' + assetId + '.json', pending, true)
      return Object.assign({ assetId }, await repository.getFormUpload(imageKey, body.contentType, body.size, config.uploadUrlTtlSeconds || 300, now()))
    })
  }

  async function imageReferences() {
    const referenced = new Set()
    const protect = (document) => {
      for (const asset of Object.values(normalize(document).assets)) {
        referenced.add(asset.imageKey); referenced.add(asset.thumbnailKey)
      }
    }
    protect((await draft()).document)
    // 当前指针和历史链缺失时停止，不能将损坏索引误判为空引用。
    await committedHistory()
    // 包括指针更新失败的快照；任何读取异常都不允许继续删除。
    for (const item of await store.listObjects('releases/')) {
      if (!/^releases\/r_[a-f0-9]{32}\.json$/.test(item.key)) throw new Error('菜单历史目录含未知文件，停止清理')
      const snapshot = await store.getJson(item.key)
      if (!snapshot) throw new Error('菜单历史扫描不完整')
      protect(snapshot.document)
    }
    return referenced
  }

  async function completeUpload(body) {
    if (!ASSET_ID.test(body.assetId || '')) fail(400, 'INVALID_ASSET_ID', '图片标识无效')
    return withLock(async () => {
      const pending = await store.getJson('system/uploads/' + body.assetId + '.json')
      if (!pending || pending.imageKey !== body.imageKey) fail(400, 'INVALID_UPLOAD', '上传记录不存在或不匹配，请重新选图')
      const thumbnailKey = 'menu/thumbnails/' + body.assetId + '/original.webp'
      const asset = { imageKey: body.imageKey, thumbnailKey }
      if (pending.completed) {
        await validateImages({ assets: { [body.assetId]: asset } })
        return Object.assign({ assetId: body.assetId }, asset)
      }
      const referenced = await imageReferences()
      if (referenced.has(asset.imageKey) || referenced.has(asset.thumbnailKey)) {
        // 中断后缩略图可能已被草稿或历史引用，只校验，不再处理或失败删除。
        await validateImages({ assets: { [body.assetId]: asset } })
        await store.putJson('system/uploads/' + body.assetId + '.json', Object.assign({}, pending, { completed: true }))
        return Object.assign({ assetId: body.assetId }, asset)
      }
      try {
        const source = await repository.getImageInfo(body.imageKey)
        if (source.contentType !== pending.contentType || source.size !== pending.size) fail(400, 'INVALID_MENU_IMAGE', '原图与上传声明不一致')
        await repository.createPersistentThumbnail(body.imageKey, thumbnailKey)
        await validateImages({ assets: { [body.assetId]: asset } })
        await store.putJson('system/uploads/' + body.assetId + '.json', Object.assign({}, pending, { completed: true }))
        return Object.assign({ assetId: body.assetId }, asset)
      } catch (error) {
        // 清理结束后才返回失败；不把原图冒充缩略图，残留由每日任务继续处理。
        for (const key of [thumbnailKey, body.imageKey]) await repository.deleteImage(key).catch((cleanupError) => logger.warn('菜单失败上传清理失败', { key, error: cleanupError }))
        await store.deleteObject('system/uploads/' + body.assetId + '.json').catch((cleanupError) => logger.warn('菜单失败上传记录清理失败', cleanupError))
        logger.error('菜单缩略图处理失败', error)
        fail(503, 'THUMBNAIL_PROCESSING_UNAVAILABLE', '图片处理失败，请重新选择图片后重试')
      }
    })
  }

  async function cleanup() {
    return withLock(async () => {
      const referenced = await imageReferences()
      const objects = (await store.listObjects('images/')).concat(await store.listObjects('thumbnails/'))
      const cutoff = now() - 24 * 60 * 60 * 1000
      const candidates = objects.filter((item) => item.lastModified > 0 && item.lastModified < cutoff && !referenced.has('menu/' + item.key)).slice(0, 200)
      let deleted = 0; let failed = 0
      for (const item of candidates) {
        try { await store.deleteObject(item.key); deleted++ } catch (error) { failed++; logger.warn('菜单孤儿图片删除失败', { key: item.key, error }) }
      }
      // 上传声明不参与历史备份，过期声明按相同安全期回收。
      for (const item of await store.listObjects('system/uploads/')) {
        if (item.lastModified > 0 && item.lastModified < cutoff) await store.deleteObject(item.key).catch((error) => logger.warn('菜单过期上传记录清理失败', error))
      }
      const result = { scanned: objects.length, candidates: candidates.length, deleted, failed }
      logger.info('菜单孤儿图片定时清理完成', result)
      return result
    })
  }

  async function initialize(document, prepareAssets = async () => {}) {
    const normalized = trimAssets(normalize(document))
    return withLock(async () => {
      if ((await store.listObjects('')).some((item) => item.key !== 'system/write.lock')) fail(409, 'MENU_NOT_EMPTY', '菜单命名空间非空，禁止覆盖初始化')
      await prepareAssets()
      await validateImages(normalized)
      await store.putJson('draft.json', { revision: 1, updatedAt: now(), document: normalized }, true)
      const result = await publishLocked({ revision: 1, requestId: 'initialize_' + randomBytes(16) })
      return Object.assign({ revision: 1 }, result)
    })
  }

  async function route({ method, path, query = {}, body = {}, requireUser }) {
    if (method === 'GET' && path === '/menu') {
      const live = await current()
      if (!live) fail(404, 'MENU_NOT_PUBLISHED', '菜单尚未发布')
      return query.version === live.version ? { version: live.version, unchanged: true } : { version: live.version, document: publicDocument(live.document) }
    }
    const publicAsset = path.match(/^\/menu\/assets\/([^/]+)$/)
    if (method === 'GET' && publicAsset) return resolveAsset(publicAsset[1], false)
    if (!path.startsWith('/menu/admin/')) fail(404, 'NOT_FOUND', '接口不存在')
    requireUser()
    if (!body || typeof body !== 'object' || Array.isArray(body)) fail(400, 'INVALID_JSON', '请求内容必须为 JSON 对象')
    if (method === 'GET' && path === '/menu/admin/access') return { allowed: true }
    if (method === 'GET' && ['/menu/admin/draft', '/menu/admin/preview'].includes(path)) return draft()
    if (method === 'PUT' && path === '/menu/admin/draft') return save(body)
    if (method === 'POST' && path === '/menu/admin/publish') return withLock(() => publishLocked(body))
    if (method === 'GET' && path === '/menu/admin/history') {
      const history = await committedHistory()
      const index = query.cursor ? history.findIndex((item) => item.version === query.cursor) : -1
      if (query.cursor && index < 0) fail(400, 'INVALID_CURSOR', '历史分页游标无效')
      const page = history.slice(index + 1, index + 21)
      return { items: page.map(({ version, publishedAt, summary }) => ({ version, publishedAt, summary })), nextCursor: index + 21 < history.length && page.length ? page[page.length - 1].version : '' }
    }
    const historic = path.match(/^\/menu\/admin\/history\/([^/]+)$/)
    if (method === 'GET' && historic) {
      const item = (await committedHistory()).find((entry) => entry.version === historic[1])
      if (!item) fail(404, 'MENU_VERSION_NOT_FOUND', '菜单历史版本不存在')
      return item
    }
    if (method === 'POST' && path === '/menu/admin/restore') return withLock(async () => {
      const state = await draft()
      checkRevision(body.revision, state.revision)
      const historicRelease = (await committedHistory()).find((item) => item.version === body.version)
      if (!historicRelease) fail(404, 'MENU_VERSION_NOT_FOUND', '菜单历史版本不存在')
      const next = { revision: state.revision + 1, updatedAt: now(), document: historicRelease.document }
      await validateImages(next.document)
      await store.putJson('draft.json', next)
      return next
    })
    const adminAsset = path.match(/^\/menu\/admin\/assets\/([^/]+)$/)
    if (method === 'GET' && adminAsset) return resolveAsset(adminAsset[1], true)
    if (method === 'POST' && path === '/menu/admin/uploads/form-policy') return uploadPolicy(body)
    if (method === 'POST' && path === '/menu/admin/uploads/complete') return completeUpload(body)
    fail(404, 'NOT_FOUND', '接口不存在')
  }

  return { route, cleanup, initialize }
}

module.exports = { createMenuService }
