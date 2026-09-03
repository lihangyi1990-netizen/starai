-- Waffo Pancake is an independently configured provider. Keep it disabled
-- until an operator supplies the merchant credentials in the admin console.
INSERT INTO system_configs (key, value) VALUES
  ('waffo_pancake_merchant_id', '""'),
  ('waffo_pancake_private_key', '""'),
  ('waffo_pancake_store_id', '""'),
  ('waffo_pancake_product_id', '""'),
  ('waffo_pancake_return_url', '""'),
  ('waffo_pancake_environment', '"prod"'),
  ('waffo_pancake_webhook_public_key', '""'),
  ('waffo_pancake_webhook_test_public_key', '""'),
  ('waffo_pancake_webhook_prod_public_key', '""'),
  ('waffo_pancake_tax_category', '"saas"')
ON CONFLICT (key) DO NOTHING;
