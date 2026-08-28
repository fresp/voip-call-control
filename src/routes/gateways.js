'use strict';

/**
 * Express router for gateway provisioning.
 *
 * POST   /gateways          — create/provision
 * PUT    /gateways/:id      — update (upsert)
 * DELETE /gateways/:id      — deprovision
 * GET    /gateways/:id      — read
 */

const { Router } = require('express');
const { provisionGateway, deprovisionGateway, findGateway } = require('../gateways-store');

function createGatewaysRouter(pool) {
  const router = Router();

  // --- validation -----------------------------------------------------------

  const REQUIRED_FIELDS = ['username', 'password', 'fromUser'];

  function validateBody(body, isNew) {
    const errors = [];

    if (isNew && !body.gatewayId) {
      errors.push('gatewayId is required');
    }
    if (!body.name) errors.push('name is required');

    if (body.provider && body.provider !== 'whatsapp_sip') {
      errors.push(`unsupported provider: ${body.provider}`);
    }

    for (const f of REQUIRED_FIELDS) {
      if (!body[f]) errors.push(`${f} is required`);
    }

    if (body.transport && body.transport !== 'tls') {
      errors.push(`transport must be tls; got ${body.transport}`);
    }

    if (body.port && body.port !== 5061) {
      errors.push(`port must be 5061; got ${body.port}`);
    }

    return errors;
  }

  function tenantId(req) {
    return req.headers['x-tenant-id']
      || req.body.tenantId
      || req.query.tenantId
      || 'default';
  }

  // --- POST /gateways — create/provision ------------------------------------

  router.post('/', async (req, res) => {
    try {
      const body = req.body || {};
      const errors = validateBody(body, true);
      if (errors.length) {
        return res.status(400).json({ error: errors.join('; ') });
      }

      const row = await provisionGateway(pool, {
        tenantId: tenantId(req),
        gatewayId: body.gatewayId,
        name: body.name,
        provider: body.provider || 'whatsapp_sip',
        host: body.host || 'wa.meta.vc',
        username: body.username,
        password: body.password,
        fromUser: body.fromUser,
        port: body.port || 5061,
        transport: body.transport || 'tls',
      });

      // Idempotent: existing row → 200, new row → 201
      const status = row.created_at.getTime() === row.updated_at.getTime() ? 201 : 200;
      return res.status(status).json(row);
    } catch (err) {
      return res.status(500).json({ error: err.message });
    }
  });

  // --- PUT /gateways/:gatewayId — update (upsert) ---------------------------

  router.put('/:gatewayId', async (req, res) => {
    try {
      const body = req.body || {};
      const errors = validateBody(body, false);
      if (errors.length) {
        return res.status(400).json({ error: errors.join('; ') });
      }

      const row = await provisionGateway(pool, {
        tenantId: tenantId(req),
        gatewayId: req.params.gatewayId,
        name: body.name || req.params.gatewayId,
        provider: body.provider || 'whatsapp_sip',
        host: body.host || 'wa.meta.vc',
        username: body.username,
        password: body.password,
        fromUser: body.fromUser,
        port: body.port || 5061,
        transport: body.transport || 'tls',
      });

      return res.status(200).json(row);
    } catch (err) {
      return res.status(500).json({ error: err.message });
    }
  });

  // --- DELETE /gateways/:gatewayId — deprovision ----------------------------

  router.delete('/:gatewayId', async (req, res) => {
    try {
      const { deleted } = await deprovisionGateway(pool, {
        tenantId: tenantId(req),
        gatewayId: req.params.gatewayId,
      });
      return res.status(200).json({ deleted });
    } catch (err) {
      return res.status(500).json({ error: err.message });
    }
  });

  // --- GET /gateways/:gatewayId — read --------------------------------------

  router.get('/:gatewayId', async (req, res) => {
    try {
      const row = await findGateway(pool, {
        tenantId: tenantId(req),
        gatewayId: req.params.gatewayId,
      });
      if (!row) return res.status(404).json({ error: 'not found' });
      return res.status(200).json(row);
    } catch (err) {
      return res.status(500).json({ error: err.message });
    }
  });

  return router;
}

module.exports = { createGatewaysRouter };
