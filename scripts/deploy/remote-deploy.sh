#!/usr/bin/env bash
# Runs on the server (as the deploy user). Argument: release id (git sha).
# Layout:  ~/abl-backend/releases/<sha>   ~/abl-backend/current -> a release   ~/abl-backend/.env
set -euo pipefail

RELEASE="$1"
BASE="$HOME/abl-backend"
NEXT="$BASE/releases/$RELEASE"
NODE_BIN="$HOME/node22/bin"
export PATH="$NODE_BIN:$PATH"

# Blue/green: two slots on two ports. nginx points at one (the upstream file); a deploy starts the
# new release on the idle slot, waits for it to be healthy, switches nginx over (a graceful
# reload, so no request is dropped) and only then stops the old slot.
UPSTREAM=/etc/nginx/conf.d/abl-backend-upstream.conf
PORT_A=9015; NAME_A=abl-backend
PORT_B=9016; NAME_B=abl-backend-b

[ -f "$BASE/.env" ] || { echo "missing $BASE/.env" >&2; exit 1; }

mkdir -p "$NEXT"
tar -xzf "/tmp/abl-$RELEASE.tgz" -C "$NEXT"
rm -f "/tmp/abl-$RELEASE.tgz"
ln -sfn "$BASE/.env" "$NEXT/.env"
(cd "$NEXT" && npm ci --omit=dev --no-audit --no-fund)

[ -f "$UPSTREAM" ] || { echo "missing $UPSTREAM" >&2; exit 1; }
ACTIVE_PORT="$(grep -oE '127\.0\.0\.1:[0-9]+' "$UPSTREAM" | head -1 | cut -d: -f2)"
if [ "$ACTIVE_PORT" = "$PORT_A" ]; then
  OLD_NAME="$NAME_A"; NEXT_NAME="$NAME_B"; NEXT_PORT="$PORT_B"
else
  OLD_NAME="$NAME_B"; NEXT_NAME="$NAME_A"; NEXT_PORT="$PORT_A"
fi

PREVIOUS="$(readlink -f "$BASE/current" 2>/dev/null || true)"

# Start the new release on the idle slot (a stale process there, if any, is replaced).
pm2 delete "$NEXT_NAME" >/dev/null 2>&1 || true
PORT="$NEXT_PORT" pm2 start "$NEXT/dist/server.js" --cwd "$NEXT" --name "$NEXT_NAME" --interpreter "$NODE_BIN/node" --time --update-env >/dev/null

# Health check the new slot BEFORE it takes traffic; on failure the live slot is untouched.
healthy=0
for i in $(seq 1 30); do
  if curl -fsS "http://127.0.0.1:$NEXT_PORT/health" >/dev/null; then healthy=1; break; fi
  sleep 2
done
if [ "$healthy" != 1 ]; then
  echo "health check failed; the previous release is still serving" >&2
  pm2 delete "$NEXT_NAME" >/dev/null 2>&1 || true
  exit 1
fi

# Switch nginx to the new slot; revert the file if nginx rejects it.
cp "$UPSTREAM" "$UPSTREAM.prev" 2>/dev/null || sudo cp "$UPSTREAM" "$UPSTREAM.prev"
printf '# Written by abl-backend deploy: the port of the live backend slot.\nupstream abl_backend {\n    server 127.0.0.1:%s;\n}\n' "$NEXT_PORT" | sudo tee "$UPSTREAM" >/dev/null
if ! sudo nginx -t >/dev/null 2>&1 || ! sudo nginx -s reload; then
  sudo cp "$UPSTREAM.prev" "$UPSTREAM"
  pm2 delete "$NEXT_NAME" >/dev/null 2>&1 || true
  echo "nginx rejected the switch; reverted" >&2
  exit 1
fi
ln -sfn "$NEXT" "$BASE/current"

# Let requests already in flight on the old slot finish, then stop it (it shuts down gracefully).
sleep 5
pm2 stop "$OLD_NAME" >/dev/null 2>&1 || true
pm2 save >/dev/null

echo "healthy: $RELEASE (now on port $NEXT_PORT, $NEXT_NAME)"
# keep the two newest releases (each carries its own node_modules), drop the rest
ls -1dt "$BASE"/releases/*/ | tail -n +3 | xargs -r rm -rf
"$NODE_BIN/npm" cache clean --force >/dev/null 2>&1 || true
