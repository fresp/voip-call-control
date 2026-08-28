'use strict';

/**
 * ARI event handlers. Each handler is a pure(ish) function of (event,
 * channel, deps) — no module state — so tests drive them exactly as the
 * router does, and the "wired but never called" defect of the old service
 * is structurally impossible: the router is the ONLY registration point and
 * the integration test goes through it.
 */

const { parseStasisArgs } = require('../lib/extract-args');
const { extractWhatsapp } = require('../lib/extract-whatsapp');
const callsStore = require('../calls-store');

/**
 * StasisStart: create the calls row.
 * - Parses the dialplan arg list.
 * - For whatsapp-flow channels, reads the six WA_META_* channel variables
 *   (wacid unconditional; ARI failures rethrown — see extract-whatsapp).
 * - Channel already Up at entry (dialplan answered pre-Stasis) -> row is
 *   born CALL_CONNECTED with answered_at set.
 * - Duplicate StasisStart for the same channel is a logged no-op.
 */
async function handleStasisStart(event, channel, deps) {
  const { pool, log } = deps;
  const parsed = parseStasisArgs(event.args, channel && channel.id);

  let whatsapp = null;
  if (parsed.flow === 'whatsapp') {
    whatsapp = await extractWhatsapp(channel, log);
    if (!whatsapp) return { ok: false, reason: 'channel_destroyed_early' };
  }

  const result = await callsStore.insertCall(pool, {
    tenantId: parsed.tenantId,
    callId: parsed.callId,
    channelId: channel.id,
    uniqueId: channel.id,
    linkedId: (channel.dialplan && channel.dialplan.linkedid) || null,
    exten: parsed.exten || (channel.dialplan && channel.dialplan.exten) || null,
    callerNumber: (channel.caller && channel.caller.number) || null,
    calleeNumber: parsed.didNumber,
    channelState: channel.state,
    direction: parsed.direction,
    whatsapp,
    startedAt: (event.timestamp && new Date(event.timestamp)) || new Date(),
  });

  if (!result.inserted) {
    if (result.replay) {
      log.warn('duplicate StasisStart ignored', { channelId: channel.id, callId: parsed.callId });
    } else {
      // Different channel reusing the call id (B-leg scenario, Phase 3 scope).
      log.warn('call_id collision — row not inserted', {
        channelId: channel.id,
        callId: parsed.callId,
        tenantId: parsed.tenantId,
      });
    }
  }
  log.info('StasisStart', {
    channelId: channel.id,
    callId: parsed.callId,
    tenantId: parsed.tenantId,
    flow: parsed.flow,
    state: result.inserted ? result.row.state : 'existing',
    wacid: whatsapp ? whatsapp.wacid : undefined,
  });
  return { ok: true, ...result };
}

/**
 * ChannelStateChange (Up): answered_at (first-writer-wins) + state
 * promotion. Non-Up states are ignored (old-service semantics).
 */
async function handleChannelStateChange(event, channel, deps) {
  const { pool, log } = deps;
  if (event.channel_state !== 'Up') {
    log.debug('ChannelStateChange ignored', { channelId: channel.id, state: event.channel_state });
    return { ok: true, ignored: true };
  }
  const row = await callsStore.markAnswered(pool, {
    channelId: channel.id,
    answeredAt: (event.timestamp && new Date(event.timestamp)) || new Date(),
  });
  if (row) {
    log.info('call answered', { channelId: channel.id, callId: row.call_id, answeredAt: row.answered_at });
  } else {
    log.debug('answered_at already set or no row — no-op', { channelId: channel.id });
  }
  return { ok: true, row };
}

/**
 * ChannelDestroyed: finalize ended_at / hangup_cause / duration_seconds and
 * move to CALL_ENDED. Unknown channel (e.g. leg that never entered our app)
 * -> logged and skipped; repeat destroy -> no-op.
 */
async function handleChannelDestroyed(event, channel, deps) {
  const { pool, log } = deps;
  const cause = event.cause_txt || event.cause || 'unknown';
  const result = await callsStore.finalizeCall(pool, {
    channelId: channel.id,
    endedAt: (event.timestamp && new Date(event.timestamp)) || new Date(),
    hangupCause: String(cause),
  });
  if (result.finalized) {
    log.info('call ended', {
      channelId: channel.id,
      callId: result.row.call_id,
      hangupCause: result.row.hangup_cause,
      durationSeconds: result.row.duration_seconds,
    });
  } else {
    const existing = await callsStore.findByChannelId(pool, channel.id);
    if (!existing) {
      log.debug('ChannelDestroyed for unknown channel — skipped', { channelId: channel.id });
    } else {
      log.debug('call already finalized — no-op', { channelId: channel.id });
    }
  }
  return result;
}

module.exports = { handleStasisStart, handleChannelStateChange, handleChannelDestroyed };
