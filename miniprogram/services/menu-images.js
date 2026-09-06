const defaultApi = require('./menu-api')

function createMenuImages(wxApi, api = defaultApi) {
  const cache = new Map()
  const pending = new Map()
  const local = new Map()
  const downloads = new Map()
  async function validPath(key) {
    const path = local.get(key)
    if (!path) return ''
    if (!wxApi.getFileSystemManager) { local.delete(key); return '' }
    const valid = await new Promise((done) => {
      try { wxApi.getFileSystemManager().access({ path, success: () => done(true), fail: () => done(false) }) }
      catch (error) { done(false) }
    })
    if (!valid) local.delete(key)
    return valid ? path : ''
  }
  async function resolve(id, privateAccess = false, force = false) {
    const key = (privateAccess ? 'private:' : 'public:') + id
    const previous = cache.get(key)
    if (!force && previous && previous.expiresAt > Date.now() + 60000) return previous
    if (pending.has(key)) return pending.get(key)
    const request = api.resolveAsset(id, privateAccess).then((asset) => {
      const result = Object.assign({}, asset, { expiresAt: Number(asset.expiresAt) || Date.now() + 300000 })
      cache.set(key, result)
      return result
    }).finally(() => pending.delete(key))
    pending.set(key, request)
    return request
  }
  async function display(id, privateAccess = false, download = false, force = false) {
    const key = (privateAccess ? 'private:' : 'public:') + id
    if (force) local.delete(key)
    const path = !force && await validPath(key)
    if (path) return path
    if (downloads.has(key)) return downloads.get(key)
    if (download) {
      const request = downloadAsset(id, privateAccess, key).finally(() => downloads.delete(key))
      downloads.set(key, request)
      return request
    }
    const asset = await resolve(id, privateAccess)
    // 解析期间若下载已成功，不能再用网络地址覆盖本地图片。
    return local.get(key) || asset.thumbnailUrl || asset.imageUrl
  }
  async function downloadAsset(id, privateAccess, key) {
    const asset = await resolve(id, privateAccess, true)
    const url = asset.thumbnailUrl || asset.imageUrl
    // COS 默认域名无法内联展示时，下载到临时路径；不永久保存私有图片。
    return new Promise((resolvePath, reject) => wxApi.downloadFile({
      url, success(result) {
        if (result.statusCode === 200 && result.tempFilePath) { local.set(key, result.tempFilePath); resolvePath(result.tempFilePath) }
        else reject(new Error('图片下载失败'))
      }, fail: reject
    }))
  }
  return { display, resolve }
}

module.exports = { createMenuImages }
