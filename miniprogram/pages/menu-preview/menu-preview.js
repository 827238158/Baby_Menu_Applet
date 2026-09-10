const { createMenuPage } = require('../../services/menu-page')

// 草稿与历史版本共用公开菜单交互；查询参数由云端页面适配层判定只读模式。
Page(createMenuPage({ preview: true }))
