CREATE TABLE remembered_browsers (
  token_hash TEXT PRIMARY KEY,
  human_id TEXT NOT NULL REFERENCES humans(id) ON DELETE CASCADE,
  expires_at TIMESTAMPTZ NOT NULL
);
CREATE TABLE recovery_codes (
  human_id TEXT PRIMARY KEY REFERENCES humans(id) ON DELETE CASCADE,
  code_hash TEXT NOT NULL UNIQUE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
