-- A PICO API Key is a customer credential, never an upstream provider key.
-- Store the customer-facing product and model allow-list on the key so the
-- policy remains stable even when the Sub2API account pool changes.
ALTER TABLE api_tokens
  ADD COLUMN IF NOT EXISTS product_code VARCHAR(64) NOT NULL DEFAULT 'pico-all',
  ADD COLUMN IF NOT EXISTS model_scopes JSONB NOT NULL DEFAULT '["*"]'::jsonb;

CREATE INDEX IF NOT EXISTS idx_api_tokens_product_code ON api_tokens(product_code);
