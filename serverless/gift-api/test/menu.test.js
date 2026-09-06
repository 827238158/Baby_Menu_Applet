'use strict'

const test = require('node:test')
const assert = require('node:assert/strict')
const { createMenuService } = require('../src/menu/service')
const { createMenuRepository } = require('../src/menu/repository')
const { emptyDocument, createDocumentTools } = require('../src/menu/document')
const { createApp } = require('../src/app')
const { createTokenService } = require('../src/token-service')

class HttpError extends Error {
  constructor(statusCode, code, message) { super(message); this.statusCode = statusCode; this.code = code }
}
const clone = (value) => value == null ? value : JSON.parse(JSON.stringify(value))
const assetId = 'asset_12345678'
const imageKey = 'menu/images/' + assetId + '/original.jpg'
const thumbnailKey = 'menu/thumbnails/' + assetId + '/original.webp'
function document(withImage = false) {
  const value = emptyDocument()
  value.categories = [{ id: 'fruit', name: '水果', order: 1 }]
  value.dishes = [{ id: 'apple', categoryId: 'fruit', name: '苹果', desc: '', price: '0', order: 1, enabled: true, tags: [], options: [], imageAssetId: withImage ? assetId : '' }]
  if (withImage) value.assets[assetId] = { imageKey, thumbnailKey }
  return value
}
function fixture() {
  const objects = new Map()
  const images = new Map()
  const deleted = []
  let counter = 0
  const config = { allowedOpenIds: new Set(['one', 'two']), cleanupTimerName: 'GiftImageCleanupDaily' }
  const repository = {
    menu: createMenuRepository({
      readJsonOrNull: async (key) => clone(objects.get(key)?.value),
      putJson: async (key, value, headers) => {
        if (repository.failPointer && key === 'menu/current.json') throw new Error('pointer failed')
        if (headers['x-cos-forbid-overwrite'] && objects.has(key)) throw Object.assign(new Error('exists'), { statusCode: 409 })
        objects.set(key, { value: clone(value), lastModified: 100 })
      },
      listObjects: async (prefix) => {
        if (repository.failList === prefix) throw new Error('scan failed')
        return [...objects].filter(([key]) => key.startsWith(prefix)).map(([key, data]) => ({ key, lastModified: data.lastModified }))
      },
      deleteObject: async (key) => { deleted.push(key); objects.delete(key); images.delete(key) },
      isAlreadyExists: (error) => error.statusCode === 409
    }),
    getImageInfo: async (key) => {
      if (!images.has(key)) throw Object.assign(new Error('missing image'), { statusCode: 404 })
      return images.get(key)
    },
    isNotFoundError: (error) => error.statusCode === 404,
    getDownloadUrl: async (key) => 'https://cos.example/' + key,
    getFormUpload: async (key) => ({ imageKey: key, uploadUrl: 'https://cos.example', formData: { key } }),
    createPersistentThumbnail: async (source, key) => {
      if (repository.failThumbnail) throw new Error('CI unavailable')
      images.set(key, { contentType: 'image/webp', size: 10 })
    },
    deleteImage: async (key) => { deleted.push(key); images.delete(key) },
    isImageKeyForGift: () => false
  }
  const now = () => 200000000
  const logger = { error() {}, warn() {}, info() {} }
  const service = createMenuService({ repository, config, HttpError, now, randomBytes: () => (++counter).toString(16).padStart(32, '0'), logger })
  const call = (method, path, body = {}, query = {}) => service.route({ method, path, body, query, requireUser() {} })
  const save = (value, revision = 0) => call('PUT', '/menu/admin/draft', { document: value, revision })
  const publish = (revision, requestId = 'publish_0001') => call('POST', '/menu/admin/publish', { revision, requestId })
  const addImage = (key, recent = false) => {
    images.set(key, { size: 10, contentType: key.endsWith('.webp') ? 'image/webp' : 'image/jpeg' })
    objects.set(key, { lastModified: recent ? now() : 100 })
  }
  return { objects, images, deleted, repository, config, service, call, save, publish, addImage, now, logger }
}

