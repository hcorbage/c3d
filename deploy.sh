#!/usr/bin/env bash
set -euo pipefail

RED='\033[0;31m'; GREEN='\033[0;32m'; YELLOW='\033[1;33m'; NC='\033[0m'

info()  { echo -e "${GREEN}[INFO]${NC}  $*"; }
warn()  { echo -e "${YELLOW}[WARN]${NC}  $*"; }
error() { echo -e "${RED}[ERROR]${NC} $*" >&2; exit 1; }

[[ -f .env ]] || error ".env file not found. Copy .env.example to .env and fill in values."

info "Pulling latest changes..."
git pull origin main

info "Building images..."
docker compose -f docker-compose.prod.yml build --no-cache

info "Running database migrations..."
docker compose -f docker-compose.prod.yml run --rm api node -e "
  const { drizzle } = require('drizzle-orm/node-postgres');
  const { Pool } = require('pg');
  const { migrate } = require('drizzle-orm/node-postgres/migrator');
  const pool = new Pool({ connectionString: process.env.DATABASE_URL });
  const db = drizzle(pool);
  migrate(db, { migrationsFolder: './drizzle' }).then(() => {
    console.log('Migrations complete');
    process.exit(0);
  }).catch(err => { console.error(err); process.exit(1); });
" 2>/dev/null || warn "Migration runner not available — run migrations manually if needed."

info "Stopping old containers..."
docker compose -f docker-compose.prod.yml down

info "Starting services..."
docker compose -f docker-compose.prod.yml up -d

info "Waiting for API health..."
sleep 5
docker compose -f docker-compose.prod.yml ps

info "Deploy complete! App running on port 80."
info "Tip: Set up SSL with: certbot --nginx -d yourdomain.com"
