-- Remove only the value introduced by the migration. Do not overwrite an
-- operator's later captcha setting during rollback.
DELETE FROM system_configs
WHERE key = 'image_captcha_enabled' AND value = 'false'::jsonb;
