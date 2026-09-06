# 宝宝菜单小程序

微信原生家庭菜单：公开浏览云端菜单，本地选择规格、加入购物车并复制已选清单。没有支付、真实订单或数据库，菜品价格统一为字符串 `'0'`。

菜单管理仅允许与心愿夹相同的两名 OpenID 白名单用户访问。两人维护共享草稿，预览后手动发布；全部发布 JSON 和引用图片保留，可恢复到草稿再发布。心愿夹中的礼品与装修好物继续保持私有。

## 当前上线状态

菜单上云代码与一次性迁移工具在本地实现。腾讯云新版 SCF、数据万象缩略图、菜单初始化和新版小程序尚待部署及真机验收，不代表线上已经启用。准确验证结果和待办见 [当前状态](memory/CURRENT.md)。

使用微信开发者工具导入仓库根目录和现有 AppID。新菜单页需要新版后端与首个已发布菜单；没有云端内容和缓存时显示错误/重试提示，不再加载随包旧菜品。

## 目录职责

```text
miniprogram/
  pages/menu/                 公开菜单入口与共享 WXML/WXSS
  pages/menu-admin/           菜品、分类、页面设置、历史管理
  pages/menu-preview/         草稿预览与发布
  pages/gifts/                私有心愿夹
  services/                  公共会话、菜单交互、请求与图片服务
  components/                可复用组件
  config/gift-cloud.js        菜单与心愿夹共用的 SCF 地址
  assets/                    小程序运行时通用兜底资源
serverless/gift-api/
  index.js                   保持原部署入口
  src/menu/                  独立菜单校验、仓储与业务
  src/                       心愿夹及共享 COS、微信鉴权能力
  test/                      后端测试
tools/menu-cloud/            一次性迁移和只读检查
tools/menu-workbook/         旧 Excel、生成数据及图片迁移源（不进代码包）
minitest/                   小程序逻辑及结构测试
docs/menu-cloud-deployment.md 腾讯云操作与恢复手册
memory/                     状态、稳定事实、陷阱和运行命令
```

## 日常使用与开发

- 菜单页长按店名标题（白名单用户） → 编辑 → 保存共享草稿 → 预览 → 发布。详见 [维护指南](CUSTOMIZATION.md)。
- 公开菜单首次进入和返回页面时自动检查版本；网络失败使用最近成功缓存。预览购物车与真实购物车隔离。
- 首次迁移使用 [迁移工具](tools/menu-cloud/README.md)，之后云端为唯一真源，不再通过 Excel 生成脚本更新线上菜单。
- UI 规则只维护在 [DESIGN.md](DESIGN.md)，命令和验收统一维护在 [RUNBOOK](memory/RUNBOOK.md)。
- 腾讯云操作按 [菜单部署手册](docs/menu-cloud-deployment.md)；心愿夹兼容要求见 [后端说明](serverless/gift-api/README.md)。Git push 不会部署 SCF 或发布小程序。

长期边界：不替换 AppID，不新增真实下单或支付，不在小程序、源码、文档或仓库文件中保存永久云密钥。
