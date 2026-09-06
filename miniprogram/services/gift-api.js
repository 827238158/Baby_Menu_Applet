const giftCloudConfig = require('../config/gift-cloud.js')

const { createCloudClient, createApiError, SESSION_STORAGE_KEY } = require('./cloud-client')
const IMAGE_CONTENT_TYPES = {
  jpeg: 'image/jpeg',
  jpg: 'image/jpeg',
  png: 'image/png',
  webp: 'image/webp'
}

function createGiftApi(wxApi, config = giftCloudConfig) {
  const { authorizedRequest, clearSession, isConfigured } = createCloudClient(wxApi, config)

  function getFileInfo(filePath) {
    const fileSystem = wxApi.getFileSystemManager()

    return Promise.all([
      new Promise((resolve, reject) => {
        fileSystem.getFileInfo({
          filePath,
          success: resolve,
          fail: () => reject(createApiError('IMAGE_READ_FAILED', '图片读取失败'))
        })
      }),
      new Promise((resolve, reject) => {
        wxApi.getImageInfo({
          src: filePath,
          success: resolve,
          fail: () => reject(createApiError('IMAGE_READ_FAILED', '图片格式识别失败'))
        })
      })
    ]).then(([file, image]) => {
      const contentType = IMAGE_CONTENT_TYPES[String(image.type || '').toLowerCase()]

      if (!contentType) {
        throw createApiError('INVALID_IMAGE_TYPE', '仅支持 JPEG、PNG 或 WebP 图片')
      }

      return {
        size: Number(file.size) || 0,
        contentType
      }
    })
  }

  function postImage(upload, filePath) {
    return new Promise((resolve, reject) => {
      wxApi.uploadFile({
        url: upload.uploadUrl,
        filePath,
        name: 'file',
        formData: upload.formData,
        timeout: 30000,
        success(result) {
          if (result.statusCode >= 200 && result.statusCode < 300) {
            resolve()
            return
          }
          reject(createApiError('IMAGE_UPLOAD_FAILED', '图片上传失败'))
        },
        fail() {
          reject(createApiError('IMAGE_UPLOAD_FAILED', '图片上传失败'))
        }
      })
    })
  }

  async function uploadImage(filePath, itemId, asset = 'image', collection = 'gift') {
    const file = await getFileInfo(filePath)

    if (!file.size || file.size > 8 * 1024 * 1024) {
      throw createApiError('IMAGE_TOO_LARGE', '图片大小不能超过 8MB')
    }

    const isDecor = collection === 'decor'
    const upload = await authorizedRequest({
      path: isDecor
        ? '/collections/decor/uploads/form-policy'
        : '/uploads/form-policy',
      method: 'POST',
      data: Object.assign({
        contentType: file.contentType,
        size: file.size,
        asset
      }, isDecor ? { itemId } : { giftId: itemId })
    })
    await postImage(upload, filePath)
    return upload.imageKey
  }

  return {
    clearSession,
    isConfigured,
    listGifts(cursor = '', limit = 20) {
      const query = '?limit=' + encodeURIComponent(limit) +
        (cursor ? '&cursor=' + encodeURIComponent(cursor) : '')
      return authorizedRequest({ path: '/gifts' + query })
    },
    createGift(gift) {
      return authorizedRequest({
        path: '/gifts',
        method: 'POST',
        data: gift
      })
    },
    updateGift(gift) {
      return authorizedRequest({
        path: '/gifts/' + encodeURIComponent(gift.id),
        method: 'PUT',
        data: gift
      })
    },
    deleteGift(id) {
      return authorizedRequest({
        path: '/gifts/' + encodeURIComponent(id),
        method: 'DELETE'
      })
    },
    getGiftImage(id) {
      return authorizedRequest({ path: '/gifts/' + encodeURIComponent(id) + '/image' })
    },
    listDecorItems(cursor = '', limit = 20) {
      const query = '?limit=' + encodeURIComponent(limit) +
        (cursor ? '&cursor=' + encodeURIComponent(cursor) : '')
      return authorizedRequest({ path: '/collections/decor/items' + query })
    },
    createDecorItem(item) {
      return authorizedRequest({
        path: '/collections/decor/items',
        method: 'POST',
        data: item
      })
    },
    updateDecorItem(item) {
      return authorizedRequest({
        path: '/collections/decor/items/' + encodeURIComponent(item.id),
        method: 'PUT',
        data: item
      })
    },
    deleteDecorItem(id) {
      return authorizedRequest({
        path: '/collections/decor/items/' + encodeURIComponent(id),
        method: 'DELETE'
      })
    },
    getDecorImage(id) {
      return authorizedRequest({
        path: '/collections/decor/items/' + encodeURIComponent(id) + '/image'
      })
    },
    moveCollectionItem(id, targetCollection) {
      return authorizedRequest({
        path: '/collections/items/' + encodeURIComponent(id) + '/move',
        method: 'POST',
        data: { targetCollection }
      })
    },
    deleteOrphan(imageKey) {
      return authorizedRequest({
        path: '/uploads/orphan',
        method: 'DELETE',
        data: { imageKey }
      })
    },
    uploadImage,
    async uploadImages(originalPath, itemId, collection = 'gift') {
      const imageKey = await uploadImage(originalPath, itemId, 'image', collection)
      try {
        // 原图只上传一次，缩略图由 SCF 调用数据万象持久化生成。
        const generated = await authorizedRequest({
          path: collection === 'decor'
            ? '/collections/decor/uploads/thumbnail'
            : '/uploads/thumbnail',
          method: 'POST',
          data: Object.assign(
            { imageKey },
            collection === 'decor' ? { itemId } : { giftId: itemId }
          )
        })
        const thumbnailKey = generated && typeof generated.thumbnailKey === 'string'
          ? generated.thumbnailKey.trim()
          : ''
        if (!thumbnailKey) {
          throw createApiError(
            'THUMBNAIL_PROCESSING_INVALID_RESPONSE',
            '缩略图生成结果无效'
          )
        }
        return { imageKey, thumbnailKey }
      } catch (error) {
        // 等待孤儿原图清理结束，避免页面退出时后台请求被直接中断。
        await authorizedRequest({
          path: collection === 'decor'
            ? '/collections/decor/uploads/orphan'
            : '/uploads/orphan',
          method: 'DELETE',
          data: { imageKey }
        }).catch(() => {})
        throw error
      }
    },
    deleteCollectionOrphan(imageKey, collection = 'gift') {
      return authorizedRequest({
        path: collection === 'decor'
          ? '/collections/decor/uploads/orphan'
          : '/uploads/orphan',
        method: 'DELETE',
        data: { imageKey }
      })
    }
  }
}

const defaultWx = typeof wx === 'undefined' ? null : wx
const giftApi = createGiftApi(defaultWx)

giftApi.createGiftApi = createGiftApi
giftApi.SESSION_STORAGE_KEY = SESSION_STORAGE_KEY

module.exports = giftApi
