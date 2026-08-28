-- Phase 1: create the `app` schema. All application tables live here.
-- The PBX realtime schema (owned by res_pgsql) is never written by this service.
CREATE SCHEMA IF NOT EXISTS app;
