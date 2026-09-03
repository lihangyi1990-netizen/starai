DROP INDEX IF EXISTS idx_admin_users_user_id;

ALTER TABLE admin_users
  DROP COLUMN IF EXISTS user_id;
