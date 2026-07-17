#!/bin/bash
# Self-healing PostgreSQL launcher for the Emergent pod.
# Container recycles wipe /usr + /var but keep /app, so data lives in /app/.pgdata.
set -e
PGDATA=/app/.pgdata

# Pick the newest /usr/lib/postgresql/*/bin that actually contains the postgres server
# binary. Directory existence alone is NOT a reliable install signal: postgresql-client-15
# creates bin/ populated with client tools (createdb, psql, etc.) even when the server
# package is not installed — exactly the state a container recycle can leave behind
# (observed 2026-07-17 incident, 10:50–11:43 IST). Checking for the postgres binary
# itself is the correct install signal.
find_pgbin() {
  for d in $(ls -d /usr/lib/postgresql/*/bin 2>/dev/null | sort -V); do
    [ -x "$d/postgres" ] && echo "$d"
  done | tail -1
}
PGBIN=$(find_pgbin)

if [ -z "$PGBIN" ]; then
  echo "[run_postgres] installing postgresql..."
  apt-get update -qq && apt-get install -y -qq postgresql postgresql-contrib > /dev/null
  service postgresql stop > /dev/null 2>&1 || true
  PGBIN=$(find_pgbin)
fi

id postgres > /dev/null 2>&1 || useradd -r -s /bin/bash postgres

FRESH=0
if [ ! -f "$PGDATA/PG_VERSION" ]; then
  echo "[run_postgres] initializing new cluster at $PGDATA"
  mkdir -p "$PGDATA"
  chown -R postgres:postgres "$PGDATA"
  chmod 700 "$PGDATA"
  su postgres -s /bin/bash -c "$PGBIN/initdb -D $PGDATA -E UTF8" > /dev/null
  FRESH=1
else
  chown -R postgres:postgres "$PGDATA"
  chmod 700 "$PGDATA"
  rm -f "$PGDATA/postmaster.pid"
fi

mkdir -p /var/run/postgresql && chown postgres:postgres /var/run/postgresql

if [ "$FRESH" = "1" ]; then
  su postgres -s /bin/bash -c "$PGBIN/pg_ctl -D $PGDATA -w start" > /dev/null
  su postgres -s /bin/bash -c "psql -c \"CREATE USER nse WITH PASSWORD 'nse_secure_2026' SUPERUSER;\" -c \"CREATE DATABASE nsescanner OWNER nse;\""
  su postgres -s /bin/bash -c "$PGBIN/pg_ctl -D $PGDATA -w stop" > /dev/null
  echo "[run_postgres] cluster bootstrapped (db=nsescanner user=nse)"
fi

echo "[run_postgres] starting postgres from $PGBIN"
exec su postgres -s /bin/bash -c "exec $PGBIN/postgres -D $PGDATA -c listen_addresses=localhost -c port=5432"
