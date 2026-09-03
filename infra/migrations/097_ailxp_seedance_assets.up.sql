CREATE TABLE IF NOT EXISTS ailxp_seedance_assets (
    id BIGSERIAL PRIMARY KEY,
    user_id BIGINT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    route_id BIGINT NOT NULL REFERENCES model_routes(id) ON DELETE CASCADE,
    asset_id BIGINT NOT NULL REFERENCES assets(id) ON DELETE CASCADE,
    source_url TEXT NOT NULL,
    asset_type VARCHAR(16) NOT NULL CHECK (asset_type IN ('Image', 'Video', 'Audio')),
    upstream_asset_id VARCHAR(256) NOT NULL,
    status VARCHAR(24) NOT NULL DEFAULT 'PROCESSING',
    error_message TEXT,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    UNIQUE (user_id, route_id, asset_id)
);

CREATE INDEX IF NOT EXISTS idx_ailxp_seedance_assets_user_status
    ON ailxp_seedance_assets (user_id, status, updated_at DESC);
