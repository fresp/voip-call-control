-- Recordings metadata (files live in S3). bytes is BIGINT for large files,
-- duration NUMERIC for fractional seconds.
CREATE TABLE app.recordings (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id VARCHAR(100) NOT NULL,
  recording_id VARCHAR(100) NOT NULL,
  call_id VARCHAR(100) NOT NULL,
  unique_id VARCHAR(100) NOT NULL,
  local_path VARCHAR(500),
  original_file_name VARCHAR(255) NOT NULL,
  format VARCHAR(10) NOT NULL DEFAULT 'wav',
  bytes BIGINT NOT NULL,
  duration NUMERIC(10,2) NOT NULL,
  started_at TIMESTAMPTZ,
  finalized_at TIMESTAMPTZ NOT NULL,
  s3_bucket VARCHAR(255) NOT NULL,
  s3_key VARCHAR(500) NOT NULL,
  url VARCHAR(1000) NOT NULL,
  upload_status VARCHAR(20) NOT NULL DEFAULT 'pending',
  last_error TEXT,
  uploaded_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT recordings_tenant_recording_unique UNIQUE (tenant_id, recording_id),
  CONSTRAINT recordings_upload_status_check CHECK (upload_status IN ('pending', 'processing', 'ready', 'failed'))
);

CREATE INDEX idx_recordings_tenant_id ON app.recordings (tenant_id);
CREATE INDEX idx_recordings_call_id ON app.recordings (call_id);
CREATE INDEX idx_recordings_unique_id ON app.recordings (unique_id);
CREATE INDEX idx_recordings_s3_key ON app.recordings (s3_key);
CREATE INDEX idx_recordings_upload_status ON app.recordings (upload_status);
CREATE INDEX idx_recordings_tenant_call_created ON app.recordings (tenant_id, call_id, created_at DESC);
