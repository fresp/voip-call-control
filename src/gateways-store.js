'use strict';

/**
 * Data access for gateway provisioning. Writes to app.gateways AND the
 * Asterisk realtime tables (ps_endpoints, ps_auths, ps_aors,
 * ps_endpoint_id_ips) in a single Postgres transaction.
 *
 * This is the ONE sanctioned exception to the standing rule against writing
 * to the asterisk schema — provisioning is its explicit purpose.
 *
 * Conventions match calls-store.js: schema-qualified, $N positional params,
 * SQL-level idempotency, async fn(pool, params).
 */

const { withTransaction } = require('./db');

/**
 * Provision a whatsapp_sip gateway: business config + Asterisk realtime rows
 * in one atomic transaction. Idempotent on (tenant_id, gateway_id) via
 * ON CONFLICT DO UPDATE.
 *
 * @param {Pool} pool
 * @param {object} params
 * @param {string} params.tenantId
 * @param {string} params.gatewayId
 * @param {string} params.name
 * @param {string} params.host
 * @param {string} params.username
 * @param {string} params.password
 * @param {string} params.fromUser
 * @param {number} [params.port=5061]
 * @param {string} [params.transport='tls']
 * @param {string} [params.provider='whatsapp_sip']
 */
async function provisionGateway(pool, params) {
  const {
    tenantId,
    gatewayId,
    name,
    host,
    username,
    password,
    fromUser,
    port = 5061,
    transport = 'tls',
    provider = 'whatsapp_sip',
  } = params;

  // Map gateway transport ('tls') → ps_endpoints transport ('transport-tls')
  const endpointTransport = `transport-${transport}`;

  // Asterisk realtime ID conventions (from old tenantRepo.js)
  const authId = `${gatewayId}-auth`;
  const identifyId = `${gatewayId}-identify`;

  // match_request_uri: tenant-specific SIP URI pattern for type=identify
  const matchRequestUri = `^sip:\\+?${username}@`;

  return withTransaction(pool, async (client) => {
    // 1. Business config in app.gateways
    const gwResult = await client.query(
      `INSERT INTO app.gateways
         (tenant_id, gateway_id, name, provider, host, username, password,
          from_user, port, transport)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)
       ON CONFLICT (tenant_id, gateway_id) DO UPDATE SET
         name = EXCLUDED.name,
         host = EXCLUDED.host,
         username = EXCLUDED.username,
         password = EXCLUDED.password,
         from_user = EXCLUDED.from_user,
         port = EXCLUDED.port,
         transport = EXCLUDED.transport,
         provider = EXCLUDED.provider,
         updated_at = NOW()
       RETURNING *`,
      [tenantId, gatewayId, name, provider, host, username, password,
       fromUser, port, transport]
    );

    // 2. Asterisk ps_aors — Address of Record
    await client.query(
      `INSERT INTO asterisk.ps_aors (id, contact, max_contacts)
       VALUES ($1, $2, 10)
       ON CONFLICT (id) DO UPDATE SET
         contact = EXCLUDED.contact,
         max_contacts = EXCLUDED.max_contacts`,
      [gatewayId, `sip:${host}`]
    );

    // 3. Asterisk ps_auths — outbound authentication
    await client.query(
      `INSERT INTO asterisk.ps_auths (id, auth_type, username, password)
       VALUES ($1, 'userpass', $2, $3)
       ON CONFLICT (id) DO UPDATE SET
         username = EXCLUDED.username,
         password = EXCLUDED.password`,
      [authId, username, password]
    );

    // 4. Asterisk ps_endpoints — PJSIP endpoint configuration
    //    Values from pjsip.conf.template [wa-meta-trunk] section.
    await client.query(
      `INSERT INTO asterisk.ps_endpoints (
         id, transport, context, disallow, allow,
         aors, outbound_auth, from_user, from_domain,
         rewrite_contact, media_encryption, direct_media,
         rtp_symmetric, force_rport, media_use_received_transport,
         rtcp_mux, media_encryption_optimistic, identify_by,
         trust_id_inbound, send_pai, "100rel", timers, tenantid
       ) VALUES (
         $1, $2, $3, $4, $5,
         $6, $7, $8, $9,
         $10, $11, $12,
         $13, $14, $15,
         $16, $17, $18,
         $19, $20, $21, $22, $23
       )
       ON CONFLICT (id) DO UPDATE SET
         transport = EXCLUDED.transport,
         context = EXCLUDED.context,
         disallow = EXCLUDED.disallow,
         allow = EXCLUDED.allow,
         aors = EXCLUDED.aors,
         outbound_auth = EXCLUDED.outbound_auth,
         from_user = EXCLUDED.from_user,
         from_domain = EXCLUDED.from_domain,
         rewrite_contact = EXCLUDED.rewrite_contact,
         media_encryption = EXCLUDED.media_encryption,
         direct_media = EXCLUDED.direct_media,
         rtp_symmetric = EXCLUDED.rtp_symmetric,
         force_rport = EXCLUDED.force_rport,
         media_use_received_transport = EXCLUDED.media_use_received_transport,
         rtcp_mux = EXCLUDED.rtcp_mux,
         media_encryption_optimistic = EXCLUDED.media_encryption_optimistic,
         identify_by = EXCLUDED.identify_by,
         trust_id_inbound = EXCLUDED.trust_id_inbound,
         send_pai = EXCLUDED.send_pai,
         "100rel" = EXCLUDED."100rel",
         timers = EXCLUDED.timers,
         tenantid = EXCLUDED.tenantid`,
      [
        gatewayId,         // id
        endpointTransport, // transport = 'transport-tls'
        'from-whatsapp',   // context
        'all',             // disallow
        'opus',            // allow
        gatewayId,         // aors
        authId,            // outbound_auth
        username,          // from_user (business number)
        host,              // from_domain
        'no',              // rewrite_contact (MANDATORY: audio drops at 30s without it)
        'sdes',            // media_encryption
        'no',              // direct_media
        'yes',             // rtp_symmetric
        'yes',             // force_rport
        'yes',             // media_use_received_transport
        'yes',             // rtcp_mux
        'no',              // media_encryption_optimistic
        'ip',              // identify_by
        'yes',             // trust_id_inbound
        'yes',             // send_pai
        'no',              // 100rel
        'no',              // timers
        tenantId,          // tenantid
      ]
    );

    // 5. Asterisk ps_endpoint_id_ips — IP-based identify
    //    HARD CONSTRAINT: NO match_header. OR-semantics on type=identify
    //    means adding a shared criterion alongside a tenant-specific one
    //    defeats the tenant-specific one.
    await client.query(
      `INSERT INTO asterisk.ps_endpoint_id_ips (id, endpoint, match_request_uri)
       VALUES ($1, $2, $3)
       ON CONFLICT (id) DO UPDATE SET
         match_request_uri = EXCLUDED.match_request_uri`,
      [identifyId, gatewayId, matchRequestUri]
    );

    return gwResult.rows[0];
  });
}

