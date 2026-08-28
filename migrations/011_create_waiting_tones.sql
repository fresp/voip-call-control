-- Waiting tones (hold music). Partial unique index mirrors Mongoose's
-- partialFilterExpression: at most one default+active tone per tenant
-- (tenant_id NULL = global default).
CREATE TABLE app.waiting_tones (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name VARCHAR(255) NOT NULL,
  description TEXT,
  file_url VARCHAR(500) NOT NULL,
  file_name VARCHAR(255) NOT NULL,
  mime_type VARCHAR(100) NOT NULL,
  is_default BOOLEAN NOT NULL DEFAULT false,
  tenant_id VARCHAR(100),
  is_active BOOLEAN NOT NULL DEFAULT true,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_waiting_tones_is_default ON app.waiting_tones (is_default);
CREATE INDEX idx_waiting_tones_tenant_id ON app.waiting_tones (tenant_id);
CREATE INDEX idx_waiting_tones_is_active ON app.waiting_tones (is_active);
CREATE UNIQUE INDEX idx_waiting_tones_tenant_default_active
  ON app.waiting_tones (tenant_id, is_default)
  WHERE is_default = true AND is_active = true;
