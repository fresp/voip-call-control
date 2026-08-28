-- Call queues. members is a JSONB array of {extension, priority, weight}
-- matching the Mongoose subdocument array.
CREATE TABLE app.queues (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id VARCHAR(100) NOT NULL,
  queue_id VARCHAR(100) NOT NULL,
  name VARCHAR(255) NOT NULL,
  strategy VARCHAR(20) NOT NULL DEFAULT 'round_robin',
  members JSONB NOT NULL DEFAULT '[]',
  timeout INTEGER NOT NULL DEFAULT 20,
  retry INTEGER NOT NULL DEFAULT 5,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT queues_tenant_queue_unique UNIQUE (tenant_id, queue_id),
  CONSTRAINT queues_tenant_name_unique UNIQUE (tenant_id, name),
  CONSTRAINT queues_strategy_check CHECK (strategy IN ('round_robin', 'least_calls', 'ring_all')),
  CONSTRAINT queues_timeout_check CHECK (timeout >= 1),
  CONSTRAINT queues_retry_check CHECK (retry >= 0)
);

CREATE INDEX idx_queues_tenant_id ON app.queues (tenant_id);
CREATE INDEX idx_queues_strategy ON app.queues (strategy);
