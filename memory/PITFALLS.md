# 常见坑

- Trigger: PowerShell 终端显示中文乱码。
  Cause: 终端编码显示问题，不一定代表文件内容损坏。
  Recovery: 不要仅凭终端输出判断；检查 JS 语法时让 Node 直接读取文件路径，避免用管道传中文文件内容。

- Trigger: 想直接编辑 `miniprogram/data/*.js`。
  Cause: 这些文件由 Excel 和生成脚本产出，手改容易被覆盖。
  Recovery: 优先修改 `tools/menu-workbook/menu-data.xlsx`，再运行 `node tools\generate-menu-data.js`；除非用户明确要求，才手改生成后的数据文件。

- Trigger: 商品图片路径在小程序里加载失败。
  Cause: `Dishes.imageFile` 写入了 Windows 绝对路径或错误路径。
  Recovery: 商品图片放到 `miniprogram/assets/foods/`，`imageFile` 只填文件名；留空则使用占位图。

- Trigger: 想把展示页扩展成真实下单系统。
  Cause: 项目边界是本地展示版，不包含后端、数据库、登录、支付或真实订单。
  Recovery: 除非用户明确要求，不新增真实下单、云开发、后端接口、支付流程或 npm 构建流程。

- Trigger: 准备发布或替换 AppID。
  Cause: 当前 `project.config.json` 使用 `touristappid`。
  Recovery: 不要主动替换；正式发布前由用户确认真实微信小程序 AppID。
