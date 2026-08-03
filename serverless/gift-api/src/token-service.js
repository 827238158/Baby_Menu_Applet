'use strict'

const crypto = require('node:crypto')

function encode(value) {
  return Buffer.from(value).toString('base64url')
}

function sign(value, secret) {
  return crypto.createHmac('sha256', secret).update(value).digest('base64url')
}

function createTokenService({ secret, ttlSeconds, now = () => Date.now() }) {
  function issue(openId) {
    const issuedAt = Math.floor(now() / 1000)
    const payload = {
      sub: openId,
      iat: issuedAt,
      exp: issuedAt + ttlSeconds
    }
    const encodedPayload = encode(JSON.stringify(payload))
    const signature = sign(encodedPayload, secret)

    return {
      token: encodedPayload + '.' + signature,
      expiresAt: payload.exp * 1000
    }
  }

  function verify(token) {
    const parts = String(token || '').split('.')

    if (parts.length !== 2) {
      return null
    }

    const expected = sign(parts[0], secret)
    const actualBuffer = Buffer.from(parts[1])
    const expectedBuffer = Buffer.from(expected)

    if (
      actualBuffer.length !== expectedBuffer.length ||
      !crypto.timingSafeEqual(actualBuffer, expectedBuffer)
    ) {
      return null
    }

    try {
      const payload = JSON.parse(Buffer.from(parts[0], 'base64url').toString('utf8'))
      const nowSeconds = Math.floor(now() / 1000)

      if (!payload.sub || !payload.exp || payload.exp <= nowSeconds) {
        return null
      }

      return payload
    } catch (error) {
      return null
    }
  }

  return {
    issue,
    verify
  }
}

module.exports = {
  createTokenService
}
