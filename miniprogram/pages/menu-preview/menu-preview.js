const { createMenuPage } = require('../../services/menu-page')

// 预览与公开菜单使用同一交互实现，但隔离真实购物车和分享入口。
Page(createMenuPage({ preview: true }))
