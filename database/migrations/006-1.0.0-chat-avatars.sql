CREATE TABLE chat_avatars (
  human_id TEXT PRIMARY KEY REFERENCES chat_profiles(human_id) ON DELETE CASCADE,
  image BYTEA NOT NULL CHECK (octet_length(image) <= 262144),
  version INTEGER NOT NULL DEFAULT 1,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);