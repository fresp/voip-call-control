'use strict';

/**
 * Data access for app.calls. All statements are schema-qualified to `app`
 * and fully parameterized (PgBouncer transaction-mode safe: no named
 * prepared statements).
 *
 * Concurrency model: handlers are stateless — rows are resolved by
 * channel_id (indexed: idx_calls_tenant_channel / idx_calls_channel_id) so a
 * mid-call process restart cannot orphan live calls. Idempotency is
 * enforced in SQL (ON CONFLICT / NULL-guards), not in memory.
 */

const { appendHistory } = require('./state-machine');

/**
 * Insert a call row for a StasisStart. Idempotent per (tenant_id, call_id):
 * a replayed StasisStart for the same channel returns the existing row
 * (inserted=false); a different channel reusing the call id is NOT inserted
 * (B-leg correlation is Phase 3 scope).
 *
 * When the channel is already Up at StasisStart (the dialplan answers before
 * Stasis() in [from-internal]), answered_at is set here and the row is born
 * CALL_CONNECTED — the later ChannelStateChange(Up) becomes a no-op.
 */
async function insertCall(pool, params) {
  const at = params.startedAt instanceof Date ? params.startedAt : new Date(params.startedAt || Date.now());
  const up = params.channelState === 'Up';
  const state = up ? 'CALL_CONNECTED' : 'CALL_INCOMING';
  const history = appendHistory([], { state, at, source: 'ari', eventId: null });

  const { rows } = await pool.query(
    `INSERT INTO app.calls
       (tenant_id, call_id, channel_id, unique_id, linked_id, exten,
        caller_number, callee_number, state, state_version, state_history,
        started_at, answered_at, direction, whatsapp)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11::jsonb,$12,$13,$14,$15::jsonb)
     ON CONFLICT ON CONSTRAINT calls_tenant_call_unique DO NOTHING
     RETURNING *`,
    [
      params.tenantId,
      params.callId,
      params.channelId,
      params.uniqueId || params.channelId,
      params.linkedId || null,
      params.exten || null,
      params.callerNumber || null,
      params.calleeNumber || null,
      state,
      up ? 2 : 1,
      JSON.stringify(history),
      at.toISOString(),
      up ? at.toISOString() : null,
      params.direction || 'inbound',
      params.whatsapp ? JSON.stringify(params.whatsapp) : null,
    ]
  );

  if (rows[0]) {
    return { inserted: true, row: rows[0] };
  }

  const existing = await findByTenantCallId(pool, params.tenantId, params.callId);
  const replay = existing && existing.channel_id === params.channelId;
  return { inserted: false, row: existing, replay };
}

/**
 * ChannelStateChange (Up): record answered_at (first writer wins), and
 * promote the state to CALL_CONNECTED when the transition is legal
 * (CALL_INCOMING/CALL_ACCEPTED -> CALL_CONNECTED). Later/repeated Up events
 * are no-ops (answered_at IS NULL guard).
 */
async function markAnswered(pool, { channelId, answeredAt }) {
  const at = answeredAt instanceof Date ? answeredAt : new Date(answeredAt || Date.now());
  const entry = appendHistory([], { state: 'CALL_CONNECTED', at, source: 'ari', eventId: null });

  const { rows } = await pool.query(
    `UPDATE app.calls SET
       answered_at = $2,
       state = CASE WHEN state IN ('CALL_INCOMING','CALL_ACCEPTED') THEN 'CALL_CONNECTED' ELSE state END,
       state_version = state_version + CASE WHEN state IN ('CALL_INCOMING','CALL_ACCEPTED') THEN 1 ELSE 0 END,
       state_history = CASE WHEN state IN ('CALL_INCOMING','CALL_ACCEPTED')
                            THEN state_history || $3::jsonb ELSE state_history END,
       updated_at = NOW()
     WHERE channel_id = $1 AND answered_at IS NULL
     RETURNING *`,
    [channelId, at.toISOString(), JSON.stringify(entry)]
  );
  return rows[0] || null;
}

/**
 * ChannelDestroyed: finalize the call. Atomic and idempotent (ended_at IS
 * NULL guard): ended_at, hangup_cause, state=CALL_ENDED, and duration
 * computed in-database as ended_at - COALESCE(answered_at, started_at).
 * Returns {finalized, row}: finalized=false for an unknown channel or an
 * already-finalized call.
 */
async function finalizeCall(pool, { channelId, endedAt, hangupCause }) {
  const at = endedAt instanceof Date ? endedAt : new Date(endedAt || Date.now());
  const entry = appendHistory([], { state: 'CALL_ENDED', at, source: 'ari', eventId: null });

  const { rows } = await pool.query(
    `UPDATE app.calls SET
       state = 'CALL_ENDED',
       state_version = state_version + 1,
       state_history = state_history || $4::jsonb,
       ended_at = $2,
       hangup_cause = $3,
       duration_seconds = GREATEST(0, (EXTRACT(EPOCH FROM ($2::timestamptz - COALESCE(answered_at, started_at))))::int),
       updated_at = NOW()
     WHERE channel_id = $1 AND ended_at IS NULL
     RETURNING *`,
    [channelId, at.toISOString(), hangupCause || null, JSON.stringify(entry)]
  );
  return rows[0] ? { finalized: true, row: rows[0] } : { finalized: false, row: null };
}

async function findByChannelId(pool, channelId) {
  const { rows } = await pool.query('SELECT * FROM app.calls WHERE channel_id = $1', [channelId]);
  return rows[0] || null;
}

async function findByTenantCallId(pool, tenantId, callId) {
  const { rows } = await pool.query(
    'SELECT * FROM app.calls WHERE tenant_id = $1 AND call_id = $2 LIMIT 1',
    [tenantId, callId]
  );
  return rows[0] || null;
}

module.exports = { insertCall, markAnswered, finalizeCall, findByChannelId, findByTenantCallId };
