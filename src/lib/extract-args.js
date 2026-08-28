'use strict';

/**
 * Stasis argument parsing.
 *
 * Dialplan shapes (voip-asterisk/config/extensions.conf):
 *   [from-internal]    Stasis(voip-app, CALL_ID, TENANT_ID, EXTEN, DID_NUMBER)
 *   [from-whatsapp]    Stasis(voip-app, CALL_ID, CORRELATION_ID, TENANT_ID,
 *                            DID_NUMBER, whatsapp, WHATSAPP_SOURCE)
 *   [from-external]    Stasis(voip-app, CALL_ID, TENANT_ID, EXTEN, DID_NUMBER, sip_bridge)
 *
 * WHATSAPP_CALL_ID is `${CHANNEL(pjsip,call-id)}` — a fresh id per SIP dialog,
 * not the linkedid — so call_id is per-leg. tenantId falls back to 'default'
 * exactly as the dialplan does (ExecIf empty -> default).
 */

const WHATSAPP_FLAG = 'whatsapp';
const SIP_BRIDGE_FLAG = 'sip_bridge';

/**
 * @param {string[]} args event.args (may be undefined/empty for legs that
 *   entered Stasis without dialplan args)
 * @param {string} fallbackCallId used when args are absent
 */
function parseStasisArgs(args, fallbackCallId) {
  const list = Array.isArray(args) ? args : [];
  const callId = String(list[0] || fallbackCallId || '').trim();
  const flag = list.find((a) => a === WHATSAPP_FLAG || a === SIP_BRIDGE_FLAG) || null;

  if (flag === WHATSAPP_FLAG) {
    // [callId, correlationId, tenantId, didNumber, 'whatsapp', source]
    return {
      callId,
      correlationId: list[1] || null,
      tenantId: orDefault(list[2]),
      exten: null,
      didNumber: list[3] || null,
      flow: 'whatsapp',
      source: list[5] || null,
      direction: 'inbound',
    };
  }
  if (flag === SIP_BRIDGE_FLAG) {
    // [callId, tenantId, exten, didNumber, 'sip_bridge']
    return {
      callId,
      correlationId: null,
      tenantId: orDefault(list[1]),
      exten: list[2] || null,
      didNumber: list[3] || null,
      flow: 'sip_bridge',
      source: null,
      direction: 'sip_bridge',
    };
  }
  // from-internal or arg-less channel: [callId, tenantId, exten, didNumber]
  return {
    callId,
    correlationId: null,
    tenantId: orDefault(list[1]),
    exten: list[2] || null,
    didNumber: list[3] || null,
    flow: 'internal',
    source: null,
    direction: 'inbound',
  };
}

function orDefault(value) {
  const trimmed = String(value || '').trim();
  return trimmed || 'default';
}

module.exports = { parseStasisArgs, WHATSAPP_FLAG, SIP_BRIDGE_FLAG };
