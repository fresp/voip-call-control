'use strict';

/**
 * WhatsApp header extraction from ARI channel variables.
 *
 * The dialplan ([from-whatsapp]) captures Meta's six x-wa-meta-* SIP headers
 * into channel variables WA_META_WACID / WA_META_USER_ID / WA_META_PARENT_USER_ID
 * / WA_META_USERNAME / WA_META_CTA_PAYLOAD / WA_META_DEEPLINK_PAYLOAD and the
 * ARI app reads them via the channel-variable API — never as Stasis args
 * (cta-payload/deeplink-payload have no comma-safety guarantee and Stasis()
 * splits args on commas).
 *
 * Failure semantics (the defect the old service never implemented):
 * - wacid is documented as unconditional on a user-initiated INVITE and is
 *   read unconditionally. A missing var surfaces as an EMPTY STRING (Asterisk
 *   dialplan substitution), while an ARI failure (connection refused, 401,
 *   channel gone) REJECTS the promise. The two cases are distinguishable and
 *   are treated differently: empty -> warn + persist whatsapp.wacid=null;
 *   ARI error -> log error with kind ('auth'|'connection'|'unknown') and
 *   rethrow — call setup must not silently proceed without the CDR
 *   correlation key.
 * - The other five headers are conditionally present per Meta's docs; a
 *   missing var or a failed read both degrade to null (guarded at capture
 *   time by PJSIP_HEADERS() existence checks in the dialplan).
 */

const WA_META_VARS = [
  { key: 'wacid', variable: 'WA_META_WACID', required: true },
  { key: 'user_id', variable: 'WA_META_USER_ID', required: false },
  { key: 'parent_user_id', variable: 'WA_META_PARENT_USER_ID', required: false },
  { key: 'username', variable: 'WA_META_USERNAME', required: false },
  { key: 'cta_payload', variable: 'WA_META_CTA_PAYLOAD', required: false },
  { key: 'deeplink_payload', variable: 'WA_META_DEEPLINK_PAYLOAD', required: false },
];

function classifyAriError(err) {
  const msg = String((err && err.message) || '').toLowerCase();
  const status = err && (err.status || err.statusCode);
  if (status === 401 || status === 403 || msg.includes('401') || msg.includes('403') || msg.includes('unauthorized')) {
    return 'auth';
  }
  if (
    (err && (err.code === 'ECONNREFUSED' || err.code === 'ECONNRESET' || err.code === 'ETIMEDOUT')) ||
    msg.includes('econnrefused') ||
    msg.includes('socket hang up') ||
    msg.includes('getaddrinfo')
  ) {
    return 'connection';
  }
  return 'unknown';
}

/**
 * Read the six WA_META_* channel variables.
 * @param {object} channel ari-client channel (getChannelVar bound)
 * @param {object} log {info, warn, error}
 * @returns {Promise<object|null>} whatsapp JSONB payload, or null when the
 *   channel is gone before variables can be read.
 */
async function extractWhatsapp(channel, log) {
  const whatsapp = {};
  for (const { key, variable, required } of WA_META_VARS) {
    let value = null;
    let readError = null;
    try {
      const result = await channel.getChannelVar({ variable });
      value = result && result.value != null ? String(result.value).trim() : '';
    } catch (err) {
      readError = err;
    }

    if (readError) {
      if (isChannelGone(readError)) {
        // Channel hung up mid-setup; nothing to correlate anymore.
        log.warn('channel gone while reading WA_META vars — skipping call setup', {
          channelId: channel.id,
          variable,
        });
        return null;
      }
      const kind = classifyAriError(readError);
      log.error('ARI channel-variable read failed', {
        channelId: channel.id,
        variable,
        kind,
        error: readError.message,
      });
      if (required) {
        // ARI connection/auth failure — NOT the same as "header absent".
        readError.ariFailureKind = kind;
        throw readError;
      }
      continue; // optional header: degrade to null
    }

    if (required && !value) {
      // Header absent (dialplan substitutes empty) — warn, persist null,
      // continue. Distinguishable from the auth/connection failure above.
      log.warn('wacid missing on whatsapp call — webhook correlation will be impossible', {
        channelId: channel.id,
      });
    }
    whatsapp[key] = value || null;
  }
  return whatsapp;
}

function isChannelGone(err) {
  const msg = String((err && err.message) || '').toLowerCase();
  const status = err && (err.status || err.statusCode);
  return status === 404 || msg.includes('404') || msg.includes('channel not found');
}

module.exports = { extractWhatsapp, classifyAriError, WA_META_VARS };
