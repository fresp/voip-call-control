-- Call correlations: channel-to-call mapping for A/B legs.
CREATE TABLE app.call_correlations (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id VARCHAR(100) NOT NULL,
  call_id VARCHAR(100) NOT NULL,
  channel_id VARCHAR(100) NOT NULL,
  leg VARCHAR(5) NOT NULL DEFAULT 'a',
  direction VARCHAR(20) NOT NULL DEFAULT 'inbound',
  gateway_id VARCHAR(100),
  target VARCHAR(255),
  metadata JSONB,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT call_correlations_channel_id_unique UNIQUE (channel_id),
  CONSTRAINT call_correlations_leg_check CHECK (leg IN ('a', 'b')),
  CONSTRAINT call_correlations_direction_check CHECK (direction IN ('inbound', 'outbound', 'sip_bridge'))
);

CREATE INDEX idx_call_correlations_tenant_id ON app.call_correlations (tenant_id);
CREATE INDEX idx_call_correlations_call_id ON app.call_correlations (call_id);
CREATE INDEX idx_call_correlations_tenant_call ON app.call_correlations (tenant_id, call_id);
CREATE INDEX idx_call_correlations_tenant_channel ON app.call_correlations (tenant_id, channel_id);
