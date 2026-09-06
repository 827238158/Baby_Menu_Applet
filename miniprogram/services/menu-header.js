const clamp = (value, low, high) => Math.min(high, Math.max(low, value))

// 兼容旧 CSS 位置的关键字、百分比、像素及边缘偏移写法。
function axisOffset(token, available) {
  if (token === 'center') return available / 2
  if (token === 'right' || token === 'bottom') return available
  if (token === 'left' || token === 'top') return 0
  const value = parseFloat(token)
  if (!Number.isFinite(value)) return available / 2
  return token.endsWith('%') ? available * value / 100 : value
}

function offsets(position, x, y) {
  const tokens = String(position || 'center 60%').trim().split(/\s+/)
  if (tokens.length >= 3) {
    const result = { x: x / 2, y: y / 2 }
    for (let i = 0; i < tokens.length; i++) {
      const edge = tokens[i]
      const axis = /left|right/.test(edge) ? 'x' : /top|bottom/.test(edge) ? 'y' : null
      if (!axis) continue
      const available = axis === 'x' ? x : y
      const next = tokens[i + 1]
      const distance = next && /^-?\d/.test(next) ? axisOffset(tokens[++i], available) : 0
      result[axis] = edge === 'right' || edge === 'bottom' ? available - distance : distance
    }
    return result
  }
  let [horizontal, vertical] = tokens
  if (!vertical) {
    if (/^(top|bottom)$/.test(horizontal)) { vertical = horizontal; horizontal = 'center' }
    else vertical = 'center'
  } else if (/^(top|bottom)$/.test(horizontal) || /^(left|right)$/.test(vertical)) {
    ;[horizontal, vertical] = [vertical, horizontal]
  }
  return { x: axisOffset(horizontal, x), y: axisOffset(vertical, y) }
}

function coverLayout(imageWidth, imageHeight, boxWidth, boxHeight, position = 'center 60%') {
  if (![imageWidth, imageHeight, boxWidth, boxHeight].every((value) => Number.isFinite(value) && value > 0)) return null
  const scale = Math.max(boxWidth / imageWidth, boxHeight / imageHeight)
  const width = imageWidth * scale
  const height = imageHeight * scale
  const overflowX = Math.max(0, width - boxWidth)
  const overflowY = Math.max(0, height - boxHeight)
  const point = offsets(position, -overflowX, -overflowY)
  const left = clamp(point.x, -overflowX, 0) || 0
  const top = clamp(point.y, -overflowY, 0) || 0
  return { width, height, left, top, overflowX, overflowY,
    style: `width:${width}px;height:${height}px;left:${left}px;top:${top}px;` }
}

function dragPosition(layout, dx, dy) {
  // 只移动超出取景框的部分，百分比可直接保存在既有字段中。
  const x = layout.overflowX ? -clamp(layout.left + dx, -layout.overflowX, 0) / layout.overflowX * 100 : 50
  const y = layout.overflowY ? -clamp(layout.top + dy, -layout.overflowY, 0) / layout.overflowY * 100 : 50
  return `${Number(x.toFixed(4))}% ${Number(y.toFixed(4))}%`
}

module.exports = { coverLayout, dragPosition }
