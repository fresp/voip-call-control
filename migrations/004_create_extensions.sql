-- Extensions per tenant. Two uniqueness rules preserved from Mongoose:
-- (tenant_id, extension_id) and (tenant_id, number).
CREATE TABLE app.extensions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id VARCHAR(100) NOT NULL,
  extension_id VARCHAR(100) NOT NULL,
  number VARCHAR(50) NOT NULL,
  display_name VARCHAR(255),
  gateway_id VARCHAR(100),
  enabled BOOLEAN NOT NULL DEFAULT true,
  status VARCHAR(20) NOT NULL DEFAULT 'available',
  current_call_id VARCHAR(100),
  last_seen_at TIMESTAMPTZ,
  metadata JSONB,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT extensions_tenant_extension_unique UNIQUE (tenant_id, extension_id),
  CONSTRAINT extensions_tenant_number_unique UNIQUE (tenant_id, number),
  CONSTRAINT extensions_status_check CHECK (status IN ('available', 'ringing', 'busy', 'offline'))
);

CREATE INDEX idx_extensions_tenant_id ON app.extensions (tenant_id);
CREATE INDEX idx_extensions_gateway_id ON app.extensions (gateway_id);
CREATE INDEX idx_extensions_enabled ON app.extensions (enabled);
CREATE INDEX idx_extensions_status ON app.extensions (status);
CREATE INDEX idx_extensions_current_call_id ON app.extensions (current_call_id);
CREATE INDEX idx_extensions_last_seen_at ON app.extensions (last_seen_at);
