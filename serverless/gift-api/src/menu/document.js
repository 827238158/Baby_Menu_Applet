'use strict'

const SHOP_IMAGES = ['shareImage', 'pageBackgroundImage', 'headerBackgroundImage']
const ASSET_ID = /^[A-Za-z0-9_-]{8,80}$/
const has = (object, key) => Object.prototype.hasOwnProperty.call(object, key)

function createDocumentTools(HttpError) {
  function invalid(message) { throw new HttpError(400, 'INVALID_MENU', message) }
  function text(value, limit, name, required = false) {
    if (typeof value !== 'string' || value.length > limit || /[\u0000-\u0008\u000b\u000c\u000e-\u001f]/.test(value)) invalid(name + '格式无效')
    if (required && !value.trim()) invalid(name + '不能为空')
    return value
  }
  function id(value, name) {
    text(value, 100, name, true)
    if (['__proto__', 'constructor', 'prototype'].includes(value)) invalid(name + '无效')
    return value
  }
  function order(value) {
    if (!Number.isFinite(value) || Math.abs(value) > 1000000) invalid('排序值无效')
    return value
  }
  function array(value, limit, name) {
    if (!Array.isArray(value) || value.length > limit) invalid(name + '数量或格式无效')
    return value
  }
  function object(value, name) {
    if (!value || typeof value !== 'object' || Array.isArray(value)) invalid(name + '格式无效')
  }
  function unique(values, name) {
    if (new Set(values).size !== values.length) invalid(name + '不能重复')
  }
  function normalize(document) {
    object(document, '菜单')
    if (document.schemaVersion !== 1) invalid('菜单版本不受支持')
    object(document.shop, '店铺资料')
    const shop = {}
    for (const field of ['name', 'subtitle', 'shareTitle', 'headerBackgroundPosition'].concat(SHOP_IMAGES)) {
      shop[field] = text(document.shop[field] === undefined ? '' : document.shop[field], 200, '店铺字段')
    }
    // WXSS 插值只允许标准背景位置，避免把任意样式注入页面。
    if (shop.headerBackgroundPosition && !/^(?:(?:left|right|top|bottom|center|-?\d+(?:\.\d+)?(?:%|px))\s*){1,4}$/.test(shop.headerBackgroundPosition)) invalid('头图位置无效')
    const categories = array(document.categories, 100, '分类').map((item) => {
      object(item, '分类')
      return { id: id(item.id, '分类 ID'), name: text(item.name, 80, '分类名称', true), order: order(item.order) }
    })
    unique(categories.map((item) => item.id), '分类 ID')
    const categoryIds = new Set(categories.map((item) => item.id))
    const dishes = array(document.dishes, 2000, '菜品').map((item) => {
      object(item, '菜品')
      if (!categoryIds.has(item.categoryId)) invalid('菜品分类不存在')
      if (item.price !== '0') invalid('菜品价格必须为字符串 0')
      if (typeof item.enabled !== 'boolean') invalid('上下架状态无效')
      const options = array(item.options, 20, '规格').map((option) => {
        object(option, '规格')
        if (typeof option.required !== 'boolean') invalid('规格必选状态无效')
        const base = { id: id(option.id, '规格 ID'), name: text(option.name, 80, '规格名称', true), required: option.required }
        if (option.type === 'text') {
          if (!Number.isInteger(option.maxlength) || option.maxlength < 1 || option.maxlength > 500) invalid('备注字数限制无效')
          return Object.assign(base, { type: 'text', maxlength: option.maxlength, placeholder: text(option.placeholder || '', 200, '备注提示') })
        }
        if (option.type && !['select', 'choice'].includes(option.type)) invalid('规格类型无效')
        // 老菜单字符串选项继续兼容，新编辑器使用稳定选项 ID。
        const choices = array(option.choices, 50, '规格选项').map((choice) => {
          if (typeof choice === 'string') return text(choice, 80, '规格选项', true)
          object(choice, '规格选项')
          return { id: id(choice.id, '选项 ID'), name: text(choice.name, 80, '规格选项', true) }
        })
        if (!choices.length) invalid('规格至少包含一个选项')
        unique(choices.map((choice) => typeof choice === 'string' ? choice : choice.id), '规格选项')
        return Object.assign(base, { choices })
      })
      unique(options.map((option) => option.id), '规格 ID')
      return {
        id: id(item.id, '菜品 ID'), categoryId: item.categoryId,
        name: text(item.name, 100, '菜品名称', true), desc: text(item.desc, 3000, '菜品简介'),
        price: '0', order: order(item.order), enabled: item.enabled,
        tags: array(item.tags, 30, '标签').map((tag) => text(tag, 80, '标签', true)),
        options, imageAssetId: text(item.imageAssetId || '', 80, '菜品图片')
      }
    })
    unique(dishes.map((item) => item.id), '菜品 ID')
    object(document.assets, '图片集合')
    if (Object.keys(document.assets).length > 5000) invalid('图片数量过多')
    const assets = {}
    for (const [assetId, asset] of Object.entries(document.assets)) {
      if (!ASSET_ID.test(assetId) || ['__proto__', 'constructor', 'prototype'].includes(assetId)) invalid('图片 ID 无效')
      object(asset, '图片')
      const imageKey = text(asset.imageKey, 250, '原图路径', true)
      const thumbnailKey = text(asset.thumbnailKey, 250, '缩略图路径', true)
      const filename = imageKey.slice(('menu/images/' + assetId + '/').length)
      if (!imageKey.startsWith('menu/images/' + assetId + '/') || !/^[A-Za-z0-9_-]+\.(jpg|png|webp)$/.test(filename)) invalid('原图路径无效')
      if (thumbnailKey !== 'menu/thumbnails/' + assetId + '/' + filename.replace(/\.[^.]+$/, '.webp')) invalid('缩略图路径无效')
      assets[assetId] = { imageKey, thumbnailKey }
    }
    const normalized = { schemaVersion: 1, shop, categories, dishes, assets }
    for (const assetId of referencedIds(normalized)) {
      if (!has(assets, assetId)) invalid('引用的图片不存在')
    }
    return normalized
  }
  return { normalize }
}

function referencedIds(document) {
  return new Set(SHOP_IMAGES.map((field) => document.shop[field]).concat(document.dishes.map((item) => item.imageAssetId)).filter(Boolean))
}

function trimAssets(document) {
  const assets = {}
  for (const assetId of referencedIds(document)) assets[assetId] = document.assets[assetId]
  return Object.assign({}, document, { assets })
}

function publicDocument(document) {
  return trimAssets(Object.assign({}, document, { dishes: document.dishes.filter((item) => item.enabled) }))
}

function emptyDocument() {
  return { schemaVersion: 1, shop: { name: '', subtitle: '', shareTitle: '', shareImage: '', pageBackgroundImage: '', headerBackgroundImage: '', headerBackgroundPosition: 'center 60%' }, categories: [], dishes: [], assets: {} }
}

module.exports = { ASSET_ID, SHOP_IMAGES, createDocumentTools, emptyDocument, referencedIds, trimAssets, publicDocument }
