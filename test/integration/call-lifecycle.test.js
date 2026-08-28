'use strict';

/**
 * Integration test: full call lifecycle through the REAL event router —
 * StasisStart -> ChannelStateChange(Up) -> ChannelDestroyed — against real
 * Postgres, asserting the resulting app.calls row. This is the guard against
 * the old service's "handlers wired via DI but never called" defect: events
 * are driven through registerAriEventHandlers' registered callbacks, the
 * only registration point in the codebase.
 *
 * ARI layer: fake EventEmitter (chosen in Phase 2 planning). ari-client is a
 * thin typed wrapper over emitted JSON, so driving realistic Asterisk event
 * objects into the registered callbacks exercises the identical contract;
 * the live-Asterisk exercise stays in the acceptance checklist.
 *
 * DB: a dedicated throwaway DATABASE (phase2_test_<runid>) is created from
 * the maintenance connection in DATABASE_URL, migrations are applied by the
 * REAL CLI (`node scripts/migrate.js up` — same path ops uses), and the
 * database is dropped at teardown. No SQL rewriting, no schema aliasing.
 */

const { EventEmitter } = require('events');
const { spawn } = require('child_process');
const path = require('path');
const { Pool } = require('pg');
const { registerAriEventHandlers } = require('../../src/ari/event-router');
const log = require('../../src/logger');

jest.setTimeout(60000);

let pool;
let dbName;
let adminPool;
let detach;
let fakeAri;


// --- helpers ---------------------------------------------------------------

function makeChannel(overrides = {}) {
  return {
    id: overrides.id || `ch-${Math.random().toString(36).slice(2, 10)}`,
    state: overrides.state || 'Down',
    dialplan: overrides.dialplan || { exten: '6281234567890' },
    caller: overrides.caller || { number: '+61200' },
    getChannelVar: overrides.getChannelVar,
  };
}

function stasisStartEvent(args, extra = {}) {
  return {
    type: 'StasisStart',
    args,
    timestamp: extra.timestamp || new Date('2026-08-28T10:00:00Z'),
    channel: null,
  };
}

function stateChangeEvent(state, timestamp) {
  return {
    type: 'ChannelStateChange',
    channel_state: state,
    timestamp: timestamp || new Date('2026-08-28T10:00:05Z'),
  };
}

function destroyedEvent(timestamp, cause, causeTxt) {
  return {
    type: 'ChannelDestroyed',
    timestamp: timestamp || new Date('2026-08-28T10:00:10Z'),
    cause: cause != null ? cause : 16,
    cause_txt: causeTxt || 'Normal Clearing',
  };
}

// Event-shapes from Asterisk carry `channel`; the router also accepts it as
// a separate arg (ari-client passes both). We emit (event, channel).
function emitStasisStart(args, channel, extra) {
  const event = stasisStartEvent(args, extra);
  fakeAri.emit('StasisStart', event, channel);
  return event;
}

async function settle(ms = 50) {
  await new Promise((r) => setTimeout(r, ms));
}

async function rowByChannelId(channelId) {
  const { rows } = await pool.query('SELECT * FROM app.calls WHERE channel_id = $1', [channelId]);
  return rows[0] || null;
}


// --- harness ---------------------------------------------------------------

function dbUrlFor(name) {
  const u = new URL(process.env.DATABASE_URL);
  u.pathname = `/${name}`;
  return u.toString();
}

