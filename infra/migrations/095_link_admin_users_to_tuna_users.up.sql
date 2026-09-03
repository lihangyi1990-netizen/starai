-- Link a Tuna user to an administrator explicitly.  The relationship is
-- optional so existing installations keep their current admin accounts, and
-- one Tuna account can never elevate more than one admin account.
ALTER TABLE admin_users
  ADD COLUMN IF NOT EXISTS user_id BIGINT REFERENCES users(id) ON DELETE SET NULL;

CREATE UNIQUE INDEX IF NOT EXISTS idx_admin_users_user_id
  ON admin_users(user_id)
  WHERE user_id IS NOT NULL;
