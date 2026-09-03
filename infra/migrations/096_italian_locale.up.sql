INSERT INTO system_configs (key, value, updated_at)
VALUES ('i18n_target_locales', '["en-US","ja-JP","ko-KR","vi-VN","it-IT"]'::jsonb, now())
ON CONFLICT (key) DO UPDATE
SET value = CASE
      WHEN jsonb_typeof(system_configs.value) = 'array'
        AND NOT system_configs.value @> '["it-IT"]'::jsonb
      THEN system_configs.value || '["it-IT"]'::jsonb
      ELSE system_configs.value
    END,
    updated_at = CASE
      WHEN jsonb_typeof(system_configs.value) = 'array'
        AND NOT system_configs.value @> '["it-IT"]'::jsonb
      THEN now()
      ELSE system_configs.updated_at
    END;

UPDATE system_configs
SET value = value || '[{"code":"it-IT","short":"IT","name":"Italiano","flag":"\ud83c\uddee\ud83c\uddf9","enabled":true,"sort_order":60}]'::jsonb,
    updated_at = now()
WHERE key = 'ui_languages'
  AND jsonb_typeof(value) = 'array'
  AND NOT EXISTS (
    SELECT 1
    FROM jsonb_array_elements(value) AS entry(item)
    WHERE entry.item ->> 'code' = 'it-IT'
  );
