-- PICO defaults to direct email/password login for a lower-friction first visit.
-- Operators can re-enable image_captcha_enabled from the admin configuration.
INSERT INTO system_configs (key, value)
VALUES ('image_captcha_enabled', 'false')
ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value, updated_at = now();
