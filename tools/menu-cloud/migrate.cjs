'use strict'

const fs = require('node:fs')
const path = require('node:path')
const crypto = require('node:crypto')
const { spawnSync } = require('node:child_process')
const { isDeepStrictEqual } = require('node:util')
const ROOT = path.resolve(__dirname, '../..')
const MAX_IMAGE_BYTES = 8 * 1024 * 1024
const PLACEHOLDER_IMAGE = '../assets/placeholder-food.jpg'

function readGenerated(root = ROOT) {
  // 生成文件只允许 JSON 数据，避免为迁移执行任意 JS。
  function read(name) {
    const text = fs.readFileSync(path.join(root, 'tools/menu-workbook/generated', name + '-data.js'), 'utf8')
    const body = text.replace(/^\uFEFF/, '').replace(/^\/\/[^\n]*\n/, '').trim()
    if (!body.startsWith('export default ')) throw new Error('无法识别生成文件：' + name)
    return JSON.parse(body.slice('export default '.length).replace(/;\s*$/, ''))
  }
  return { shop: read('shop'), categories: read('category'), dishes: read('dish') }
}

function readWorkbook(python = process.env.MENU_PYTHON || 'D:/Anaconda/python.exe') {
  const result = spawnSync(python, ['-X', 'utf8', '-B', path.join(__dirname, 'workbook-snapshot.py')], {
    encoding: 'utf8', windowsHide: true, maxBuffer: 4 * 1024 * 1024
  })
  if (result.error || result.status !== 0) throw new Error('Excel 只读检查失败：' + (result.error ? result.error.message : result.stderr.trim()))
  return JSON.parse(result.stdout.replace(/^\uFEFF/, ''))
}

function resolveImage(root, relative) {
  if (typeof relative !== 'string' || !relative.startsWith('../assets/')) throw new Error('图片必须位于迁移 assets：' + relative)
  const assetRoot = fs.realpathSync(path.join(root, 'tools/menu-workbook/assets'))
  const file = fs.realpathSync(path.resolve(root, 'tools/menu-workbook/generated', relative))
  const within = path.relative(assetRoot, file)
  if (!within || within.startsWith('..') || path.isAbsolute(within)) throw new Error('图片越出 assets 目录')
  const body = fs.readFileSync(file)
  if (!body.length || body.length > MAX_IMAGE_BYTES) throw new Error('图片大小须为 1 字节至 8 MiB：' + file)
  const ext = path.extname(file).toLowerCase().replace('.jpeg', '.jpg')
  const valid = ext === '.jpg' ? body[0] === 0xff && body[1] === 0xd8 && body[2] === 0xff
    : ext === '.png' ? body.subarray(0, 8).equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]))
      : ext === '.webp' && body.toString('ascii', 0, 4) === 'RIFF' && body.toString('ascii', 8, 12) === 'WEBP'
  if (!valid) throw new Error('图片格式或文件头无效，仅支持 JPEG/PNG/WebP：' + file)
  return { file, body, ext, contentType: ext === '.jpg' ? 'image/jpeg' : 'image/' + ext.slice(1) }
}

function buildMigration(generated, workbook, root = ROOT) {
  if (!isDeepStrictEqual(generated, workbook)) throw new Error('Excel 与生成 JS 内容不一致；请先核对差异，工具不会覆盖本地数据')
  const document = { schemaVersion: 1, shop: { ...generated.shop }, categories: generated.categories, dishes: [], assets: {} }
  const uploads = new Map()
  function addImage(relative) {
    if (!relative || relative === PLACEHOLDER_IMAGE) return ''
    const image = resolveImage(root, relative)
    const id = 'asset_' + crypto.createHash('sha256').update(image.body).digest('hex').slice(0, 32)
    if (!uploads.has(id)) {
      const asset = { imageKey: 'menu/images/' + id + '/original' + image.ext, thumbnailKey: 'menu/thumbnails/' + id + '/original.webp' }
      uploads.set(id, { ...image, ...asset })
      document.assets[id] = asset
    }
    return id
  }
  for (const field of ['shareImage', 'pageBackgroundImage', 'headerBackgroundImage']) document.shop[field] = addImage(document.shop[field])
  for (const dish of generated.dishes) {
    if (dish.price !== '0') throw new Error('菜品价格必须为字符串 0：' + dish.id)
    const { image, ...data } = dish
    document.dishes.push({ ...data, enabled: true, imageAssetId: addImage(image) })
  }
  if (Buffer.byteLength(JSON.stringify(document), 'utf8') > 1024 * 1024) throw new Error('菜单超出 1 MiB 限制')
  return { document, uploads: Array.from(uploads.values()) }
}

