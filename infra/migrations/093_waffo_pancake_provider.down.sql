DELETE FROM system_configs WHERE key IN (
  'waffo_pancake_merchant_id',
  'waffo_pancake_private_key',
  'waffo_pancake_store_id',
  'waffo_pancake_product_id',
  'waffo_pancake_return_url',
  'waffo_pancake_environment',
  'waffo_pancake_webhook_public_key',
  'waffo_pancake_webhook_test_public_key',
  'waffo_pancake_webhook_prod_public_key',
  'waffo_pancake_tax_category'
);
