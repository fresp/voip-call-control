-- DIDs (inbound numbers) with routing. routing_target/fallback are small
-- fixed-shape objects {type, value}; JSONB avoids join-table overhead since
-- they are never independently queried.
CREATE TABLE app.dids (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  number VARCHAR(50) NOT NULL,
  tenant_id VARCHAR(100) NOT NULL,
  gateway_id VARCHAR(100),
  routing_type VARCHAR(20) NOT NULL DEFAULT 'extension',
  routing_target JSONB NOT NULL,
  fallback JSONB,
  is_active BOOLEAN NOT NULL DEFAULT true,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT dids_tenant_number_unique UNIQUE (tenant_id, number),
  CONSTRAINT dids_routing_type_check CHECK (routing_type IN ('extension', 'queue', 'bot', 'gateway', 'sip_bridge'))
);

CREATE INDEX idx_dids_tenant_id ON app.dids (tenant_id);
CREATE INDEX idx_dids_gateway_id ON app.dids (gateway_id);
CREATE INDEX idx_dids_routing_type ON app.dids (routing_type);
CREATE INDEX idx_dids_is_active ON app.dids (is_active);
CREATE INDEX idx_dids_number_active ON app.dids (number, is_active);
CREATE INDEX idx_dids_tenant_gateway_active ON app.dids (tenant_id, gateway_id, is_active);
