-- Preserve a later custom description when rolling back the seeded default.
DELETE FROM system_configs
WHERE key = 'site_description'
  AND value = to_jsonb('把 AI 变简单的创作工作台'::text);
