-- Presence: decoupled from extension configuration (old service tracked
-- presence on Extension.status/lastSeenAt). Staleness sweep (application
-- level): WHERE last_seen_at < NOW() - INTERVAL '45 seconds' -> 'offline'.
CREATE TABLE app.presence (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id VARCHAR(100) NOT NULL,
  extension_id VARCHAR(100) NOT NULL,
  status VARCHAR(20) NOT NULL DEFAULT 'offline',
  last_seen_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  current_call_id VARCHAR(100),
  metadata JSONB,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT presence_tenant_extension_unique UNIQUE (tenant_id, extension_id),
  CONSTRAINT presence_status_check CHECK (status IN ('available', 'ringing', 'busy', 'offline'))
);

CREATE INDEX idx_presence_tenant_id ON app.presence (tenant_id);
CREATE INDEX idx_presence_extension_id ON app.presence (extension_id);
CREATE INDEX idx_presence_status ON app.presence (status);
CREATE INDEX idx_presence_last_seen_at ON app.presence (last_seen_at);
