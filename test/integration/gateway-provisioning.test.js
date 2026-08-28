'use strict';

/**
 * Integration test: gateway provisioning writes to app.gateways AND the four
 * Asterisk realtime tables (ps_endpoints, ps_auths, ps_aors,
 * ps_endpoint_id_ips) in one atomic transaction.
 *
 * Same harness pattern as call-lifecycle.test.js: throwaway database, real
 * migrations via CLI, real pg Pool. Additionally applies a minimal asterisk
 * schema fixture for the four ps_* target tables.
 */

const { spawn } = require('child_process');
const path = require('path');
const { Pool } = require('pg');
const { provisionGateway, deprovisionGateway, findGateway } = require('../../src/gateways-store');

jest.setTimeout(60000);

let pool;
let dbName;
let adminPool;

// --- minimal asterisk schema fixture ----------------------------------------
// VARCHAR everywhere instead of ENUMs — sufficient for provisioning tests.
// Includes the ALTER-added columns: media_use_received_transport, tenantid,
// match_request_uri, match_header.

const ASTERISK_DDL = `
CREATE SCHEMA IF NOT EXISTS asterisk;

CREATE TABLE asterisk.ps_endpoints (
    id VARCHAR(40) NOT NULL UNIQUE,
    transport VARCHAR(40),
    aors VARCHAR(200),
    auth VARCHAR(40),
    context VARCHAR(40),
    disallow VARCHAR(200),
    allow VARCHAR(200),
    direct_media VARCHAR(10),
    force_rport VARCHAR(10),
    identify_by VARCHAR(40),
    outbound_auth VARCHAR(40),
    rewrite_contact VARCHAR(10),
    rtp_symmetric VARCHAR(10),
    send_pai VARCHAR(10),
    trust_id_inbound VARCHAR(10),
    timers VARCHAR(20),
    "100rel" VARCHAR(10),
    media_encryption VARCHAR(20),
    media_encryption_optimistic VARCHAR(10),
    from_domain VARCHAR(40),
    from_user VARCHAR(40),
    rtcp_mux VARCHAR(10),
    media_use_received_transport VARCHAR(10),
    tenantid VARCHAR(80)
);

CREATE TABLE asterisk.ps_auths (
    id VARCHAR(40) NOT NULL UNIQUE,
    auth_type VARCHAR(20),
    username VARCHAR(40),
    password VARCHAR(80)
);

CREATE TABLE asterisk.ps_aors (
    id VARCHAR(40) NOT NULL UNIQUE,
    contact VARCHAR(255),
    max_contacts INTEGER
);

CREATE TABLE asterisk.ps_endpoint_id_ips (
    id VARCHAR(40) NOT NULL UNIQUE,
    endpoint VARCHAR(40),
    match VARCHAR(80),
    match_header VARCHAR(255),
    match_request_uri VARCHAR(255)
);
`;

// --- helpers ----------------------------------------------------------------

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
    proc.stdout.on('data', (d) => { out += d; });
    proc.stderr.on('data', (d) => { out += d; });
    proc.on('close', (code) => (code === 0 ? resolve(out) : reject(new Error(`migrate CLI exited ${code}:\n${out}`))));
  });
}

const GW = {
  tenantId: 'tenant-a',
  gatewayId: 'wa-meta',
  name: 'Meta SIP',
  provider: 'whatsapp_sip',
  host: 'wa.meta.vc',
  username: '6281234567890',
  password: 'secret',
  fromUser: '6281234567890',
  port: 5061,
  transport: 'tls',
};

// --- harness ----------------------------------------------------------------

beforeAll(async () => {
  if (!process.env.DATABASE_URL) {
    throw new Error('DATABASE_URL is required for the gateway provisioning integration test');
  }
  dbName = `gw_test_${Date.now()}_${process.pid}`;
  adminPool = new Pool({ connectionString: process.env.DATABASE_URL, max: 1 });
  await adminPool.query(`CREATE DATABASE ${dbName}`);

  const testDbUrl = dbUrlFor(dbName);

  // Apply app migrations (creates app schema + tables including app.gateways)
  await runMigrateCli(testDbUrl);

  // Apply minimal asterisk schema fixture (creates asterisk.ps_* tables)
  const testPool = new Pool({ connectionString: testDbUrl, max: 1 });
  await testPool.query(ASTERISK_DDL);
  await testPool.end();

  pool = new Pool({ connectionString: testDbUrl });
});

afterAll(async () => {
  if (pool) await pool.end();
  if (adminPool) {
    await adminPool.query(`DROP DATABASE IF EXISTS ${dbName} WITH (FORCE)`);
    await adminPool.end();
  }
});

