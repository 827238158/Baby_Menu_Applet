# 常见坑

## 文档与记忆

- Trigger: 新增、替换或修改项目级 Codex Hook 后，Hook 未执行或显示未信任。
  Cause: Hook 命令或脚本变化会使此前的信任哈希失效。
  Recovery: 先运行 Hook 单元测试和安装器 `--check`，再在 Codex 中使用 `/hooks` 审查并信任当前项目命令；不要绕过信任检查。

## 编码与环境

- Trigger: PowerShell 终端显示中文乱码。
  Cause: 终端编码显示问题，不一定代表文件内容损坏。
  Recovery: 不要仅凭终端输出判断；检查 JS 语法时让 Node 直接读取文件路径，避免用管道传中文文件内容。

## 菜单数据与图片

- Trigger: 想直接编辑 `miniprogram/data/*.js`。
  Cause: 这些文件由 Excel 和生成脚本产出，手改容易被覆盖。
  Recovery: 优先修改 `tools/menu-workbook/menu-data.xlsx`，再运行 `node tools\generate-menu-data.js`；除非用户明确要求，才手改生成后的数据文件。

- Trigger: 商品图片路径在小程序里加载失败。
  Cause: `Dishes.imageFile` 写入了 Windows 绝对路径或错误路径。
  Recovery: 商品图片放到 `miniprogram/assets/foods/`，`imageFile` 只填文件名；留空则使用占位图。

## 产品与发布边界

- Trigger: 想把展示页扩展成真实下单系统。
  Cause: 项目边界是本地展示版，不包含后端、数据库、登录、支付或真实订单。
  Recovery: 除非用户明确要求，不新增真实下单、云开发、后端接口、支付流程或 npm 构建流程。

- Trigger: 准备发布或替换 AppID。
  Cause: 当前 `project.config.json` 已配置正式 AppID，随意替换会导致微信登录身份空间变化。
  Recovery: 不要主动替换 AppID；SCF 的 `WX_APP_ID` 必须与小程序项目一致。

## 礼品夹云端与权限

- Trigger: 礼品图片在开发者工具可上传，真机却请求失败。
  Cause: SCF 函数 URL 或 COS 桶域名未加入微信公众平台对应类型的合法域名；POST Object 改用 `wx.uploadFile` 后，只配置旧 `request` 域名不够。
  Recovery: SCF 域名加入 `request`，COS 域名加入 `uploadFile` 和 `downloadFile`，真机不要依赖“不校验合法域名”。

- Trigger: SCF 能启动但访问 COS 返回无权限。
  Cause: 未绑定运行角色，或角色缺少目标桶的 GetBucket/GetObject/HeadObject/PutObject/PostObject/DeleteObject。
  Recovery: 给函数绑定仅限目标桶和 `gift-folder` 前缀的运行角色，POST Object 上线前补充 `cos:PostObject`，不把永久云密钥写入代码。

- Trigger: 礼品并发写入时仍然偶发丢失或覆盖。
  Cause: COS 存储桶开启版本控制后，`x-cos-forbid-overwrite:true` 不再禁止覆盖，`system/index.lock` 不具备互斥性。
  Recovery: 上线索引 v2 前在 COS 控制台核验并暂停版本控制，保留历史版本；不核验就不部署写锁版本。

- Trigger: 开启 OpenID 发现模式后日志长期保留身份信息。
  Cause: `OPENID_DISCOVERY=true` 会把完整 OpenID 写入 SCF 日志。
  Recovery: 两人各登录一次后立即写入白名单并关闭发现模式，同时缩短或清理相关日志。

- Trigger: COS 签名 URL 在 `<image>` 中无法直接预览。
  Cause: 部分新桶默认域名限制浏览器内联预览。
  Recovery: 页面会自动使用 `wx.downloadFile` 下载到临时路径兜底；确保 COS 域名已加入 `downloadFile` 合法域名。

- Trigger: 原图直传成功，但数据万象缩略图接口返回 `THUMBNAIL_PROCESSING_UNAVAILABLE`。
  Cause: 目标 COS 桶未绑定数据万象、SCF 运行角色缺少原图读取/缩略图写入或校验权限，或数据万象处理暂时失败。
  Recovery: 先核对数据万象绑定和 `GetObject`、`HeadObject`、`PutObject`、`DeleteObject` 权限，再检查 SCF 日志与残留对象；前端必须等待孤儿原图清理结束后返回原始错误并阻止保存，不能降级用原图充当缩略图。

## SCF 部署与验证

- Trigger: 前端调用新礼品接口时返回 404“接口不存在”，但本地后端已有对应路由。
  Cause: 腾讯云 SCF 仍运行旧 `gift-api.zip`；本机 ZIP 也可能早于后端源码。
  Recovery: 重新运行云端测试和语法检查，执行生产依赖安装与 ZIP 打包，核对 ZIP 时间及关键路由后，在 SCF 控制台上传并部署新包；部署完成后必须用真机实际打开原图验证，不能只看控制台部署成功。

- Trigger: 发布只上传原图的新版小程序后，所有新图片都无法保存。
  Cause: 小程序先于包含持久化缩略图路由的兼容版 SCF 发布，线上后端仍不认识新接口。
  Recovery: 固定按“先 SCF、验证礼品和装修好物缩略图接口、后发布小程序”的顺序上线；SCF 暂时保留旧客户端 `asset: thumbnail` 兼容能力，异常时先回退小程序。

- Trigger: 收藏项移动到另一分段后，原图片被每日清理或编辑删除误删。
  Cause: 移动保留原图片 Key，图片命名空间与当前索引分类可能不同；如果只检查同名空间索引，会把仍在使用的图片误判为孤儿。
  Recovery: 删除旧图和 Timer 清理前都必须合并礼品、装修两份索引的 `imageKey` / `thumbnailKey` 引用；移动接口保持固定加锁顺序并支持幂等重试。

## 微信小程序 UI

- Trigger: 头图收藏数量正确，但卡片不显示，控制台报 `Component is not found in path`。
  Cause: 新增自定义组件目录未被微信开发者工具正确刷新，或页面 JSON 的组件路径未被当前项目根配置正确解析；卡片循环依赖该组件，因此数据存在也不会渲染。
  Recovery: 页面级 `usingComponents` 优先使用从页面目录出发的明确相对路径，并用测试校验 `.js/.json/.wxml/.wxss` 四个文件存在；新增组件后执行“清缓存并编译”，必要时关闭并重新导入项目。

- Trigger: 云端返回的收藏数量正确，但固定头图下方的礼品卡片全部不可见。
  Cause: 纵向 `scroll-view` 只设置了 `flex: 1`，微信宿主没有据此得到确定的滚动高度，内容区被计算成不可见高度。
  Recovery: 给列表滚动区使用独立类，同时设置 `flex: 1; height: 0; min-height: 0;`；不要与普通授权提示容器共用高度类，并在真机验证长列表滚动。

- Trigger: 绝对定位的圆形叉号、图标或小按钮在开发者工具正常，真机或其他客户端却被拉成椭圆。
  Cause: 使用原生 `<button>` 承载纯图标；微信宿主的按钮默认最小尺寸、行高和伪元素在不同客户端可能与页面样式叠加，仅设置 `width` / `height` 不足以稳定保证正方形。
  Recovery: 纯图标覆盖层优先使用带 `aria-role="button"` 和 `aria-label` 的 `<view>`，同时锁定 `width` / `min-width` / `max-width` 与对应高度，再用 flex 居中；必须使用 `<button>` 时，要完整重置最小尺寸、padding、line-height 和 `::after`，并做真机验证。
