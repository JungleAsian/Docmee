#!/bin/sh
# Runs once on first Postgres boot (docker-entrypoint-initdb.d). Creates the
# RLS-bound application role. The superuser `postgres` runs migrations + the
# admin/platform path; `docmee_app` is NOSUPERUSER so RLS is enforced on it.
# (Migration 001's `CREATE ROLE docmee_app NOLOGIN IF NOT EXISTS` no-ops since this
# created it first WITH LOGIN.)
set -e

psql -v ON_ERROR_STOP=1 --username "postgres" --dbname "docmee" <<EOSQL
  DO \$\$
  BEGIN
    IF NOT EXISTS (SELECT FROM pg_roles WHERE rolname = 'docmee_app') THEN
      CREATE ROLE docmee_app LOGIN PASSWORD '${APP_DB_PASSWORD}'
        NOSUPERUSER NOCREATEDB NOCREATEROLE NOBYPASSRLS;
    END IF;
  END
  \$\$;

  GRANT CONNECT ON DATABASE docmee TO docmee_app;
  GRANT USAGE ON SCHEMA public TO docmee_app;
EOSQL