test('菜单匿名公开，全部管理路由逐次校验现有两人白名单', async () => {
  const f = fixture()
  await f.save(document()); await f.publish(1)
  const tokens = createTokenService({ secret: 'test-secret', ttlSeconds: 300, now: f.now })
  const app = createApp({ config: f.config, repository: f.repository, tokenService: tokens, wechatAuth: {}, now: f.now, logger: f.logger })
  const request = (path, user) => app({ httpMethod: 'GET', path, headers: user ? { authorization: 'Bearer ' + tokens.issue(user).token } : {} })
  assert.equal((await request('/menu')).statusCode, 200)
  assert.equal((await request('/gifts')).statusCode, 401)
  for (const path of ['/menu/admin/access', '/menu/admin/draft', '/menu/admin/history', '/menu/admin/preview']) {
    assert.equal((await request(path)).statusCode, 401)
    assert.equal((await request(path, 'third')).statusCode, 403)
    for (const user of ['one', 'two']) assert.equal((await request(path, user)).statusCode, 200)
  }
  const token = tokens.issue('one').token
  f.config.allowedOpenIds.delete('one')
  assert.equal((await app({ httpMethod: 'GET', path: '/menu/admin/draft', headers: { authorization: 'Bearer ' + token } })).statusCode, 403)
})

test('草稿与下架图片不公开，空菜单不回退', async () => {
  const f = fixture(); f.addImage(imageKey); f.addImage(thumbnailKey)
  await f.save(document(true)); await f.publish(1)
  const next = document(true); next.dishes[0].enabled = false
  await f.save(next, 1)
  assert.equal((await f.call('GET', '/menu')).document.dishes.length, 1)
  await f.publish(2, 'publish_0002')
  assert.equal((await f.call('GET', '/menu')).document.dishes.length, 0)
  for (const id of ['__proto__', 'constructor', 'prototype', 'toString', 'gift_12345678']) await assert.rejects(f.call('GET', '/menu/assets/' + id), { code: 'MENU_ASSET_NOT_FOUND' })
  await assert.rejects(f.call('GET', '/menu/assets/' + assetId), { code: 'MENU_ASSET_NOT_FOUND' })
  assert.ok((await f.call('GET', '/menu/admin/assets/' + assetId)).imageUrl)
  await f.save(emptyDocument(), 2); const live = await f.publish(3, 'publish_0003')
  assert.deepEqual((await f.call('GET', '/menu')).document.categories, [])
  assert.equal((await f.call('GET', '/menu', {}, { version: live.version })).unchanged, true)
})

test('并发草稿只允许一个保存，拒绝过期修订号及遗留锁', async () => {
  const f = fixture()
  const attempts = await Promise.allSettled([f.save(document()), f.save(document())])
  assert.equal(attempts.filter((item) => item.status === 'fulfilled').length, 1)
  await assert.rejects(f.save(document()), { code: 'MENU_REVISION_CONFLICT' })
  f.objects.set('menu/system/write.lock', { value: { owner: 'abandoned', createdAt: 1 } })
  await assert.rejects(f.save(document(), 1), { code: 'MENU_BUSY' })
})

test('发布幂等且失败指针重试安全，较新发布不被旧请求覆盖', async () => {
  const f = fixture(); await f.save(document())
  f.repository.failPointer = true
  await assert.rejects(f.publish(1), /pointer failed/)
  assert.equal(f.objects.has('menu/current.json'), false)
  f.repository.failPointer = false
  const first = await f.publish(1)
  assert.deepEqual(await f.publish(1), first)
  await f.save(document(), 1)
  f.repository.failPointer = true
  await assert.rejects(f.publish(2, 'pending_0002'), /pointer failed/)
  f.repository.failPointer = false
  const latest = await f.publish(2, 'publish_0002')
  await assert.rejects(f.publish(2, 'pending_0002'), { code: 'MENU_PUBLICATION_CONFLICT' })
  assert.deepEqual(await f.publish(1), first)
  assert.equal((await f.call('GET', '/menu')).version, latest.version)
})

