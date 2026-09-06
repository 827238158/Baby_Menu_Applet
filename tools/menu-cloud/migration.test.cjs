'use strict'

const test = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const os = require('node:os')
const path = require('node:path')
const { buildMigration, credentials, verifyVersioning, resolveImage, execute } = require('./migrate.cjs')

function fixture(t) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'menu-migration-'))
  t.after(() => fs.rmSync(root, { recursive: true, force: true }))
  fs.mkdirSync(path.join(root, 'tools/menu-workbook/assets/foods'), { recursive: true })
  fs.mkdirSync(path.join(root, 'tools/menu-workbook/generated'), { recursive: true })
  fs.writeFileSync(path.join(root, 'tools/menu-workbook/assets/foods/test.jpg'), Buffer.from([255, 216, 255, 217]))
  const data = {
    shop: { name: '测试', subtitle: '', shareTitle: '', shareImage: '../assets/foods/test.jpg', pageBackgroundImage: '', headerBackgroundImage: '', headerBackgroundPosition: 'center' },
    categories: [{ id: 'Come Wonka', name: '分类', order: 1 }],
    dishes: [{ id: 'Come Wonka01', categoryId: 'Come Wonka', name: '菜', desc: '', order: 1, price: '0', image: '../assets/foods/test.jpg', tags: ['标签'], options: [{ id: '糖度', name: '糖度', required: true, choices: ['少糖'] }] }]
  }
  return { root, data }
}

test('迁移保持含空格 ID、规格、排序，并对店铺与菜品重复图片去重', (t) => {
  const { root, data } = fixture(t)
  const { document, uploads } = buildMigration(data, structuredClone(data), root)
  assert.equal(uploads.length, 1)
  assert.equal(document.dishes[0].id, data.dishes[0].id)
  assert.deepEqual(document.dishes[0].options, data.dishes[0].options)
  assert.equal(document.dishes[0].imageAssetId, document.shop.shareImage)
  assert.equal(document.dishes[0].enabled, true)
  assert.equal(document.assets[document.shop.shareImage].thumbnailKey.endsWith('/original.webp'), true)
})

test('Excel 与 JS 不同、非零价格、越界图片及伪造图片阻止迁移', (t) => {
  const { root, data } = fixture(t)
  assert.throws(() => buildMigration(data, {}, root), /不一致/)
  data.dishes[0].price = '1'
  assert.throws(() => buildMigration(data, structuredClone(data), root), /价格/)
  assert.throws(() => resolveImage(root, 'C:/outside.jpg'), /assets/)
  fs.writeFileSync(path.join(root, 'tools/menu-workbook/assets/foods/test.jpg'), 'not an image')
  assert.throws(() => resolveImage(root, '../assets/foods/test.jpg'), /文件头/)
})

test('占位图不上传，不生成失效资产引用', (t) => {
  const { root, data } = fixture(t)
  data.shop.shareImage = ''
  data.dishes[0].image = '../assets/placeholder-food.jpg'
  const result = buildMigration(data, structuredClone(data), root)
  assert.equal(result.uploads.length, 0)
  assert.equal(result.document.dishes[0].imageAssetId, '')
})

test('缺少临时 Token 即拒绝凭据，不打印密钥', () => {
  assert.throws(() => credentials({ TENCENTCLOUD_SECRETID: 'id', TENCENTCLOUD_SECRETKEY: 'private-value' }), /SESSIONTOKEN/)
})

test('版本控制核验失败或启用时拒绝，暂停和未开启通过', async () => {
  for (const Status of ['', 'Suspended']) await verifyVersioning({ getBucketVersioning: (_, cb) => cb(null, { Status }) }, 'bucket', 'region')
  await assert.rejects(verifyVersioning({ getBucketVersioning: (_, cb) => cb(null, { Status: 'Enabled' }) }, 'bucket', 'region'), /版本控制/)
  await assert.rejects(verifyVersioning({ getBucketVersioning: (_, cb) => cb(new Error('denied')) }, 'bucket', 'region'), /denied/)
})