function runMigrateCli(databaseUrl) {
  return new Promise((resolve, reject) => {
    const proc = spawn(process.execPath, [path.join(__dirname, '..', '..', 'scripts', 'migrate.js'), 'up'], {
      env: { ...process.env, DATABASE_URL: databaseUrl },
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    let out = '';
    proc.stdout.on('data', (d) => (out += d));
    proc.stderr.on('data', (d) => (out += d));
    proc.on('close', (code) => (code === 0 ? resolve(out) : reject(new Error(`migrate CLI exited ${code}:\n${out}`))));
  });
}

beforeAll(async () => {
  if (!process.env.DATABASE_URL) {
    throw new Error('DATABASE_URL is required for the Phase 2 integration test');
  }
  dbName = `phase2_test_${Date.now()}_${process.pid}`;
  adminPool = new Pool({ connectionString: process.env.DATABASE_URL, max: 1 });
  await adminPool.query(`CREATE DATABASE ${dbName}`);

  const testDbUrl = dbUrlFor(dbName);
  await runMigrateCli(testDbUrl); // the REAL migration path

  pool = new Pool({ connectionString: testDbUrl });
  fakeAri = new EventEmitter();
  detach = registerAriEventHandlers(fakeAri, { pool, log });
});

afterAll(async () => {
  if (detach) detach();
  if (pool) await pool.end();
  if (adminPool) {
    await adminPool.query(`DROP DATABASE IF EXISTS ${dbName} WITH (FORCE)`);
    await adminPool.end();
  }
});


// --- tests -----------------------------------------------------------------

describe('ARI call lifecycle integration', () => {
  test('happy path: StasisStart -> Up -> Destroyed finalizes the calls row', async () => {
    const channel = makeChannel({
      getChannelVar: async ({ variable }) => ({
        value:
          {
            WA_META_WACID: 'wacid.HAPPY.001',
            WA_META_USER_ID: '491234567890',
            WA_META_PARENT_USER_ID: '491234567891',
            WA_META_USERNAME: 'test-user@example.com',
            WA_META_CTA_PAYLOAD: 'cta-abc',
            WA_META_DEEPLINK_PAYLOAD: 'deeplink-xyz',
          }[variable] || '',
      }),
    });

    emitStasisStart(
      ['wa-call-001', 'wa-call-001', 'tenant-a', '6281234567890', 'whatsapp', 'wa.meta.vc'],
      channel
    );
    await settle();

    let row = await rowByChannelId(channel.id);
    expect(row).toBeTruthy();
    expect(row.state).toBe('CALL_INCOMING');
    expect(row.tenant_id).toBe('tenant-a');
    expect(row.call_id).toBe('wa-call-001');
    expect(row.answered_at).toBeNull();
    expect(row.whatsapp).toEqual({
      wacid: 'wacid.HAPPY.001',
      user_id: '491234567890',
      parent_user_id: '491234567891',
      username: 'test-user@example.com',
      cta_payload: 'cta-abc',
      deeplink_payload: 'deeplink-xyz',
    });

    fakeAri.emit('ChannelStateChange', stateChangeEvent('Up'), channel);
    await settle();

    row = await rowByChannelId(channel.id);
    expect(row.state).toBe('CALL_CONNECTED');
    expect(row.answered_at).toEqual(new Date('2026-08-28T10:00:05Z'));
    expect(row.state_history.map((h) => h.state)).toEqual(['CALL_INCOMING', 'CALL_CONNECTED']);

    fakeAri.emit('ChannelDestroyed', destroyedEvent(), channel);
    await settle();

    row = await rowByChannelId(channel.id);
    expect(row.state).toBe('CALL_ENDED');
    expect(row.ended_at).toEqual(new Date('2026-08-28T10:00:10Z'));
    expect(row.hangup_cause).toBe('Normal Clearing');
    // 10:00:05 -> 10:00:10
    expect(row.duration_seconds).toBe(5);
    expect(row.state_history.map((h) => h.state)).toEqual([
      'CALL_INCOMING',
      'CALL_CONNECTED',
      'CALL_ENDED',
    ]);
  });

  test('answered-before-Stasis (from-internal): row born CALL_CONNECTED with answered_at', async () => {
    const channel = makeChannel({ state: 'Up' }); // no whatsapp vars — internal flow
    emitStasisStart(['int-call-001', 'tenant-a', '1001', '1001'], channel);
    await settle();

    const row = await rowByChannelId(channel.id);
    expect(row).toBeTruthy();
    expect(row.state).toBe('CALL_CONNECTED');
    expect(row.answered_at).not.toBeNull();
    expect(row.whatsapp).toBeNull();
    expect(row.state_history.map((h) => h.state)).toEqual(['CALL_CONNECTED']);
  });

  test('missing optional WA_META vars degrade to null; missing wacid persists null wacid', async () => {
    const channel = makeChannel({
      getChannelVar: async ({ variable }) => ({
        value: { WA_META_WACID: '' }[variable] || '',
      }),
    });
    emitStasisStart(['wa-call-002', 'wa-call-002', 'tenant-a', '628123', 'whatsapp', 'wa.meta.vc'], channel);
    await settle();

    const row = await rowByChannelId(channel.id);
    expect(row).toBeTruthy();
    expect(row.whatsapp).toEqual({
      wacid: null,
      user_id: null,
      parent_user_id: null,
      username: null,
      cta_payload: null,
      deeplink_payload: null,
    });
  });

  test('ARI auth failure reading wacid propagates as handler error (distinct from missing header)', async () => {
    const channel = makeChannel({
      getChannelVar: async () => {
        const err = new Error('Unauthorized');
        err.status = 401;
        throw err;
      },
    });
    emitStasisStart(['wa-call-003', 'wa-call-003', 'tenant-a', '628123', 'whatsapp', 'wa.meta.vc'], channel);
    await settle();

    // Router catches per-event; the row must NOT exist — and the failure was
    // an ARI error, not a silent null.
    const row = await rowByChannelId(channel.id);
    expect(row).toBeNull();
  });

  test('duplicate StasisStart for the same channel is an idempotent no-op', async () => {
    const channel = makeChannel();
    const args = ['dup-call-001', 'tenant-a', '1002', '1002'];
    emitStasisStart(args, channel);
    await settle();
    emitStasisStart(args, channel);
    await settle();

    const { rows } = await pool.query('SELECT COUNT(*)::int AS n FROM app.calls WHERE channel_id = $1', [channel.id]);
    expect(rows[0].n).toBe(1);
  });

  test('repeated ChannelStateChange(Up) and double ChannelDestroyed are idempotent', async () => {
    const channel = makeChannel();
    emitStasisStart(['idem-call-001', 'tenant-a', '1003', '1003'], channel);
    await settle();
    fakeAri.emit('ChannelStateChange', stateChangeEvent('Up', new Date('2026-08-28T11:00:05Z')), channel);
    await settle();
    fakeAri.emit('ChannelStateChange', stateChangeEvent('Up', new Date('2026-08-28T11:00:07Z')), channel);
    await settle();
    fakeAri.emit('ChannelDestroyed', destroyedEvent(new Date('2026-08-28T11:00:10Z')), channel);
    await settle();
    fakeAri.emit('ChannelDestroyed', destroyedEvent(new Date('2026-08-28T11:00:12Z')), channel);
    await settle();

    const row = await rowByChannelId(channel.id);
    expect(row.answered_at).toEqual(new Date('2026-08-28T11:00:05Z')); // first writer wins
    expect(row.ended_at).toEqual(new Date('2026-08-28T11:00:10Z')); // first finalize wins
    expect(row.duration_seconds).toBe(5);
  });

  test('out-of-order: ChannelDestroyed for a channel with no calls row is skipped, no orphan', async () => {
    const channel = makeChannel({ id: 'ch-never-started' });
    fakeAri.emit('ChannelDestroyed', destroyedEvent(), channel);
    await settle();

    const { rows } = await pool.query('SELECT COUNT(*)::int AS n FROM app.calls WHERE channel_id = $1', [channel.id]);
    expect(rows[0].n).toBe(0);
  });

  test('out-of-order: Destroyed-before-Up still finalizes from started_at', async () => {
    const channel = makeChannel();
    emitStasisStart(['ooo-call-001', 'tenant-a', '1004', '1004'], channel);
    await settle();
    // Destroyed at 10:00:03, never answered (StasisStart default ts 10:00:00).
    fakeAri.emit('ChannelDestroyed', destroyedEvent(new Date('2026-08-28T10:00:03Z'), 17, 'User busy'), channel);
    await settle();

    const row = await rowByChannelId(channel.id);
    expect(row.state).toBe('CALL_ENDED');
    expect(row.hangup_cause).toBe('User busy');
    expect(row.answered_at).toBeNull();
    // duration from started_at (10:00:00) -> ended (10:00:03) = 3s
    expect(row.duration_seconds).toBe(3);
    expect(row.state_history.map((h) => h.state)).toEqual(['CALL_INCOMING', 'CALL_ENDED']);
  });
});

describe('schema invariants', () => {
  test('calls table exists with Phase 1 constraints plus duration_seconds', async () => {
    const { rows } = await pool.query(
      `SELECT column_name FROM information_schema.columns
       WHERE table_schema = 'app' AND table_name = 'calls'`
    );
    const cols = rows.map((r) => r.column_name);
    expect(cols).toEqual(expect.arrayContaining(['duration_seconds', 'whatsapp', 'state_history', 'answered_at']));
  });
});
