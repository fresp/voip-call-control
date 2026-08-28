'use strict';

/**
 * Environment configuration for the ARI call-control service.
 *
 * DATABASE_URL   — Postgres connection string (e.g. postgresql://u:p@h:5432/db?sslmode=require)
 * ARI_URL        — Asterisk ARI base URL (default http://127.0.0.1:8088)
 * ARI_USER       — ARI username
 * ARI_PASS       — ARI password
 * ARI_APP        — Stasis application name (default voip-app; matches
 *                  voip-asterisk/config/extensions.conf `Stasis(${ARI_APP},...)`)
 */

const ARI_APP_DEFAULT = 'voip-app';

function required(name) {
  const value = process.env[name];
  if (!value) {
    throw new Error(`Missing required environment variable: ${name}`);
  }
  return value;
}

function loadConfig() {
  return {
    databaseUrl: required('DATABASE_URL'),
    ariUrl: process.env.ARI_URL || 'http://127.0.0.1:8088',
    ariUser: required('ARI_USER'),
    ariPass: required('ARI_PASS'),
    ariApp: process.env.ARI_APP || ARI_APP_DEFAULT,
  };
}

module.exports = { loadConfig, ARI_APP_DEFAULT };
