#!/usr/bin/env bash
# Runs on the server (as the deploy user). Argument: release id (git sha).
# Layout:  ~/abl-backend/releases/<sha>   ~/abl-backend/current -> a release   ~/abl-backend/.env
set -euo pipefail

RELEASE="$1"
BASE="$HOME/abl-backend"
NEXT="$BASE/releases/$RELEASE"
PORT="${ABL_PORT:-9015}"
export NVM_DIR="$HOME/.nvm"; . "$NVM_DIR/nvm.sh"; nvm use 22 >/dev/null

[ -f "$BASE/.env" ] || { echo "missing $BASE/.env" >&2; exit 1; }

mkdir -p "$NEXT"
tar -xzf "/tmp/abl-$RELEASE.tgz" -C "$NEXT"
rm -f "/tmp/abl-$RELEASE.tgz"
ln -sfn "$BASE/.env" "$NEXT/.env"
(cd "$NEXT" && npm ci --omit=dev --no-audit --no-fund)

PREVIOUS="$(readlink -f "$BASE/current" 2>/dev/null || true)"
ln -sfn "$NEXT" "$BASE/current"

if pm2 describe abl-backend >/dev/null 2>&1; then
  pm2 reload abl-backend --update-env
else
  (cd "$BASE/current" && PORT="$PORT" pm2 start dist/server.js --name abl-backend --time)
fi
pm2 save >/dev/null

# Health check; on failure put the previous release back.
for i in $(seq 1 20); do
  if curl -fsS "http://127.0.0.1:$PORT/health" >/dev/null; then
    echo "healthy: $RELEASE"
    # keep the three newest releases, drop the rest
    ls -1dt "$BASE"/releases/*/ | tail -n +4 | xargs -r rm -rf
    exit 0
  fi
  sleep 2
done

echo "health check failed" >&2
if [ -n "$PREVIOUS" ] && [ -d "$PREVIOUS" ]; then
  ln -sfn "$PREVIOUS" "$BASE/current"
  pm2 reload abl-backend --update-env || true
  echo "rolled back to $PREVIOUS" >&2
fi
exit 1
