CREATE TABLE event_outbox (
  id UUID PRIMARY KEY,
  payload JSONB NOT NULL,
  attempts INTEGER NOT NULL DEFAULT 0,
  next_attempt_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  delivered_at TIMESTAMPTZ,
  last_error TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX event_outbox_pending_idx ON event_outbox(next_attempt_at) WHERE delivered_at IS NULL;