// --- tests -----------------------------------------------------------------

describe('Gateway provisioning integration', () => {

  test('happy path: provisions all five tables correctly', async () => {
    const row = await provisionGateway(pool, GW);

    // 1. app.gateways row
    expect(row).toBeTruthy();
    expect(row.tenant_id).toBe(GW.tenantId);
    expect(row.gateway_id).toBe(GW.gatewayId);
    expect(row.name).toBe(GW.name);
    expect(row.provider).toBe(GW.provider);
    expect(row.host).toBe(GW.host);
    expect(row.username).toBe(GW.username);
    expect(row.from_user).toBe(GW.fromUser);
    expect(row.port).toBe(GW.port);
    expect(row.transport).toBe(GW.transport);

    // 2. ps_aors
    const aor = await pool.query('SELECT * FROM asterisk.ps_aors WHERE id = $1', [GW.gatewayId]);
    expect(aor.rows[0]).toBeTruthy();
    expect(aor.rows[0].contact).toBe(`sip:${GW.host}`);
    expect(aor.rows[0].max_contacts).toBe(10);

    // 3. ps_auths
    const auth = await pool.query('SELECT * FROM asterisk.ps_auths WHERE id = $1', [`${GW.gatewayId}-auth`]);
    expect(auth.rows[0]).toBeTruthy();
    expect(auth.rows[0].auth_type).toBe('userpass');
    expect(auth.rows[0].username).toBe(GW.username);
    expect(auth.rows[0].password).toBe(GW.password);

    // 4. ps_endpoints — verify key field values
    const ep = await pool.query('SELECT * FROM asterisk.ps_endpoints WHERE id = $1', [GW.gatewayId]);
    expect(ep.rows[0]).toBeTruthy();
    expect(ep.rows[0].transport).toBe('transport-tls');
    expect(ep.rows[0].context).toBe('from-whatsapp');
    expect(ep.rows[0].disallow).toBe('all');
    expect(ep.rows[0].allow).toBe('opus');
    expect(ep.rows[0].aors).toBe(GW.gatewayId);
    expect(ep.rows[0].outbound_auth).toBe(`${GW.gatewayId}-auth`);
    expect(ep.rows[0].from_user).toBe(GW.username);
    expect(ep.rows[0].from_domain).toBe(GW.host);
    expect(ep.rows[0].rewrite_contact).toBe('no');
    expect(ep.rows[0].media_encryption).toBe('sdes');
    expect(ep.rows[0].direct_media).toBe('no');
    expect(ep.rows[0].rtp_symmetric).toBe('yes');
    expect(ep.rows[0].force_rport).toBe('yes');
    expect(ep.rows[0].media_use_received_transport).toBe('yes');
    expect(ep.rows[0].rtcp_mux).toBe('yes');
    expect(ep.rows[0].media_encryption_optimistic).toBe('no');
    expect(ep.rows[0].identify_by).toBe('ip');
    expect(ep.rows[0].trust_id_inbound).toBe('yes');
    expect(ep.rows[0].send_pai).toBe('yes');
    expect(ep.rows[0]['100rel']).toBe('no');
    expect(ep.rows[0].timers).toBe('no');
    expect(ep.rows[0].tenantid).toBe(GW.tenantId);

    // 5. ps_endpoint_id_ips — match_request_uri present, match_header ABSENT
    const idIp = await pool.query('SELECT * FROM asterisk.ps_endpoint_id_ips WHERE id = $1', [`${GW.gatewayId}-identify`]);
    expect(idIp.rows[0]).toBeTruthy();
    expect(idIp.rows[0].endpoint).toBe(GW.gatewayId);
    expect(idIp.rows[0].match_request_uri).toBe(`^sip:\\+?${GW.username}@`);
    expect(idIp.rows[0].match_header).toBeNull();
  });

  test('idempotent re-provision: second call returns 200, rows still singular', async () => {
    // First provision
    const first = await provisionGateway(pool, GW);

    // Second provision — same gateway, same tenant
    const second = await provisionGateway(pool, GW);
    // Should be the same row (updated_at bumped by ON CONFLICT DO UPDATE)
    expect(second.id).toBe(first.id);

    // Verify no duplicate rows in any table
    const gwCount = await pool.query(
      'SELECT COUNT(*) FROM app.gateways WHERE tenant_id = $1 AND gateway_id = $2',
      [GW.tenantId, GW.gatewayId]
    );
    expect(parseInt(gwCount.rows[0].count)).toBe(1);

    const aorCount = await pool.query('SELECT COUNT(*) FROM asterisk.ps_aors WHERE id = $1', [GW.gatewayId]);
    expect(parseInt(aorCount.rows[0].count)).toBe(1);

    const authCount = await pool.query('SELECT COUNT(*) FROM asterisk.ps_auths WHERE id = $1', [`${GW.gatewayId}-auth`]);
    expect(parseInt(authCount.rows[0].count)).toBe(1);

    const epCount = await pool.query('SELECT COUNT(*) FROM asterisk.ps_endpoints WHERE id = $1', [GW.gatewayId]);
    expect(parseInt(epCount.rows[0].count)).toBe(1);

    const idIpCount = await pool.query('SELECT COUNT(*) FROM asterisk.ps_endpoint_id_ips WHERE id = $1', [`${GW.gatewayId}-identify`]);
    expect(parseInt(idIpCount.rows[0].count)).toBe(1);
  });

  test('forced mid-transaction failure rolls back ALL five tables', async () => {
    // Force a failure by using a gatewayId that exceeds VARCHAR(40) —
    // this will fail on the ps_endpoints INSERT (step 4 of 5),
    // after ps_aors and ps_auths were already inserted in the same transaction.
    // The transaction rollback should undo all prior inserts.
    const badGw = {
      ...GW,
      gatewayId: 'x'.repeat(41), // exceeds VARCHAR(40) in ps_endpoints.id
    };

    await expect(provisionGateway(pool, badGw)).rejects.toThrow();

    // Verify ZERO rows in ALL five tables for this gateway_id
    const gwCount = await pool.query(
      'SELECT COUNT(*) FROM app.gateways WHERE gateway_id = $1',
      [badGw.gatewayId]
    );
    expect(parseInt(gwCount.rows[0].count)).toBe(0);

    const aorCount = await pool.query('SELECT COUNT(*) FROM asterisk.ps_aors WHERE id = $1', [badGw.gatewayId]);
    expect(parseInt(aorCount.rows[0].count)).toBe(0);

    const authCount = await pool.query('SELECT COUNT(*) FROM asterisk.ps_auths WHERE id = $1', [`${badGw.gatewayId}-auth`]);
    expect(parseInt(authCount.rows[0].count)).toBe(0);

    const epCount = await pool.query('SELECT COUNT(*) FROM asterisk.ps_endpoints WHERE id = $1', [badGw.gatewayId]);
    expect(parseInt(epCount.rows[0].count)).toBe(0);

    const idIpCount = await pool.query('SELECT COUNT(*) FROM asterisk.ps_endpoint_id_ips WHERE id = $1', [`${badGw.gatewayId}-identify`]);
    expect(parseInt(idIpCount.rows[0].count)).toBe(0);
  });

  test('deprovision: removes all five tables for the gateway', async () => {
    // Ensure provisioned
    await provisionGateway(pool, GW);

    // Deprovision
    const result = await deprovisionGateway(pool, { tenantId: GW.tenantId, gatewayId: GW.gatewayId });
    expect(result.deleted).toBe(1);

    // Verify all five tables empty for this gateway
    const gw = await pool.query(
      'SELECT COUNT(*) FROM app.gateways WHERE tenant_id = $1 AND gateway_id = $2',
      [GW.tenantId, GW.gatewayId]
    );
    expect(parseInt(gw.rows[0].count)).toBe(0);

    const aor = await pool.query('SELECT COUNT(*) FROM asterisk.ps_aors WHERE id = $1', [GW.gatewayId]);
    expect(parseInt(aor.rows[0].count)).toBe(0);

    const auth = await pool.query('SELECT COUNT(*) FROM asterisk.ps_auths WHERE id = $1', [`${GW.gatewayId}-auth`]);
    expect(parseInt(auth.rows[0].count)).toBe(0);

    const ep = await pool.query('SELECT COUNT(*) FROM asterisk.ps_endpoints WHERE id = $1', [GW.gatewayId]);
    expect(parseInt(ep.rows[0].count)).toBe(0);

    const idIp = await pool.query('SELECT COUNT(*) FROM asterisk.ps_endpoint_id_ips WHERE id = $1', [`${GW.gatewayId}-identify`]);
    expect(parseInt(idIp.rows[0].count)).toBe(0);
  });

  test('findGateway returns null for missing gateway', async () => {
    const result = await findGateway(pool, { tenantId: 'nonexistent', gatewayId: 'nonexistent' });
    expect(result).toBeNull();
  });
});
