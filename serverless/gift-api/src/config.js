'use strict'

function requireValue(env, name) {
  const value = String(env[name] || '').trim()

  if (!value) {
    throw new Error('缺少环境变量：' + name)
  }

  return value
}

function normalizePrefix(value) {
  return String(value || 'gift-folder')
    .trim()
    .replace(/^\/+|\/+$/g, '') || 'gift-folder'
}

function parseOptionalTime(value) {
  const text = String(value || '').trim()
  if (!text) return 0

  const numeric = Number(text)
  if (Number.isFinite(numeric) && numeric > 0) {
    return numeric
  }

  const timestamp = Date.parse(text)
  return Number.isFinite(timestamp) ? timestamp : 0
}

function loadConfig(env = process.env) {
  const sessionSecret = requireValue(env, 'SESSION_SECRET')

  if (sessionSecret.length < 32) {
    throw new Error('SESSION_SECRET 至少需要 32 个字符')
  }

  return {
    wxAppId: requireValue(env, 'WX_APP_ID'),
    wxAppSecret: requireValue(env, 'WX_APP_SECRET'),
    allowedOpenIds: new Set(
      String(env.ALLOWED_OPENIDS || '')
        .split(',')
        .map((item) => item.trim())
        .filter(Boolean)
    ),
    sessionSecret,
    cosBucket: requireValue(env, 'COS_BUCKET'),
    cosRegion: requireValue(env, 'COS_REGION'),
    cosPrefix: normalizePrefix(env.COS_PREFIX),
    openIdDiscovery: String(env.OPENID_DISCOVERY || '').toLowerCase() === 'true',
    sessionTtlSeconds: 7 * 24 * 60 * 60,
    uploadUrlTtlSeconds: 5 * 60,
    downloadUrlTtlSeconds: 60 * 60,
    maxImageBytes: 8 * 1024 * 1024,
    maxJsonBodyBytes: 8 * 1024,
    loginRateLimitWindowMs: 60 * 1000,
    loginRateLimitMax: 10,
    mutationLockLeaseMs: 30 * 1000,
    mutationLockWaitMs: 2 * 1000,
    orphanGraceMs: 24 * 60 * 60 * 1000,
    orphanCleanupBatchSize: 200,
    cleanupTimerName: 'GiftImageCleanupDaily',
    legacyPutUploadUntil: parseOptionalTime(env.LEGACY_PUT_UPLOAD_UNTIL)
  }
}

module.exports = {
  loadConfig,
  normalizePrefix,
  parseOptionalTime
}
