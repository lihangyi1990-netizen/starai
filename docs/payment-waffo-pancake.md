# Waffo Pancake 支付

PICO/tuna 现在内置了独立的 `waffo_pancake` 支付渠道。它不是
`generic` 网关的别名：服务端使用 Waffo Pancake Go SDK 创建托管收银台，
并使用 `X-Waffo-Signature` 的 RSA-SHA256 签名验证到账通知。

## 配置

在管理员后台的“系统配置 → 支付”中选择 **Waffo Pancake Checkout**，填写：

| 配置项 | 用途 |
| --- | --- |
| `waffo_pancake_merchant_id` | Waffo Merchant ID（`MER_...`） |
| `waffo_pancake_private_key` | Merchant RSA 私钥，仅保存在 API 服务端 |
| `waffo_pancake_store_id` | 收款 Store ID（`STO_...`） |
| `waffo_pancake_product_id` | 已发布的一次性 Product ID（`PROD_...`） |
| `waffo_pancake_return_url` | 可选的支付完成返回地址，可包含 `{order_no}` |
| `waffo_pancake_environment` | `test` 或 `prod`，用于 webhook 环境隔离 |
| `waffo_pancake_tax_category` | 税务类别，默认 `saas` |

Webhook 公钥通常不需要填写，SDK 已内置 Waffo 官方 test/prod 公钥。若
Waffo 为商户提供了轮换后的公钥，可填写共享公钥，或分别填写
`waffo_pancake_webhook_test_public_key` 和
`waffo_pancake_webhook_prod_public_key`。

保存配置后先保持“在线支付”关闭，完成测试支付和 webhook 验证后再开启。
没有完整凭证时渠道不会创建订单，也不会把任何密钥返回给前端。

## Webhook 地址

在 Waffo Pancake 控制台为 `order.completed` 注册 API 服务的 HTTPS 地址：

```text
https://<你的域名>/api/payment/webhooks/waffo-pancake/prod
https://<你的域名>/api/payment/webhooks/waffo-pancake/test
```

不区分环境的安装也可以使用：

```text
https://<你的域名>/api/payment/webhooks/waffo-pancake
```

服务端会读取原始请求体并验证 `X-Waffo-Signature`、时间戳、事件模式、
Store ID、订单外部编号、买家身份、金额和币种。只有验签通过的
`order.completed` 才会入账；重复通知由订单事务幂等处理，不会重复增加余额。
到账不依赖浏览器跳转或支付成功页面。

## 订单映射与金额

创建 PICO 订单时，本地 `order_no` 会作为 Pancake 的
`orderMerchantExternalId` 发送，并用 `pico-user-<用户ID>` 作为稳定买家身份。
PICO 套餐金额和币种会写入 checkout 的 `priceSnapshot`，回调优先使用
Pancake 的 `subtotal`（税额不会改变用户购买的算力），同时检查 `total` 不低于
该金额。PICO 自己的套餐和算力倍率仍在 PICO 后台维护，Pancake 只负责收款。

## 测试与生产切换

1. 在 Pancake 创建/发布一次性 Product，并确认 Store、币种和环境正确。
2. 在 PICO 后台填入 test 凭证，选择 `test`，登记 `/test` webhook。
3. 创建一笔小额订单，确认签名通过、订单变为 `paid`、钱包只入账一次。
4. 轮换到生产 Merchant/Product 和 `prod` webhook；不要混用 test 的私钥、公钥或数据库。

不要把 RSA 私钥放进前端、日志、URL、提交到仓库，也不要通过修改浏览器返回参数来
充值。生产环境必须使用 HTTPS，并应定期轮换后台密钥。
