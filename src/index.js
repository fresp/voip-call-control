'use strict';

/**
 * Service entrypoint: config -> pg pool -> express HTTP -> ari-client -> event router.
 * HTTP server starts before ARI so provisioning routes are available even if ARI is down.
 * Graceful shutdown: close HTTP, detach listeners, close websocket, end pool.
 */

const express = require('express');
const ari = require('ari-client');
const { loadConfig } = require('./config');
const { createPool } = require('./db');
const log = require('./logger');
const { registerAriEventHandlers } = require('./ari/event-router');
const { createGatewaysRouter } = require('./routes/gateways');

async function main() {
  const config = loadConfig();
  const pool = createPool(config.databaseUrl);
  await pool.query('SELECT 1');
  log.info('database connected');

  // HTTP server: available before ARI connects
  const app = express();
  app.use(express.json());
  app.use('/gateways', createGatewaysRouter(pool));
  const httpServer = app.listen(config.port, () => {
    log.info('HTTP server listening', { port: config.port });
  });

  const client = await ari.connect(config.ariUrl, config.ariUser, config.ariPass);
  const detach = registerAriEventHandlers(client, { pool, log });
  await client.start(config.ariApp);
  log.info('ARI application started', { app: config.ariApp, ariUrl: config.ariUrl });

  const shutdown = async (signal) => {
    log.info('shutting down', { signal });
    httpServer.close();
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
