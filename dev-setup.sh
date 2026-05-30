#!/usr/bin/env bash
# One-shot local dev setup for SPD Tracker.
# Assumes: node 18+, postgres running locally on default port.
# Run from the project root:  ./dev-setup.sh

set -e

echo
echo "=== SPD Tracker - local dev setup ==="
echo

# --- 1. Sanity checks ---------------------------------------------------------
command -v node >/dev/null 2>&1 || { echo "ERROR: node not found. Install Node 18+ (https://nodejs.org)"; exit 1; }
command -v npm  >/dev/null 2>&1 || { echo "ERROR: npm not found"; exit 1; }
command -v psql >/dev/null 2>&1 || { echo "ERROR: psql not found. Install Postgres (Postgres.app or 'brew install postgresql@16')"; exit 1; }

NODE_V="$(node -v)"
PG_V="$(psql --version | awk '{print $3}')"
echo "node:     $NODE_V"
echo "postgres: $PG_V"
echo

# --- 2. Create local DB and user ---------------------------------------------
# Use the current OS user as the admin role - matches Postgres.app/Homebrew default.
DB_NAME="spd_tracker"
DB_USER="spd_user"
DB_PASS="dev"

echo "Creating database and user (idempotent)..."
psql -d postgres -tAc \
  "SELECT 1 FROM pg_roles WHERE rolname='${DB_USER}'" | grep -q 1 || \
  psql -d postgres -c "CREATE ROLE ${DB_USER} WITH LOGIN PASSWORD '${DB_PASS}';"

psql -d postgres -tAc \
  "SELECT 1 FROM pg_database WHERE datname='${DB_NAME}'" | grep -q 1 || \
  psql -d postgres -c "CREATE DATABASE ${DB_NAME} OWNER ${DB_USER};"

psql -d postgres -c "GRANT ALL PRIVILEGES ON DATABASE ${DB_NAME} TO ${DB_USER};" >/dev/null
echo "DB ready: ${DB_NAME} (user ${DB_USER}/${DB_PASS})"
echo

# --- 3. Backend ---------------------------------------------------------------
echo "Installing backend dependencies..."
( cd backend && npm install )

if [ ! -f backend/.env ]; then
  echo "Writing backend/.env from example..."
  cp backend/.env.example backend/.env
  # Replace the DATABASE_URL with a real local one
  JWT_RANDOM="$(node -e "console.log(require('crypto').randomBytes(48).toString('hex'))")"
  python3 - <<PY
import re, pathlib
p = pathlib.Path('backend/.env')
s = p.read_text()
s = re.sub(r'^DATABASE_URL=.*$', f'DATABASE_URL=postgres://${DB_USER}:${DB_PASS}@localhost:5432/${DB_NAME}', s, flags=re.M)
s = re.sub(r'^JWT_SECRET=.*$', f'JWT_SECRET=${JWT_RANDOM}', s, flags=re.M)
p.write_text(s)
PY
  echo "backend/.env created."
else
  echo "backend/.env already exists - leaving it alone."
fi
echo

# --- 4. Schema + seed ---------------------------------------------------------
echo "Applying schema..."
( cd backend && npm run migrate )

# Seed only if authorities table is empty.
HAS_DATA="$(psql "postgres://${DB_USER}:${DB_PASS}@localhost:5432/${DB_NAME}" -tAc 'SELECT COUNT(*) FROM authorities' 2>/dev/null || echo 0)"
if [ "${HAS_DATA}" = "0" ]; then
  echo "Seeding starting data (16 authorities, 23 sub-divisions, 16 communications)..."
  ( cd backend && npm run seed )
else
  echo "DB already has ${HAS_DATA} authorities - skipping seed."
fi
echo

# --- 5. Frontend --------------------------------------------------------------
echo "Installing frontend dependencies..."
( cd frontend && npm install )
echo

echo "=== Setup complete ==="
echo
echo "Run the dev servers in two terminals:"
echo "  Terminal 1:  cd backend  && npm run dev"
echo "  Terminal 2:  cd frontend && npm run dev"
echo
echo "Then open http://localhost:5173"
echo
echo "Seeded accounts (passwords are first-login defaults — change before sharing):"
echo "  super_admin  mohamedhamza.ab@gmail.com         ChangeMe-Super-1"
echo "  admin        sherif.eldaly@ecg.example        ChangeMe-Admin-1"
echo "  admin        spd.admin@ecg.example            ChangeMe-Admin-2"
echo "  reviewer     reviewer@egis.example            ChangeMe-Reviewer-1"
echo "  reviewer     client@safariparkdoha.example    ChangeMe-Reviewer-2"
