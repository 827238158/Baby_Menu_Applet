'use strict'

const test = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const vm = require('node:vm')
const { createRequire } = require('node:module')
const root = path.resolve(__dirname, '../miniprogram')

function loadDefinition(relative) {
  let page
  const filename = path.join(root, relative + '.js')
  const sandbox = { require: createRequire(filename), Page: (value) => { page = value }, wx: {} }
  vm.runInNewContext(fs.readFileSync(filename, 'utf8'), sandbox, { filename })
  return page
}

test('菜单三页已注册且资源完整，预览引用唯一公开模板和样式', () => {
  const manifest = JSON.parse(fs.readFileSync(path.join(root, 'app.json'), 'utf8'))
  for (const route of ['pages/menu/menu', 'pages/menu-admin/menu-admin', 'pages/menu-preview/menu-preview']) {
    assert.ok(manifest.pages.includes(route))
    for (const ext of ['.js', '.json', '.wxml', '.wxss']) assert.ok(fs.existsSync(path.join(root, route + ext)))
    JSON.parse(fs.readFileSync(path.join(root, route + '.json'), 'utf8'))
  }
  assert.match(fs.readFileSync(path.join(root, 'pages/menu-preview/menu-preview.wxml'), 'utf8'), /include src="\.\.\/menu\/menu.wxml"/)
  assert.match(fs.readFileSync(path.join(root, 'pages/menu-preview/menu-preview.wxss'), 'utf8'), /@import "\.\.\/menu\/menu.wxss"/)
})

test('菜单与管理 WXML 标签平衡，所有事件都存在对应实现', () => {
  for (const route of ['pages/menu/menu', 'pages/menu-admin/menu-admin']) {
    const definition = loadDefinition(route)
    const source = fs.readFileSync(path.join(root, route + '.wxml'), 'utf8').replace(/<!--[\s\S]*?-->/g, '')
    const stack = []
    const tags = source.match(/<\/?[a-z][\w-]*(?:[^<>"']|"[^"]*"|'[^']*')*>/g) || []
    for (const tag of tags) {
      const name = tag.match(/^<\/?([\w-]+)/)[1]
      if (tag.startsWith('</')) assert.equal(stack.pop(), name, route + ' 标签未配对')
      else if (!tag.endsWith('/>')) stack.push(name)
      for (const match of tag.matchAll(/\b(?:bind|catch):?[a-z]+="([\w]+)"/g)) assert.equal(typeof definition[match[1]], 'function', route + ' 缺少事件 ' + match[1])
    }
    assert.deepEqual(stack, [])
  }
})
