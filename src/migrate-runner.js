'use strict';

/**
 * Shared node-pg-migrate runner options. Used by the CLI wrapper
 * (scripts/migrate.js) and by the test harness (fresh DB per run).
 *
 * Plain `.sql` files via the `sql` loader strategy (no up/down markers —
 * up-only). Bookkeeping table: public.pgmigrations.
 */

const path = require('path');

const MIGRATIONS_DIR = path.join(__dirname, '..', 'migrations');

function runMigrations({ databaseUrl, direction = 'up' }) {
  // Required here (not top-level) so requiring this module stays cheap for tests.
  const { runner } = require('node-pg-migrate');
  return runner({
    databaseUrl,
    dir: MIGRATIONS_DIR,
    direction,
    migrationsTable: 'pgmigrations',
    migrationsSchema: 'public',
    schema: 'app',
    createSchema: true,
    createMigrationsSchema: true,
    checkOrder: true,
    singleTransaction: false,
    migrationLoaderStrategies: [{ extensions: ['.sql'], loader: 'sql' }],
    log: console.log,
  });
}

module.exports = { runMigrations, MIGRATIONS_DIR };