/**
 * Deprovision a gateway: delete from all five tables in reverse dependency
 * order. Idempotent: returns { deleted } count from app.gateways.
 */
async function deprovisionGateway(pool, { tenantId, gatewayId }) {
  const authId = `${gatewayId}-auth`;
  const identifyId = `${gatewayId}-identify`;

  return withTransaction(pool, async (client) => {
    // Reverse dependency order: identify → endpoint → auth → aor → gateways
    await client.query('DELETE FROM asterisk.ps_endpoint_id_ips WHERE id = $1', [identifyId]);
    await client.query('DELETE FROM asterisk.ps_endpoints WHERE id = $1', [gatewayId]);
    await client.query('DELETE FROM asterisk.ps_auths WHERE id = $1', [authId]);
    await client.query('DELETE FROM asterisk.ps_aors WHERE id = $1', [gatewayId]);

    const { rowCount } = await client.query(
      'DELETE FROM app.gateways WHERE tenant_id = $1 AND gateway_id = $2',
      [tenantId, gatewayId]
    );
    return { deleted: rowCount };
  });
}

/**
 * Find a gateway by tenant + gateway ID. Returns row or null.
 */
async function findGateway(pool, { tenantId, gatewayId }) {
  const { rows } = await pool.query(
    'SELECT * FROM app.gateways WHERE tenant_id = $1 AND gateway_id = $2',
    [tenantId, gatewayId]
  );
  return rows[0] || null;
}

module.exports = { provisionGateway, deprovisionGateway, findGateway };
