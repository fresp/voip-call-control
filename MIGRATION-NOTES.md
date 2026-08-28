# Migration Notes — MongoDB → PostgreSQL

Scope and decisions from the Phase 1 rebuild of voip-call-control. Read this
before touching `migrations/` or wiring the service to the database.

## Tooling

**node-pg-migrate** (raw SQL migrations, no ORM). Chosen over Knex/Prisma:

1. PgBouncer-compatible: raw SQL, no prepared statements at migration time —
   safe under transaction-mode pooling.
2. Explicit SQL files: trivially auditable (e.g. proving no `asterisk` schema
   writes).
3. No runtime schema introspection or ORM overhead.
4. Proven in production Node.js/Postgres environments.

Migrations live in `migrations/NNN_name.sql`. Run via:

```sh
DATABASE_URL=postgresql://user:pass@host:5432/db?sslmode=require npm run migrate
```

`scripts/migrate.js` wraps node-pg-migrate's programmatic runner with the
`sql` loader strategy (plain `.sql` files, up-only). Migration bookkeeping
table: `public.pgmigrations`.

## Schema layout

- All 11 application tables live in schema `app` (tenants, gateways,
  extensions, dids, queues, calls, call_correlations, recordings,
  processed_events, waiting_tones, presence).
- `app.calls.whatsapp` JSONB column exists from Phase 1. Shape:
  `{wacid, user_id, parent_user_id, username, cta_payload, deeplink_payload}`.
  This fixes the old service defect where WhatsApp SIP headers were never
  captured.
- `app.presence` is a new table (old service had no dedicated model; presence
  was tracked on `Extension.status` / `Extension.lastSeenAt`). Staleness
  sweep: rows with `last_seen_at < NOW() - INTERVAL '45 seconds'` become
  `offline`.
- Postgres has no native TTL: `app.processed_events.expires_at` is enforced by
  scheduled cleanup (pg_cron on RDS if available) with an application-level
  `DELETE ... WHERE expires_at < NOW()` sweep as fallback.

## Phase 2 amendment (014_add_calls_duration.sql)

`app.calls.duration_seconds INTEGER` (nullable) — set at ChannelDestroyed
finalize as `ended_at - COALESCE(answered_at, started_at)` (the old service
only derived duration on recordings). All Phase 2 service code lives under
`src/` (entrypoint `src/index.js`, ARI wiring `src/ari/event-router.js`,
data access `src/calls-store.js`); integration test:
`DATABASE_URL=... npx jest` (creates/drops a throwaway database per run and
applies migrations via the real `scripts/migrate.js` path).

## Cross-repo prerequisite (BLOCKING for Phase 3)

`voip-asterisk/docker-compose.yml` runs a local `postgres:16-alpine` container
(service `postgres`, volume `postgres_data`, initializing the `asterisk`
schema from `config/postgres/schema-asterisk-22.10.1.sql`). This container
MUST be removed entirely — not repointed — before Phase 3 can be tested
against real infrastructure. The `asterisk` schema belongs to Asterisk's
`res_pgsql` realtime engine; this service never reads or writes it.

## Connection requirements (RDS)

- `sslmode=require` (RDS enforces TLS).
- Connection retry with exponential backoff (cross-VPC failure modes).
- Credentials from Kubernetes Secret; never committed `.env` values.
- If the RDS parameter group enforces `sslmode=verify-full`, the connection
  string must additionally carry `sslrootcert` pointing at the RDS CA bundle.
- The connecting role needs `CREATE` privilege on schema `app`; migration
  `001` creates the schema if absent.

## Verify after applying migrations

```sh
# All 11 tables present
psql "$DATABASE_URL" -c "\dt app.*"
# Indexes present (incl. partial unique idx_waiting_tones_tenant_default_active)
psql "$DATABASE_URL" -c "\di app.*"
# Uniqueness enforced (expect unique-violation error)
psql "$DATABASE_URL" -c "INSERT INTO app.gateways (tenant_id, gateway_id, name, host) SELECT tenant_id, gateway_id, name, host FROM app.gateways LIMIT 1;"
```
