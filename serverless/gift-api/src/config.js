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
    maxImageBytes: 8 * 1024 * 1024
  }
}

module.exports = {
  loadConfig,
  normalizePrefix
}