function credentials(env = process.env) {
  for (const name of ['TENCENTCLOUD_SECRETID', 'TENCENTCLOUD_SECRETKEY', 'TENCENTCLOUD_SESSIONTOKEN', 'COS_BUCKET', 'COS_REGION']) {
    if (!String(env[name] || '').trim()) throw new Error('执行需提供临时凭据及桶配置，缺少：' + name)
  }
  return { secretId: env.TENCENTCLOUD_SECRETID, secretKey: env.TENCENTCLOUD_SECRETKEY, securityToken: env.TENCENTCLOUD_SESSIONTOKEN, bucket: env.COS_BUCKET, region: env.COS_REGION }
}

function call(cos, method, params) {
  return new Promise((resolve, reject) => cos[method](params, (error, value) => error ? reject(error) : resolve(value || {})))
}

async function verifyVersioning(cos, bucket, region) {
  const result = await call(cos, 'getBucketVersioning', { Bucket: bucket, Region: region })
  if (result.Status && result.Status !== 'Suspended') throw new Error('COS 版本控制必须未开启或已暂停；工具不会修改桶设置')
}

async function execute(migration, env = process.env, injectedCos) {
  const options = credentials(env)
  const COS = require(path.join(ROOT, 'serverless/gift-api/node_modules/cos-nodejs-sdk-v5'))
  const cos = injectedCos || new COS({ SecretId: options.secretId, SecretKey: options.secretKey, SecurityToken: options.securityToken })
  await verifyVersioning(cos, options.bucket, options.region)
  const { createCosRepository } = require('../../serverless/gift-api/src/cos-repository')
  const { createMenuService } = require('../../serverless/gift-api/src/menu/service')
  const repository = createCosRepository({ ...options, cos, prefix: 'gift-folder', downloadUrlTtlSeconds: 300 })
  class MigrationError extends Error {
    constructor(statusCode, code, message) { super(message); this.statusCode = statusCode; this.code = code }
  }
  // 服务的随机值契约是字符串，不能传 Buffer，否则持久化后无法正确释放写锁。
  const service = createMenuService({ repository, config: { maxImageBytes: MAX_IMAGE_BYTES, downloadUrlTtlSeconds: 300, orphanGraceMs: 86400000 }, HttpError: MigrationError, now: Date.now, randomBytes: (size) => crypto.randomBytes(size).toString('hex'), logger: console })
  return service.initialize(migration.document, async () => {
    // 初始化在菜单服务的独立写锁内进行；服务先确认整个 menu/ 为空。
    for (const image of migration.uploads) {
      await call(cos, 'putObject', { Bucket: options.bucket, Region: options.region, Key: image.imageKey, Body: image.body, ContentType: image.contentType, Headers: { 'x-cos-forbid-overwrite': 'true' } })
      await repository.createPersistentThumbnail(image.imageKey, image.thumbnailKey)
    }
  })
}

async function main(args = process.argv.slice(2)) {
  if (args.length > 1 || args.some((arg) => !['--check', '--execute'].includes(arg))) throw new Error('用法：node tools/menu-cloud/migrate.cjs --check 或 --execute')
  const migration = buildMigration(readGenerated(), readWorkbook())
  const { createDocumentTools } = require('../../serverless/gift-api/src/menu/document')
  class ValidationError extends Error { constructor(status, code, message) { super(message) } }
  createDocumentTools(ValidationError).normalize(migration.document)
  console.log('只读检查通过：' + migration.document.categories.length + ' 个分类，' + migration.document.dishes.length + ' 个菜品，' + migration.uploads.length + ' 张独立图片；Excel 与 JS 一致')
  if (args[0] === '--execute') {
    console.log('开始初始化空 menu/：上传原图和缩略图，并创建首个发布版本；不会操作 gift-folder/')
    const result = await execute(migration)
    console.log('初始化完成：' + JSON.stringify(result))
  }
}

module.exports = { readGenerated, readWorkbook, resolveImage, buildMigration, credentials, verifyVersioning, execute, main }
if (require.main === module) main().catch((error) => { console.error(error.message); process.exitCode = 1 })
