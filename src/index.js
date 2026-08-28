'use strict';

/**
 * Service entrypoint: config -> pg pool -> ari-client -> event router.
 * Graceful shutdown: detach listeners, close websocket, end pool.
 */

const ari = require('ari-client');
const { loadConfig } = require('./config');
const { createPool } = require('./db');
const log = require('./logger');
const { registerAriEventHandlers } = require('./ari/event-router');

async function main() {
  const config = loadConfig();
  const pool = createPool(config.databaseUrl);
  await pool.query('SELECT 1');
  log.info('database connected');

  const client = await ari.connect(config.ariUrl, config.ariUser, config.ariPass);
  const detach = registerAriEventHandlers(client, { pool, log });
  await client.start(config.ariApp);
  log.info('ARI application started', { app: config.ariApp, ariUrl: config.ariUrl });

  const shutdown = async (signal) => {
    log.info('shutting down', { signal });
    detach();
    try {
      client.stop();
    } catch { /* already stopped */ }
    await pool.end();
    process.exit(0);
  };
  process.on('SIGTERM', () => shutdown('SIGTERM'));
  process.on('SIGINT', () => shutdown('SIGINT'));
}

main().catch((err) => {
  log.error('fatal startup error', { error: err.message });
  process.exit(1);
});
