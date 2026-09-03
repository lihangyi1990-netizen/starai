-- Keep the workbench branding consistent with the PICO landing page.
INSERT INTO system_configs (key, value)
VALUES ('site_description', '"把 AI 变简单的创作工作台"')
ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value, updated_at = now();
