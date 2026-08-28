-- Tenants: business-facing tenant registry.
CREATE TABLE app.tenants (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id VARCHAR(100) NOT NULL,
  name VARCHAR(255),
  status VARCHAR(20) NOT NULL DEFAULT 'active',
  metadata JSONB,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT tenants_tenant_id_unique UNIQUE (tenant_id),
  CONSTRAINT tenants_status_check CHECK (status IN ('active', 'disabled'))
);

CREATE INDEX idx_tenants_status ON app.tenants (status);
