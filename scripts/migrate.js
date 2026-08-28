#!/usr/bin/env node
'use strict';

/**
 * Thin wrapper around node-pg-migrate's programmatic runner.
 *
 * Plain `.sql` migration files are loaded via the `sql` loader strategy
 * (files without `-- Up Migration` / `-- Down Migration` markers run their
 * entire content as the `up` action; down is not supported).
 *
 * Connection: DATABASE_URL env var (required).
 *   e.g. postgresql://user:pass@host:5432/db?sslmode=require
 *
 * Usage:
 *   node scripts/migrate.js up
 *   node scripts/migrate.js down
 */

const { runMigrations } = require('../src/migrate-runner');

const direction = process.argv[2] || 'up';
if (!['up', 'down'].includes(direction)) {
  console.error(`Unknown direction "${direction}". Use: up | down`);
  process.exit(1);
}

const databaseUrl = process.env.DATABASE_URL;
if (!databaseUrl) {
  console.error('DATABASE_URL is required (e.g. postgresql://user:pass@host:5432/db)');
  process.exit(1);
}

runMigrations({ databaseUrl, direction })
  .then(() => {
    console.log(`Migration ${direction} complete.`);
  })
  .catch((err) => {
    console.error(`Migration ${direction} failed:`, err.message);
    if (process.env.MIGRATE_DEBUG) {
      console.error(err.stack);
    }
    process.exitCode = 1;
  });
