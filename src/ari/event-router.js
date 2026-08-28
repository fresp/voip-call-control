'use strict';

/**
 * Single registration point for ARI event listeners. This module is the
 * only place `ari.on(...)` is called — the integration test drives events
 * through it, which is the structural guard against the old service's
 * "wired via DI but never called" defect.
 *
 * Handler errors are caught per-event: one bad event must not detach the
 * listeners or crash the websocket.
 */

const handlers = require('./handlers');

const ROUTES = [
  ['StasisStart', handlers.handleStasisStart],
  ['ChannelStateChange', handlers.handleChannelStateChange],
  ['ChannelDestroyed', handlers.handleChannelDestroyed],
];

/**
 * @param {EventEmitter} ari ari-client instance (or a fake EventEmitter in
 *   tests — contract: .on(event, cb) with (event, channel) callback args)
 * @param {object} deps { pool, log }
 * @returns {Function} detach() removing all listeners.
 */
function registerAriEventHandlers(ari, deps) {
  const wrapped = ROUTES.map(([eventType, handler]) => {
    const wrappedHandler = async (event, channel) => {
      try {
        await handler(event, channel || (event && event.channel), deps);
      } catch (err) {
        deps.log.error('ARI handler failed', {
          eventType,
          channelId: (event && event.channel && event.channel.id) || (channel && channel.id) || null,
          error: err.message,
        });
      }
    };
    ari.on(eventType, wrappedHandler);
    return { eventType, wrappedHandler };
  });
  return function detach() {
    for (const { eventType, wrappedHandler } of wrapped) ari.removeListener(eventType, wrappedHandler);
  };
}

module.exports = { registerAriEventHandlers, ROUTES };
