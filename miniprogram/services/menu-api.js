const config = require('../config/gift-cloud')
const { createCloudClient, createApiError } = require('./cloud-client')
const { validateDocument } = require('./menu-document')

function createMenuApi(wxApi, cloudConfig = config) {
  const client = createCloudClient(wxApi, cloudConfig)
  const admin = (path, method = 'GET', data) => client.authorizedRequest({
    path: '/menu/admin/' + path, method, data,
    // 写入可能等待云端图片校验或处理，不沿用普通读取的短超时。
    timeout: method === 'GET' ? 10000 : 60000
  })
  return {
    access: () => admin('access'),
    getDraft: () => admin('draft'),
    saveDraft: (revision, document) => {
      validateDocument(document)
      const text = JSON.stringify({ revision, document })
      const bytes = encodeURIComponent(text).replace(/%[A-F\d]{2}/gi, 'x').length
      if (bytes > 1024 * 1024) throw createApiError('MENU_TOO_LARGE', '菜单资料超过 1 MiB，请精简内容')
      return admin('draft', 'PUT', { revision, document })
    },
    getPreview: () => admin('preview'),
    publish: (revision, requestId) => admin('publish', 'POST', { revision, requestId }),
    getHistory: (cursor = '') => admin('history' + (cursor ? '?cursor=' + encodeURIComponent(cursor) : '')),
    getRelease: (version) => admin('history/' + encodeURIComponent(version)),
    restore: (revision, version) => admin('restore', 'POST', { revision, version }),
    getMenu: (version = '') => client.rawRequest({ path: '/menu' + (version ? '?version=' + encodeURIComponent(version) : '') }),
    resolveAsset: (id, privateAccess = false) => privateAccess
      ? admin('assets/' + encodeURIComponent(id))
      : client.rawRequest({ path: '/menu/assets/' + encodeURIComponent(id) }),
    async uploadImage(filePath) {
      const file = await new Promise((resolve, reject) => wxApi.getFileSystemManager().getFileInfo({ filePath, success: resolve, fail: reject }))
      const info = await new Promise((resolve, reject) => wxApi.getImageInfo({ src: filePath, success: resolve, fail: reject }))
      const contentType = { jpg: 'image/jpeg', jpeg: 'image/jpeg', png: 'image/png', webp: 'image/webp' }[info.type]
      if (!contentType || !file.size || file.size > 8 * 1024 * 1024) throw createApiError('INVALID_IMAGE', '请选择不超过 8MB 的 JPEG、PNG 或 WebP 图片')
      const upload = await admin('uploads/form-policy', 'POST', { contentType, size: file.size })
      await new Promise((resolve, reject) => wxApi.uploadFile({
        url: upload.uploadUrl, filePath, name: 'file', formData: upload.formData, timeout: 30000,
        success: (result) => result.statusCode >= 200 && result.statusCode < 300 ? resolve() : reject(createApiError('UPLOAD_FAILED', '图片上传失败，请重试')),
        fail: () => reject(createApiError('UPLOAD_FAILED', '图片上传失败，请重试'))
      }))
      // 未完成处理的图片不能进入草稿，失败上传由云端安全期清理。
      return admin('uploads/complete', 'POST', { assetId: upload.assetId, imageKey: upload.imageKey })
    }
  }
}

const api = createMenuApi(typeof wx === 'undefined' ? null : wx)
api.createMenuApi = createMenuApi
module.exports = api
