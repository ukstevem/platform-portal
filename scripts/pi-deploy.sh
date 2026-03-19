#!/usr/bin/env bash
set -euo pipefail

# ── Configuration ──
REPO="https://github.com/ukstevem/platform-portal.git"
DEPLOY_DIR="/opt/platform-portal"
COMPOSE_FILE="docker-compose.prod.yml"

NEXT_PUBLIC_SUPABASE_URL="https://hguvsjpmiyeypfcuvvko.supabase.co"
NEXT_PUBLIC_SUPABASE_ANON_KEY="sb_publishable_DKe7xv_H2cVXIT9iKOtpEQ_FxLrsc_m"
NEXT_PUBLIC_APP_URL="http://10.0.0.75:3000"
NEXT_PUBLIC_DOC_GATEWAY_BASE_URL="http://10.0.0.75:3000/files"
GATEWAY_PORT="3000"
HOST_DOC_ROOT="/tmp"

# ── Export for docker compose ──
export NEXT_PUBLIC_SUPABASE_URL NEXT_PUBLIC_SUPABASE_ANON_KEY
export NEXT_PUBLIC_APP_URL NEXT_PUBLIC_DOC_GATEWAY_BASE_URL
export GATEWAY_PORT HOST_DOC_ROOT

echo "=== PSS Platform Portal Deploy ==="
echo ""

# ── Clone or update repo ──
if [ -d "$DEPLOY_DIR/.git" ]; then
  echo "Updating repo..."
  cd "$DEPLOY_DIR"
  git pull --ff-only
else
  echo "Cloning repo..."
  sudo mkdir -p "$DEPLOY_DIR"
  sudo chown "$USER:$USER" "$DEPLOY_DIR"
  git clone "$REPO" "$DEPLOY_DIR"
  cd "$DEPLOY_DIR"
fi

echo ""

# ── Stop existing stack ──
echo "Stopping existing containers..."
docker compose -f "$COMPOSE_FILE" down 2>/dev/null || true

echo ""

# ── Build images one at a time (Pi has limited RAM) ──
for SERVICE in gateway portal jobcards documents timesheets; do
  echo "Building $SERVICE..."
  docker compose -f "$COMPOSE_FILE" build "$SERVICE"
  echo "$SERVICE done."
  echo ""
done

# ── Start the stack ──
echo "Starting stack..."
docker compose -f "$COMPOSE_FILE" up -d

echo ""
echo "=== Deploy complete ==="
echo "Platform available at: http://10.0.0.75:${GATEWAY_PORT}"
echo ""
docker ps --format "table {{.Names}}\t{{.Status}}\t{{.Ports}}"
