-- Calls: the core state machine table.
-- state: canonical states CALL_INCOMING -> CALL_ACCEPTED -> CALL_CONNECTED
--        -> CALL_TRANSFER -> CALL_ENDED.
-- state_history: JSONB array of {state, at, source, eventId, metadata}.
-- routing / a_leg / b_leg: JSONB objects matching Mongoose subdocument shapes.
-- whatsapp: JSONB {wacid, user_id, parent_user_id, username, cta_payload,
--        deeplink_payload} - x-wa-meta-* SIP headers, captured from Phase 1
--        (defect fix: old service never captured them).
CREATE TABLE app.calls (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id VARCHAR(100) NOT NULL,
  call_id VARCHAR(100) NOT NULL,
  channel_id VARCHAR(100) NOT NULL,
  unique_id VARCHAR(100) NOT NULL,
  linked_id VARCHAR(100),
  exten VARCHAR(50),
  caller_number VARCHAR(50),
  callee_number VARCHAR(50),
  state VARCHAR(20) NOT NULL DEFAULT 'CALL_INCOMING',
  state_version INTEGER NOT NULL DEFAULT 0,
  state_history JSONB NOT NULL DEFAULT '[]',
  started_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  answered_at TIMESTAMPTZ,
  ended_at TIMESTAMPTZ,
  hangup_cause VARCHAR(100),
  routing JSONB,
  a_leg JSONB,
  b_leg JSONB,
  bridge_id VARCHAR(100),
  direction VARCHAR(20) NOT NULL DEFAULT 'inbound',
  whatsapp JSONB,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT calls_tenant_call_unique UNIQUE (tenant_id, call_id),
  CONSTRAINT calls_state_check CHECK (state IN ('CALL_INCOMING', 'CALL_ACCEPTED', 'CALL_CONNECTED', 'CALL_TRANSFER', 'CALL_ENDED')),
  CONSTRAINT calls_direction_check CHECK (direction IN ('inbound', 'outbound', 'sip_bridge'))
);

CREATE INDEX idx_calls_tenant_id ON app.calls (tenant_id);
CREATE INDEX idx_calls_channel_id ON app.calls (channel_id);
CREATE INDEX idx_calls_unique_id ON app.calls (unique_id);
CREATE INDEX idx_calls_state ON app.calls (state);
CREATE INDEX idx_calls_started_at ON app.calls (started_at);
CREATE INDEX idx_calls_tenant_unique ON app.calls (tenant_id, unique_id);
CREATE INDEX idx_calls_tenant_channel ON app.calls (tenant_id, channel_id);