test('恢复历史仅修改草稿，发布生成新快照并保留历史', async () => {
  const f = fixture(); await f.save(document()); const first = await f.publish(1)
  const next = document(); next.dishes[0].name = '梨'
  await f.save(next, 1); const second = await f.publish(2, 'publish_0002')
  const restored = await f.call('POST', '/menu/admin/restore', { revision: 2, version: first.version })
  assert.equal(restored.document.dishes[0].name, '苹果')
  assert.equal((await f.call('GET', '/menu')).version, second.version)
  await f.publish(3, 'publish_0003')
  assert.equal((await f.call('GET', '/menu/admin/history')).items.length, 3)
})

test('上传只签名菜单新 Key，完成处理可重试，数据万象失败清理后返回', async () => {
  const f = fixture()
  const policy = await f.call('POST', '/menu/admin/uploads/form-policy', { contentType: 'image/jpeg', size: 10 })
  assert.match(policy.imageKey, /^menu\/images\//)
  f.images.set(policy.imageKey, { contentType: 'image/jpeg', size: 10 })
  const complete = () => f.call('POST', '/menu/admin/uploads/complete', policy)
  const asset = await complete(); assert.deepEqual(await complete(), asset)
  const bad = await f.call('POST', '/menu/admin/uploads/form-policy', { contentType: 'image/jpeg', size: 10 })
  f.images.set(bad.imageKey, { contentType: 'image/jpeg', size: 10 }); f.repository.failThumbnail = true
  await assert.rejects(f.call('POST', '/menu/admin/uploads/complete', bad), { code: 'THUMBNAIL_PROCESSING_UNAVAILABLE' })
  assert.equal(f.images.has(bad.imageKey), false)
  assert.ok(f.deleted.includes(bad.imageKey))
})

test('清理保护全部历史、草稿与24小时内图片，只删菜单旧孤儿', async () => {
  const f = fixture(); f.addImage(imageKey); f.addImage(thumbnailKey)
  await f.save(document(true)); await f.publish(1)
  await f.save(emptyDocument(), 1); await f.publish(2, 'publish_0002')
  f.addImage('menu/images/orphan/old.jpg'); f.addImage('menu/images/recent/new.jpg', true)
  f.addImage('gift-folder/images/old.jpg')
  const result = await f.service.cleanup()
  assert.equal(result.deleted, 1)
  assert.ok(f.images.has(imageKey)); assert.ok(f.images.has(thumbnailKey))
  assert.ok(f.images.has('menu/images/recent/new.jpg')); assert.ok(f.images.has('gift-folder/images/old.jpg'))
})

test('历史读取、列表或当前链损坏时清理 fail closed', async () => {
  for (const kind of ['list', 'snapshot', 'chain']) {
    const f = fixture(); await f.save(document()); const published = await f.publish(1)
    f.addImage('menu/images/orphan/old.jpg')
    if (kind === 'list') f.repository.failList = 'menu/releases/'
    if (kind === 'snapshot') f.objects.get('menu/releases/' + published.version + '.json').value.document = null
    if (kind === 'chain') f.objects.delete('menu/releases/' + published.version + '.json')
    await assert.rejects(f.service.cleanup())
    assert.ok(f.images.has('menu/images/orphan/old.jpg'))
  }
})

test('图片校验失败不能改草稿或当前发布，允许稳定选项 ID 与文字规格', async () => {
  const f = fixture()
  const value = document()
  value.dishes[0].options = [{ id: 'size', name: '份量', required: true, choices: [{ id: 'large', name: '大份' }] }, { id: 'note', name: '备注', type: 'text', required: false, maxlength: 40, placeholder: '口味' }]
  assert.deepEqual((await f.save(value)).document.dishes[0].options, value.dishes[0].options)
  const published = await f.publish(1)
  await assert.rejects(f.save(document(true), 1), { code: 'MENU_IMAGE_NOT_FOUND' })
  assert.equal((await f.call('GET', '/menu')).version, published.version)
  const normalize = createDocumentTools(HttpError).normalize
  const invalid = document(); invalid.dishes[0].price = '1'
  assert.throws(() => normalize(invalid), { code: 'INVALID_MENU' })
  invalid.dishes[0].price = '0'; invalid.assets = JSON.parse('{"__proto__":{}}')
  assert.throws(() => normalize(invalid), { code: 'INVALID_MENU' })
})

test('初始化仅接受空命名空间，并在同一锁内准备图片', async () => {
  const f = fixture(); let locked = false
  await f.service.initialize(document(), async () => { locked = f.objects.has('menu/system/write.lock') })
  assert.equal(locked, true)
  await assert.rejects(f.service.initialize(document()), { code: 'MENU_NOT_EMPTY' })
})

test('菜单请求使用1MiB上限，心愿夹仍为8KiB', async () => {
  const f = fixture()
  const tokens = createTokenService({ secret: 'test-secret', ttlSeconds: 300, now: f.now })
  const app = createApp({ config: f.config, repository: f.repository, tokenService: tokens, wechatAuth: {}, now: f.now, logger: f.logger })
  const request = (path, body) => app({ httpMethod: 'PUT', path, body, headers: { authorization: 'Bearer ' + tokens.issue('one').token } })
  const value = document(); value.dishes[0].desc = '中'.repeat(2900)
  assert.equal((await request('/menu/admin/draft', { revision: 0, document: value })).statusCode, 200)
  assert.equal((await request('/menu/admin/draft', ' '.repeat(1024 * 1024 + 1))).statusCode, 413)
  assert.equal((await request('/gifts/gift_12345678', { name: 'x'.repeat(9000) })).statusCode, 413)
})

test('历史分页无重复，旧游标在新发布后仍从指定版本继续', async () => {
  const f = fixture(); await f.save(document())
  for (let index = 0; index < 23; index++) await f.publish(1, 'history_' + String(index).padStart(4, '0'))
  const first = await f.call('GET', '/menu/admin/history')
  assert.equal(first.items.length, 20); assert.ok(first.nextCursor)
  await f.publish(1, 'history_0023')
  const second = await f.call('GET', '/menu/admin/history', {}, { cursor: first.nextCursor })
  assert.equal(second.items.length, 3); assert.equal(second.nextCursor, '')
  assert.equal(new Set(first.items.concat(second.items).map((item) => item.version)).size, 23)
})

test('发布前图片丢失时保留旧指针，并且并发HEAD全部结束后才释放锁', async () => {
  const f = fixture(); await f.save(document()); const live = await f.publish(1)
  f.addImage(imageKey); f.addImage(thumbnailKey)
  await f.save(document(true), 1)
  const readInfo = f.repository.getImageInfo
  let completed = false
  f.repository.getImageInfo = async (key) => {
    if (key === imageKey) throw Object.assign(new Error('missing'), { statusCode: 404 })
    await new Promise((resolve) => setTimeout(resolve, 5))
    assert.ok(f.objects.has('menu/system/write.lock'))
    completed = true
    return readInfo(key)
  }
  await assert.rejects(f.publish(2, 'publish_0002'), { code: 'MENU_IMAGE_NOT_FOUND' })
  assert.equal(completed, true)
  assert.equal((await f.call('GET', '/menu')).version, live.version)
})

test('上传完成标记中断后的重试不得重处理或删除历史引用图片', async () => {
  const f = fixture()
  const policy = await f.call('POST', '/menu/admin/uploads/form-policy', { contentType: 'image/jpeg', size: 10 })
  const thumb = policy.imageKey.replace('/images/', '/thumbnails/').replace('.jpg', '.webp')
  f.addImage(policy.imageKey); f.addImage(thumb)
  const value = document()
  value.dishes[0].imageAssetId = policy.assetId
  value.assets[policy.assetId] = { imageKey: policy.imageKey, thumbnailKey: thumb }
  await f.save(value); await f.publish(1)
  await f.save(emptyDocument(), 1); await f.publish(2, 'publish_0002')
  f.repository.failThumbnail = true
  await f.call('POST', '/menu/admin/uploads/complete', policy)
  assert.ok(f.images.has(policy.imageKey)); assert.ok(f.images.has(thumb))
  assert.equal(f.deleted.includes(policy.imageKey), false)
})
