ALTER TABLE chat_profiles
  ADD COLUMN role TEXT NOT NULL DEFAULT 'user' CHECK (role IN ('user', 'admin')),
  ADD COLUMN account_status TEXT NOT NULL DEFAULT 'active'
    CHECK (account_status IN ('active', 'blocked', 'set_for_deletion')),
  ADD COLUMN deletion_at TIMESTAMPTZ,
  ADD CONSTRAINT chat_profiles_deletion_state_check
    CHECK ((account_status = 'set_for_deletion') = (deletion_at IS NOT NULL));