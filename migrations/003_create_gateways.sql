-- SIP gateways per tenant. provider='whatsapp_sip' gates WhatsApp-specific behavior.
CREATE TABLE app.gateways (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id VARCHAR(100) NOT NULL,
  gateway_id VARCHAR(100) NOT NULL,
  name VARCHAR(255) NOT NULL,
  provider VARCHAR(50) NOT NULL DEFAULT 'generic',
  host VARCHAR(255) NOT NULL,
  username VARCHAR(255),
  password VARCHAR(255),
  from_user VARCHAR(255),
  port INTEGER NOT NULL DEFAULT 5060,
  transport VARCHAR(10) NOT NULL DEFAULT 'udp',
  enabled BOOLEAN NOT NULL DEFAULT true,
  metadata JSONB,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT gateways_tenant_gateway_unique UNIQUE (tenant_id, gateway_id),
  CONSTRAINT gateways_provider_check CHECK (provider IN ('generic', 'whatsapp_sip')),
  CONSTRAINT gateways_transport_check CHECK (transport IN ('udp', 'tcp', 'tls', 'ws', 'wss')),
  CONSTRAINT gateways_port_check CHECK (port >= 1 AND port <= 65535)
);

CREATE INDEX idx_gateways_tenant_id ON app.gateways (tenant_id);
CREATE INDEX idx_gateways_gateway_id ON app.gateways (gateway_id);
CREATE INDEX idx_gateways_provider ON app.gateways (provider);
CREATE INDEX idx_gateways_enabled ON app.gateways (enabled);
