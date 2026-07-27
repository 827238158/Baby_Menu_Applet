'use strict'

function callCos(cos, method, params) {
  return new Promise((resolve, reject) => {
    cos[method](params, (error, data) => {
      if (error) {
        reject(error)
        return
      }

      resolve(data || {})
    })
  })
}

function isNotFound(error) {
  return error && (
    error.statusCode === 404 ||
    error.code === 'NoSuchKey' ||
    error.error && error.error.Code === 'NoSuchKey'
  )
}

function createCosRepository({ cos, bucket, region, prefix, downloadUrlTtlSeconds }) {
  const giftPrefix = prefix + '/gifts/'
  const imagePrefix = prefix + '/images/'

  function giftKey(id) {
    return giftPrefix + id + '.json'
  }

  async function listObjectKeys() {
    const keys = []
    let marker = ''

    do {
      const result = await callCos(cos, 'getBucket', {
        Bucket: bucket,
        Region: region,
        Prefix: giftPrefix,
        Marker: marker,
        MaxKeys: 1000
      })

      for (const item of result.Contents || []) {
        if (item.Key && item.Key.endsWith('.json')) {
          keys.push(item.Key)
        }
      }

      const truncated = result.IsTruncated === true || result.IsTruncated === 'true'
      marker = truncated ? String(result.NextMarker || '') : ''
    } while (marker)

    return keys
  }

  async function readJson(key) {
    const result = await callCos(cos, 'getObject', {
      Bucket: bucket,
      Region: region,
      Key: key
    })
    const body = Buffer.isBuffer(result.Body)
      ? result.Body.toString('utf8')
      : String(result.Body || '')

    return JSON.parse(body)
  }

  async function getGift(id) {
    try {
      return await readJson(giftKey(id))
    } catch (error) {
      if (isNotFound(error)) {
        return null
      }
      throw error
    }
  }

  async function listGifts() {
    const keys = await listObjectKeys()
    return Promise.all(keys.map(readJson))
  }

  async function putGift(gift) {
    await callCos(cos, 'putObject', {
      Bucket: bucket,
      Region: region,
      Key: giftKey(gift.id),
      Body: JSON.stringify(gift),
      ContentType: 'application/json; charset=utf-8'
    })
  }

  async function deleteGift(id) {
    await callCos(cos, 'deleteObject', {
      Bucket: bucket,
      Region: region,
      Key: giftKey(id)
    })
  }

  async function deleteImage(key) {
    await callCos(cos, 'deleteObject', {
      Bucket: bucket,
      Region: region,
      Key: key
    })
  }

  async function getImageInfo(key) {
    const result = await callCos(cos, 'headObject', {
      Bucket: bucket,
      Region: region,
      Key: key
    })

    return {
      size: Number(result.headers && result.headers['content-length']) || 0,
      contentType: String(result.headers && result.headers['content-type'] || '').toLowerCase()
    }
  }

  function getSignedUrl(key, method, expires) {
    return new Promise((resolve, reject) => {
      cos.getObjectUrl({
        Bucket: bucket,
        Region: region,
        Key: key,
        Method: method,
        Protocol: 'https:',
        Sign: true,
        Expires: expires
      }, (error, data) => {
        if (error) {
          reject(error)
          return
        }

        resolve(data.Url)
      })
    })
  }

  function getDownloadUrl(key) {
    return getSignedUrl(key, 'GET', downloadUrlTtlSeconds)
  }

  function getUploadUrl(key, expires) {
    return getSignedUrl(key, 'PUT', expires)
  }

  function isImageKeyForGift(key, id) {
    return typeof key === 'string' &&
      key.startsWith(imagePrefix + id + '/') &&
      !key.includes('..')
  }

  function isImageKey(key) {
    return typeof key === 'string' &&
      key.startsWith(imagePrefix) &&
      !key.includes('..')
  }

  return {
    deleteGift,
    deleteImage,
    getDownloadUrl,
    getGift,
    getImageInfo,
    getUploadUrl,
    isImageKey,
    isImageKeyForGift,
    listGifts,
    putGift
  }
}

module.exports = {
  createCosRepository
}
