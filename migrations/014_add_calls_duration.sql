-- Phase 2 amendment: the calls row must carry the finalized talk duration
-- (ChannelDestroyed finalize). The old service derived duration only on
-- recordings; Phase 2 computes it on the call itself:
--   duration_seconds = ended_at - COALESCE(answered_at, started_at)
-- Nullable: only set when a call ends.
ALTER TABLE app.calls ADD COLUMN IF NOT EXISTS duration_seconds INTEGER;
