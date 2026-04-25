#!/usr/bin/env bash
# deploy-timed.sh — same as deploy.sh, but records per-app build+push time.
# Use this once or twice to identify which app is the slowest to rebuild,
# so extraction effort is spent where it actually helps.
#
# Usage:
#   ./scripts/deploy-timed.sh                   # time all apps
#   ./scripts/deploy-timed.sh portal jobcards   # time a subset
#
# Output:
#   - live console log
#   - scripts/build-times.log   (appended, one row per run)
#   - scripts/build-times.csv   (appended, for charting)

set -euo pipefail

REGISTRY="ghcr.io/ukstevem/platform-portal"
PLATFORM="linux/arm64"
LOG_DIR="scripts"
LOG_FILE="$LOG_DIR/build-times.log"
CSV_FILE="$LOG_DIR/build-times.csv"

if [ -f .env ]; then
  set -a; source .env; set +a
fi

docker buildx inspect multiarch >/dev/null 2>&1 || \
  docker buildx create --name multiarch --use
docker buildx use multiarch

ALL_APPS=(portal jobcards documents timesheets operations scanner laserquote assembly-viewer nesting)
APPS=("${@:-${ALL_APPS[@]}}")
if [ "$#" -gt 0 ]; then APPS=("$@"); fi

declare -A PORTS=(
  [portal]=3000 [jobcards]=3001 [documents]=3002 [timesheets]=3003
  [operations]=3004 [scanner]=3005 [laserquote]=3006
  [assembly-viewer]=3007 [nesting]=3008
)

# Keep in sync with scripts/deploy.sh STANDALONE_APPS
STANDALONE_APPS=("assembly-viewer")
is_standalone() {
  local app="$1"
  for s in "${STANDALONE_APPS[@]}"; do
    [[ "$s" == "$app" ]] && return 0
  done
  return 1
}

RUN_ID="$(date -u +%Y-%m-%dT%H-%M-%SZ)"
GIT_SHA="$(git rev-parse --short HEAD 2>/dev/null || echo unknown)"

mkdir -p "$LOG_DIR"
if [ ! -f "$CSV_FILE" ]; then
  echo "run_id,git_sha,app,seconds,status" > "$CSV_FILE"
fi

echo "=== Timed build run $RUN_ID (git $GIT_SHA) ==="
echo ""
printf "%-20s %10s  %s\n" "APP" "SECONDS" "STATUS" | tee -a "$LOG_FILE"
printf "%-20s %10s  %s\n" "----" "-------" "------" | tee -a "$LOG_FILE"

TOTAL=0
for APP in "${APPS[@]}"; do
  APP_PORT="${PORTS[$APP]:-3000}"
  START=$(date +%s)
  STATUS="ok"

  if is_standalone "$APP"; then TARGET="runner-standalone"; else TARGET="runner"; fi

  if ! docker buildx build \
      --platform "$PLATFORM" \
      -f docker/node/Dockerfile.prod \
      --target "$TARGET" \
      --build-arg APP_NAME="$APP" \
      --build-arg APP_PORT="$APP_PORT" \
      --build-arg NEXT_PUBLIC_SUPABASE_URL="${NEXT_PUBLIC_SUPABASE_URL:-}" \
      --build-arg NEXT_PUBLIC_SUPABASE_ANON_KEY="${NEXT_PUBLIC_SUPABASE_ANON_KEY:-}" \
      --build-arg NEXT_PUBLIC_DOC_GATEWAY_BASE_URL="${NEXT_PUBLIC_DOC_GATEWAY_BASE_URL:-}" \
      --build-arg NEXT_PUBLIC_APP_URL="${NEXT_PUBLIC_APP_URL:-}" \
      --build-arg NEXT_PUBLIC_DOC_SERVICE_URL="${NEXT_PUBLIC_DOC_SERVICE_URL:-}" \
      --build-arg NEXT_PUBLIC_LASER_QUOTE_SERVICE_URL="${NEXT_PUBLIC_LASER_QUOTE_SERVICE_URL:-}" \
      -t "$REGISTRY/$APP:latest" \
      --push \
      . >/tmp/build-"$APP".log 2>&1; then
    STATUS="FAIL"
    echo "  (see /tmp/build-$APP.log)"
  fi

  END=$(date +%s)
  DUR=$((END - START))
  TOTAL=$((TOTAL + DUR))

  printf "%-20s %10s  %s\n" "$APP" "${DUR}s" "$STATUS" | tee -a "$LOG_FILE"
  echo "$RUN_ID,$GIT_SHA,$APP,$DUR,$STATUS" >> "$CSV_FILE"
done

printf "%-20s %10s\n" "TOTAL" "${TOTAL}s" | tee -a "$LOG_FILE"
echo "" | tee -a "$LOG_FILE"
echo "Results appended to $LOG_FILE and $CSV_FILE"
echo ""
echo "Sort slowest → fastest:"
echo "  awk -F, -v r=\"$RUN_ID\" '\$1==r{print \$4, \$3}' $CSV_FILE | sort -n -r"
