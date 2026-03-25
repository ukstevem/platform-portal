#!/usr/bin/env bash
set -euo pipefail

REGISTRY="ghcr.io/ukstevem/platform-portal"
PLATFORM="linux/arm64"

# Load env vars for build args
if [ -f .env ]; then
  set -a; source .env; set +a
fi

echo "=== Building and pushing images for $PLATFORM ==="
echo ""

# Ensure buildx builder exists
docker buildx inspect multiarch >/dev/null 2>&1 || \
  docker buildx create --name multiarch --use
docker buildx use multiarch

# Build and push gateway
echo "--- gateway ---"
docker buildx build \
  --platform "$PLATFORM" \
  -f docker/nginx/Dockerfile.prod \
  -t "$REGISTRY/gateway:latest" \
  --push \
  docker/nginx/

# Build and push each app
for APP in portal jobcards documents timesheets scanner; do
  echo ""
  echo "--- $APP ---"

  PORT_MAP=("portal:3000" "jobcards:3001" "documents:3002" "timesheets:3003" "scanner:3005")
  APP_PORT="3000"
  for p in "${PORT_MAP[@]}"; do
    if [[ "$p" == "$APP:"* ]]; then
      APP_PORT="${p#*:}"
    fi
  done

  docker buildx build \
    --platform "$PLATFORM" \
    -f docker/node/Dockerfile.prod \
    --build-arg APP_NAME="$APP" \
    --build-arg APP_PORT="$APP_PORT" \
    --build-arg NEXT_PUBLIC_SUPABASE_URL="${NEXT_PUBLIC_SUPABASE_URL:-}" \
    --build-arg NEXT_PUBLIC_SUPABASE_ANON_KEY="${NEXT_PUBLIC_SUPABASE_ANON_KEY:-}" \
    --build-arg NEXT_PUBLIC_DOC_GATEWAY_BASE_URL="${NEXT_PUBLIC_DOC_GATEWAY_BASE_URL:-}" \
    --build-arg NEXT_PUBLIC_APP_URL="${NEXT_PUBLIC_APP_URL:-}" \
    -t "$REGISTRY/$APP:latest" \
    --push \
    .
done

# Build and push fileserver (nginx static file server)
echo ""
echo "--- fileserver ---"
docker buildx build \
  --platform "$PLATFORM" \
  -f docker/fileserver/Dockerfile \
  -t "$REGISTRY/fileserver:latest" \
  --push \
  docker/fileserver/

# Build and push scanner-worker (standalone service, not a Next.js app)
echo ""
echo "--- scanner-worker ---"
docker buildx build \
  --platform "$PLATFORM" \
  -f services/scanner-worker/Dockerfile \
  -t "$REGISTRY/scanner-worker:latest" \
  --push \
  services/scanner-worker/

echo ""
echo "=== All images pushed to $REGISTRY ==="
echo "On the Pi, redeploy the stack in Portainer or run:"
echo "  docker compose -f docker-compose.deploy.yml pull && docker compose -f docker-compose.deploy.yml up -d"
