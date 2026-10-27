#!/usr/bin/env bash
# Set up PostgreSQL on Oracle VPS free-vm-1 (Ubuntu, 2 vCPU / 12 GB RAM).
# Run once, as the ubuntu user with sudo. Do NOT run on a machine that
# already has production data without a backup.
# Optimised for a small VPS: shared_buffers 256MB, work_mem 16MB,
# max_connections 50. Do not copy production-sized tuning here.
set -euo pipefail
sudo apt-get update
sudo DEBIAN_FRONTEND=noninteractive apt-get install -y postgresql postgresql-contrib
sudo service postgresql start || true
# Create app database and user. Password is read from the environment
# variable ZDX_DB_PASSWORD — never hard-code it in this script.
if [ -z "${ZDX_DB_PASSWORD:-}" ]; then
  echo "Set ZDX_DB_PASSWORD in the environment before running this script." >&2
  exit 1
fi
sudo -u postgres psql -v ON_ERROR_STOP=1 <<SQL
DO \$\$
BEGIN
  IF NOT EXISTS (SELECT FROM pg_roles WHERE rolname = 'zdx_app') THEN
    CREATE ROLE zdx_app LOGIN PASSWORD '${ZDX_DB_PASSWORD}';
  END IF;
END
\$\$;
SQL
sudo -u postgres psql -tc "SELECT 1 FROM pg_database WHERE datname = 'zdx_platform'" | grep -q 1 || sudo -u postgres createdb -O zdx_app zdx_platform
echo "DATABASE_URL=postgresql://zdx_app:***@localhost:5432/zdx_platform"
echo "Set DATABASE_URL on the VPS (with the real password) before starting the app."
echo "Then, from ~/zdx-muse-data-platform: npx prisma migrate deploy"
