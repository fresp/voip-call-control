'use strict';

/**
 * Postgres pool wrapper. All queries are schema-qualified to `app` by the
 * callers (calls-store); the pool itself is schema-agnostic.
 */

const { Pool } = require('pg');

function createPool(databaseUrl) {
  const pool = new Pool({
    connectionString: databaseUrl,
    // sslmode is parsed by pg from the connection string itself (RDS:
    // sslmode=require; local docker: no ssl). An explicit ssl option would
    // override the URL and break non-TLS endpoints.
  });
  pool.on('error', (err) => {
    // Idle-client errors must not crash the process.
    console.error('pg pool error:', err.message);
  });
  return pool;
}

async function withTransaction(pool, fn) {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const result = await fn(client);
    await client.query('COMMIT');
    return result;
  } catch (err) {
    try {
      await client.query('ROLLBACK');
    } catch (rollbackErr) {
      console.error('rollback failed:', rollbackErr.message);
    }
    throw err;
  } finally {
    client.release();
  }
}

module.exports = { createPool, withTransaction };
