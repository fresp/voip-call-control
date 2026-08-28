-- Idempotency ledger for external events.
-- Mongoose TTL index on expires_at (expireAfterSeconds: 0) has no Postgres
-- native equivalent; 013_create_cleanup_job.sql provides the cleanup path.
CREATE TABLE app.processed_events (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id VARCHAR(100) NOT NULL,
  event_id VARCHAR(255) NOT NULL,
  source VARCHAR(50) NOT NULL,
  call_id VARCHAR(100),
  expires_at TIMESTAMPTZ NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT processed_events_tenant_source_event_unique UNIQUE (tenant_id, source, event_id)
);

CREATE INDEX idx_processed_events_tenant_id ON app.processed_events (tenant_id);
CREATE INDEX idx_processed_events_event_id ON app.processed_events (event_id);
CREATE INDEX idx_processed_events_source ON app.processed_events (source);
CREATE INDEX idx_processed_events_call_id ON app.processed_events (call_id);
CREATE INDEX idx_processed_events_expires_at ON app.processed_events (expires_at);
