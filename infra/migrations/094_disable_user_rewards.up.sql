-- User-requested policy: do not grant signup or daily check-in credits.
-- Keep the configuration rows so administrators can see the policy and change
-- it deliberately later; this migration is safe to run more than once.
INSERT INTO system_configs (key, value) VALUES
  ('signup_bonus', '0'::jsonb),
  ('daily_checkin_enabled', 'false'::jsonb)
ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value, updated_at = now();
