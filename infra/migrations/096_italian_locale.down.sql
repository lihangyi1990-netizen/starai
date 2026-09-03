UPDATE system_configs
SET value = COALESCE(
      (
        SELECT jsonb_agg(item ORDER BY ordinality)
        FROM jsonb_array_elements(system_configs.value) WITH ORDINALITY AS entry(item, ordinality)
        WHERE item <> '"it-IT"'::jsonb
      ),
      '[]'::jsonb
    ),
    updated_at = now()
WHERE key = 'i18n_target_locales'
  AND jsonb_typeof(value) = 'array'
  AND value @> '["it-IT"]'::jsonb;

UPDATE system_configs
SET value = COALESCE(
      (
        SELECT jsonb_agg(item ORDER BY ordinality)
        FROM jsonb_array_elements(system_configs.value) WITH ORDINALITY AS entry(item, ordinality)
        WHERE entry.item ->> 'code' IS DISTINCT FROM 'it-IT'
      ),
      '[]'::jsonb
    ),
    updated_at = now()
WHERE key = 'ui_languages'
  AND jsonb_typeof(value) = 'array'
  AND EXISTS (
    SELECT 1
    FROM jsonb_array_elements(value) AS entry(item)
    WHERE entry.item ->> 'code' = 'it-IT'
  );
