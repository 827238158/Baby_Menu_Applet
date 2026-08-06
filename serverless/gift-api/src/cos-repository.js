'use strict'

const crypto = require('node:crypto')

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
  return Boolean(error && (
    error.statusCode === 404 ||
    error.code === 'NoSuchKey' ||
    error.error && error.error.Code === 'NoSuchKey'
  ))
}

function isAlreadyExists(error) {
  return Boolean(error && (
    error.statusCode === 409 ||
    error.code === 'FileAlreadyExists' ||
    error.error && error.error.Code === 'FileAlreadyExists'
  ))
}

function createCosRepository({
  cos,
  bucket,
  region,
  prefix,
  downloadUrlTtlSeconds,
  secretId,
  secretKey,
  securityToken
}) {
  const giftPrefix = prefix + '/gifts/'
  const imagePrefix = prefix + '/images/'
  const thumbnailPrefix = prefix + '/thumbnails/'
  const systemPrefix = prefix + '/system/'
  const indexKey = prefix + '/index.json'
  const mutationLockKey = systemPrefix + 'index.lock'
  const decorPrefix = prefix + '/decor/'
  const decorImagePrefix = decorPrefix + 'images/'
  const decorThumbnailPrefix = decorPrefix + 'thumbnails/'
  const decorIndexKey = decorPrefix + 'index.json'
  const decorMutationLockKey = decorPrefix + 'system/index.lock'

  function giftKey(id) {
    return giftPrefix + id + '.json'
  }

  async function listObjects(objectPrefix) {
    const objects = []
    let marker = ''

    do {
      const result = await callCos(cos, 'getBucket', {
        Bucket: bucket,
        Region: region,
        Prefix: objectPrefix,
        Marker: marker,
        MaxKeys: 1000
      })

      for (const item of result.Contents || []) {
        if (item.Key) {
          objects.push({
            key: item.Key,
            lastModified: Date.parse(item.LastModified || '') || 0,
            size: Number(item.Size) || 0
          })
        }
      }

      const truncated = result.IsTruncated === true || result.IsTruncated === 'true'
      marker = truncated ? String(result.NextMarker || '') : ''
    } while (marker)

    return objects
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

  async function readJsonOrNull(key) {
    try {
      return await readJson(key)
    } catch (error) {
      if (isNotFound(error)) {
        return null
      }
      throw error
    }
  }

  async function getIndex() {
    return readJsonOrNull(indexKey)
  }

  async function listLegacyGifts() {
    const objects = await listObjects(giftPrefix)
    const keys = objects
      .map((item) => item.key)
      .filter((key) => key.endsWith('.json'))

    return Promise.all(keys.map(readJson))
  }

  async function putJson(key, value, headers = {}) {
    return callCos(cos, 'putObject', {
      Bucket: bucket,
      Region: region,
      Key: key,
      Body: JSON.stringify(value),
      ContentType: 'application/json; charset=utf-8',
      Headers: headers
    })
  }

  async function putIndex(index) {
    await putJson(indexKey, index)
  }

  async function getDecorIndex() {
    return readJsonOrNull(decorIndexKey)
  }

  async function putDecorIndex(index) {
    await putJson(decorIndexKey, index)
  }

  async function deleteObject(key) {
    await callCos(cos, 'deleteObject', {
      Bucket: bucket,
      Region: region,
      Key: key
    })
  }

  async function deleteImage(key) {
    await deleteObject(key)
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

  function getFormUpload(key, contentType, size, expires, currentTime) {
    if (!secretId || !secretKey) {
      throw new Error('COS POST Object 签名凭据不可用')
    }

    const startSeconds = Math.floor(currentTime / 1000)
    const endSeconds = startSeconds + expires
    const keyTime = startSeconds + ';' + endSeconds
    const conditions = [
      { bucket },
      ['eq', '$key', key],
      ['eq', '$Content-Type', contentType],
      ['eq', '$success_action_status', '204'],
      ['eq', '$x-cos-forbid-overwrite', 'true'],
      { 'q-sign-algorithm': 'sha1' },
      { 'q-ak': secretId },
      { 'q-sign-time': keyTime },
      ['content-length-range', size, size]
    ]
    if (securityToken) {
      // SCF 临时密钥必须随表单传递，并一并纳入策略精确约束。
      conditions.push(['eq', '$x-cos-security-token', securityToken])
    }
    const policyObject = {
      expiration: new Date(endSeconds * 1000).toISOString(),
      conditions
    }
    const policyText = JSON.stringify(policyObject)
    const signKey = crypto.createHmac('sha1', secretKey).update(keyTime).digest('hex')
    const stringToSign = crypto.createHash('sha1').update(policyText).digest('hex')
    const signature = crypto.createHmac('sha1', signKey).update(stringToSign).digest('hex')
    const formData = {
      key,
      'Content-Type': contentType,
      success_action_status: '204',
      'x-cos-forbid-overwrite': 'true',
      policy: Buffer.from(policyText, 'utf8').toString('base64'),
      'q-sign-algorithm': 'sha1',
      'q-ak': secretId,
      'q-key-time': keyTime,
      'q-signature': signature
    }

    if (securityToken) {
      formData['x-cos-security-token'] = securityToken
    }

    return {
      imageKey: key,
      uploadUrl: 'https://' + bucket + '.cos.' + region + '.myqcloud.com/',
      formData,
      expiresAt: endSeconds * 1000
    }
  }

  async function tryAcquireMutationLock(lock) {
    try {
      await putJson(mutationLockKey, lock, {
        'x-cos-forbid-overwrite': 'true'
      })
      return true
    } catch (error) {
      if (isAlreadyExists(error)) {
        return false
      }
      throw error
    }
  }

  async function getMutationLock() {
    return readJsonOrNull(mutationLockKey)
  }

  async function releaseMutationLock(owner) {
    const stored = await getMutationLock()

    if (!stored || stored.owner !== owner) {
      return false
    }

    await deleteObject(mutationLockKey)
    return true
  }

  async function tryAcquireDecorMutationLock(lock) {
    try {
      await putJson(decorMutationLockKey, lock, {
        'x-cos-forbid-overwrite': 'true'
      })
      return true
    } catch (error) {
      if (isAlreadyExists(error)) {
        return false
      }
      throw error
    }
  }

  async function getDecorMutationLock() {
    return readJsonOrNull(decorMutationLockKey)
  }

  async function releaseDecorMutationLock(owner) {
    const stored = await getDecorMutationLock()

    if (!stored || stored.owner !== owner) {
      return false
    }

    await deleteObject(decorMutationLockKey)
    return true
  }

  function isImageKeyForGift(key, id) {
    return typeof key === 'string' &&
      (key.startsWith(imagePrefix + id + '/') || key.startsWith(thumbnailPrefix + id + '/')) &&
      !key.includes('..')
  }

  function isImageKey(key) {
    return typeof key === 'string' &&
      (key.startsWith(imagePrefix) || key.startsWith(thumbnailPrefix)) &&
      !key.includes('..')
  }

  function isDecorImageKeyForItem(key, id) {
    return typeof key === 'string' &&
      (key.startsWith(decorImagePrefix + id + '/') || key.startsWith(decorThumbnailPrefix + id + '/')) &&
      !key.includes('..')
  }

  function isDecorImageKey(key) {
    return typeof key === 'string' &&
      (key.startsWith(decorImagePrefix) || key.startsWith(decorThumbnailPrefix)) &&
      !key.includes('..')
  }

  function isCollectionImageKeyForItem(key, id) {
    return isImageKeyForGift(key, id) || isDecorImageKeyForItem(key, id)
  }

  async function listImageObjects() {
    const [images, thumbnails] = await Promise.all([
      listObjects(imagePrefix),
      listObjects(thumbnailPrefix)
    ])

    return images.concat(thumbnails)
  }

  async function listDecorImageObjects() {
    const [images, thumbnails] = await Promise.all([
      listObjects(decorImagePrefix),
      listObjects(decorThumbnailPrefix)
    ])

    return images.concat(thumbnails)
  }

  return {
    deleteImage,
    getDownloadUrl,
    getDecorIndex,
    getDecorMutationLock,
    getFormUpload,
    getIndex,
    getImageInfo,
    getMutationLock,
    getUploadUrl,
    isImageKey,
    isImageKeyForGift,
    isCollectionImageKeyForItem,
    isDecorImageKey,
    isDecorImageKeyForItem,
    isNotFoundError: isNotFound,
    listImageObjects,
    listDecorImageObjects,
    listLegacyGifts,
    putIndex,
    putDecorIndex,
    releaseDecorMutationLock,
    releaseMutationLock,
    tryAcquireMutationLock,
    tryAcquireDecorMutationLock
  }
}

module.exports = {
  createCosRepository,
  isAlreadyExists,
  isNotFound
}
