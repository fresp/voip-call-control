'use strict';

/**
 * Canonical call state machine.
 *
 * States match app.calls.calls_state_check. Transitions mirror the old
 * service (voip-playground/voip-orchestrator): CALL_ACCEPTED is reached via
 * the control API (agent accept), never from ARI events; ChannelStateChange
 * (Up) only records answered_at and promotes CALL_INCOMING -> CALL_CONNECTED.
 */

const ALLOWED_TRANSITIONS = {
  CALL_INCOMING: ['CALL_ACCEPTED', 'CALL_CONNECTED', 'CALL_ENDED'],
  CALL_ACCEPTED: ['CALL_CONNECTED', 'CALL_TRANSFER', 'CALL_ENDED'],
  CALL_CONNECTED: ['CALL_TRANSFER', 'CALL_ENDED'],
  CALL_TRANSFER: ['CALL_CONNECTED', 'CALL_ENDED', 'CALL_TRANSFER'],
  CALL_ENDED: [],
};

const TERMINAL_STATE = 'CALL_ENDED';

/**
 * Whether from -> to is a legal transition.
 */
function isAllowed(from, to) {
  return Boolean(ALLOWED_TRANSITIONS[from] && ALLOWED_TRANSITIONS[from].includes(to));
}

/**
 * Determine the next state implied by an ARI event, or null when the event
 * carries no state change (e.g. ChannelStateChange while ringing).
 */
function stateFromEvent(eventType, channelState) {
  if (eventType === 'StasisStart') return 'CALL_INCOMING';
  if (eventType === 'ChannelStateChange' && channelState === 'Up') return 'CALL_CONNECTED';
  if (eventType === 'ChannelDestroyed') return 'CALL_ENDED';
  return null;
}

/**
 * Append a state_history entry. Pure function; callers persist the result.
 * history: JSONB array of {state, at, source, eventId, metadata}.
 */
function appendHistory(history, entry) {
  const base = Array.isArray(history) ? history : [];
  return base.concat({
    state: entry.state,
    at: entry.at instanceof Date ? entry.at.toISOString() : entry.at,
    source: entry.source || 'ari',
    eventId: entry.eventId || null,
    ...(entry.metadata ? { metadata: entry.metadata } : {}),
  });
}

module.exports = { ALLOWED_TRANSITIONS, TERMINAL_STATE, isAllowed, stateFromEvent, appendHistory };
