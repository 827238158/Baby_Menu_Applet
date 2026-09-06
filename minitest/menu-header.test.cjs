const test = require('node:test')
const assert = require('node:assert/strict')
const { coverLayout, dragPosition } = require('../miniprogram/services/menu-header')

test('头图等比覆盖与旧百分比位置一致', () => {
  const layout = coverLayout(800, 600, 400, 100, 'center 60%')
  assert.equal(layout.width, 400)
  assert.equal(layout.height, 300)
  assert.equal(layout.top, -120)
  assert.equal(layout.left, 0)
  assert.equal(coverLayout(0, 600, 400, 100), null)
})
test('横竖图拖动都不能露出取景框空白', () => {
  for (const size of [[800, 600], [600, 800], [1200, 100]]) {
    const layout = coverLayout(...size, 400, 100)
    for (const distance of [-10000, 10000]) {
      const position = dragPosition(layout, distance, distance)
      const next = coverLayout(...size, 400, 100, position)
      assert.ok(next.left <= 0 && next.left >= -next.overflowX)
      assert.ok(next.top <= 0 && next.top >= -next.overflowY)
      assert.ok(next.width + next.left >= 400)
      assert.ok(next.height + next.top >= 100)
    }
  }
})
test('兼容关键字、像素与边缘偏移，拖动后预览重建一致', () => {
  assert.equal(coverLayout(800, 600, 400, 100, 'bottom').top, -200)
  assert.equal(coverLayout(800, 600, 400, 100, '50% -30px').top, -30)
  assert.equal(coverLayout(800, 600, 400, 100, 'left 0px bottom 0px').top, -200)
  const layout = coverLayout(800, 600, 400, 100, 'center 60%')
  const moved = coverLayout(800, 600, 400, 100, dragPosition(layout, 0, 40))
  assert.equal(moved.top, -80)
})