// 使用真实菜单服务与仓储，只模拟 SDK 边界，覆盖锁、发布快照和命名空间隔离。
function fakeCos(initial = {}) {
  const objects = new Map(Object.entries(initial))
  const calls = []
  function record(method, args, cb, action) {
    calls.push({ method, key: args.Key, prefix: args.Prefix })
    try { cb(null, action()) } catch (error) { cb(error) }
  }
  const cos = {
    getBucketVersioning: (_, cb) => cb(null, { Status: 'Suspended' }),
    getBucket: (args, cb) => record('getBucket', args, cb, () => ({ Contents: [...objects.keys()].filter((key) => key.startsWith(args.Prefix)).map((Key) => ({ Key })) })),
    getObject: (args, cb) => record('getObject', args, cb, () => {
      if (!objects.has(args.Key)) throw Object.assign(new Error('missing'), { statusCode: 404 })
      return { Body: objects.get(args.Key).Body }
    }),
    putObject: (args, cb) => record('putObject', args, cb, () => {
      if (objects.has(args.Key) && args.Headers['x-cos-forbid-overwrite'] === 'true') throw Object.assign(new Error('exists'), { statusCode: 409 })
      objects.set(args.Key, { Body: args.Body, ContentType: args.ContentType })
      return {}
    }),
    deleteObject: (args, cb) => record('deleteObject', args, cb, () => { objects.delete(args.Key); return {} }),
    headObject: (args, cb) => record('headObject', args, cb, () => {
      const object = objects.get(args.Key)
      if (!object) throw Object.assign(new Error('missing'), { statusCode: 404 })
      return { headers: { 'content-length': object.Body.length, 'content-type': object.ContentType } }
    }),
    request: (args, cb) => record('request', args, cb, () => {
      const key = JSON.parse(args.Headers['Pic-Operations']).rules[0].fileid.slice(1)
      objects.set(key, { Body: Buffer.from('webp'), ContentType: 'image/webp' })
      return {}
    })
  }
  return { cos, objects, calls }
}
const temporaryEnv = { TENCENTCLOUD_SECRETID: 'test-temporary-id', TENCENTCLOUD_SECRETKEY: 'test-secret', TENCENTCLOUD_SESSIONTOKEN: 'test-token', COS_BUCKET: 'test-bucket', COS_REGION: 'test-region' }

test('执行初次发布保持 ID 与图片，释放字符串 owner 锁，第二次执行不覆盖', async (t) => {
  const { root, data } = fixture(t)
  const migration = buildMigration(data, structuredClone(data), root)
  const { cos, objects, calls } = fakeCos({ 'gift-folder/index.json': { Body: 'untouched' } })
  const result = await execute(migration, temporaryEnv, cos)
  assert.match(result.version, /^r_[a-f0-9]{32}$/)
  assert.equal(objects.has('menu/system/write.lock'), false)
  const snapshot = JSON.parse(objects.get('menu/releases/' + result.version + '.json').Body)
  assert.equal(snapshot.document.dishes[0].id, data.dishes[0].id)
  assert.equal(snapshot.document.dishes[0].imageAssetId, migration.document.dishes[0].imageAssetId)
  const before = [...objects.entries()]
  await assert.rejects(execute(migration, temporaryEnv, cos), (error) => error.code === 'MENU_NOT_EMPTY')
  assert.deepEqual([...objects.entries()], before)
  assert.equal(calls.some((call) => (call.key || call.prefix || '').startsWith('gift-folder/')), false)
})

test('残留图片或未完成初始化也阻止再次写入，并释放锁', async (t) => {
  const { root, data } = fixture(t)
  const migration = buildMigration(data, structuredClone(data), root)
  const { cos, objects, calls } = fakeCos({ 'menu/images/previous.jpg': { Body: 'old' } })
  await assert.rejects(execute(migration, temporaryEnv, cos), (error) => error.code === 'MENU_NOT_EMPTY')
  assert.deepEqual([...objects.keys()], ['menu/images/previous.jpg'])
  assert.equal(calls.some((call) => call.method === 'request'), false)
})

test('初始化缩略图失败不会创建草稿或当前指针，不自动删除残留上传', async (t) => {
  const { root, data } = fixture(t)
  const migration = buildMigration(data, structuredClone(data), root)
  const { cos, objects } = fakeCos()
  cos.request = (_, cb) => cb(new Error('processing unavailable'))
  await assert.rejects(execute(migration, temporaryEnv, cos), /processing unavailable/)
  assert.equal(objects.has('menu/current.json'), false)
  assert.equal(objects.has('menu/draft.json'), false)
  assert.equal(objects.has('menu/system/write.lock'), false)
  assert.equal(objects.has(migration.uploads[0].imageKey), true)
})
