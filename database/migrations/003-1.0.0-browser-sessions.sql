CREATE TABLE browser_sessions (
  token_hash TEXT PRIMARY KEY,
  human_id TEXT NOT NULL REFERENCES humans(id) ON DELETE CASCADE,
  expires_at TIMESTAMPTZ NOT NULL
);
CREATE INDEX browser_sessions_expiry_idx ON browser_sessions(expires_at);
CREATE UNIQUE INDEX chat_profiles_nickname_case_idx ON chat_profiles(lower(nickname));
CREATE INDEX messages_room_cursor_idx ON messages(room_id, created_at, id);
