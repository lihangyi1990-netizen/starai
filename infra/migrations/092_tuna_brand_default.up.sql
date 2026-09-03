-- Move the original seeded brand to tuna without overwriting an operator's
-- later custom site name.
UPDATE system_configs
SET value = to_jsonb('tuna'::text), updated_at = now()
WHERE key = 'site_name'
  AND value IN (to_jsonb('PICO AI'::text), to_jsonb('StarAI'::text));
