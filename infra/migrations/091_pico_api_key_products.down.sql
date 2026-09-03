DROP INDEX IF EXISTS idx_api_tokens_product_code;

ALTER TABLE api_tokens
  DROP COLUMN IF EXISTS model_scopes,
  DROP COLUMN IF EXISTS product_code;
