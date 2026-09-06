'use strict'

// 菜单仓储只接受相对路径，底层 COS 能力与心愿夹共享，数据严格隔离。
function createMenuRepository({ readJsonOrNull, putJson, listObjects, deleteObject, isAlreadyExists }) {
  function key(path) {
    if (typeof path !== 'string' || path.startsWith('/') || path.includes('..') || path.includes('\\')) throw new Error('非法菜单对象路径')
    return 'menu/' + path
  }
  return {
    getJson: (path) => readJsonOrNull(key(path)),
    putJson: (path, value, immutable = false) => putJson(key(path), value, immutable ? { 'x-cos-forbid-overwrite': 'true' } : {}),
    listObjects: async (prefix) => (await listObjects(key(prefix))).map((item) => Object.assign({}, item, { key: item.key.slice(5) })),
    deleteObject: (path) => deleteObject(key(path)),
    async tryLock(lock) {
      try {
        await putJson(key('system/write.lock'), lock, { 'x-cos-forbid-overwrite': 'true' })
        return true
      } catch (error) {
        if (isAlreadyExists(error)) return false
        throw error
      }
    },
    async releaseLock(owner) {
      const lock = await readJsonOrNull(key('system/write.lock'))
      if (!lock || lock.owner !== owner) return false
      await deleteObject(key('system/write.lock'))
      return true
    }
  }
}

module.exports = { createMenuRepository }
