#!/usr/bin/env bash
# Runs on the server (as the deploy user). Arguments: release id (git sha), app name, port.
# Layout:  ~/<app>/releases/<sha>   ~/<app>/current -> a release   ~/<app>/.env (runtime settings)
set -euo pipefail

RELEASE="$1"; APP="$2"; PORT="$3"
BASE="$HOME/$APP"
NEXT="$BASE/releases/$RELEASE"
NODE_BIN="$HOME/node22/bin"
export PATH="$NODE_BIN:$PATH"

mkdir -p "$BASE/releases"
[ -f "$BASE/.env" ] || printf 'PORT=%s\nHOSTNAME=127.0.0.1\nNODE_ENV=production\n' "$PORT" > "$BASE/.env"
chmod 600 "$BASE/.env"

mkdir -p "$NEXT"
tar -xzf "/tmp/$APP-$RELEASE.tgz" -C "$NEXT"
rm -f "/tmp/$APP-$RELEASE.tgz"

PREVIOUS="$(readlink -f "$BASE/current" 2>/dev/null || true)"
ln -sfn "$NEXT" "$BASE/current"

if pm2 describe "$APP" >/dev/null 2>&1; then
  pm2 reload "$APP" --update-env
else
  pm2 start "$BASE/current/server.js" --cwd "$BASE/current" --name "$APP" \
    --interpreter "$NODE_BIN/node" --node-args="--env-file=$BASE/.env" --time
fi
pm2 save >/dev/null

# Health check; on failure put the previous release back.
for i in $(seq 1 20); do
  if curl -fsS -o /dev/null "http://127.0.0.1:$PORT/"; then
    echo "healthy: $APP $RELEASE"
    # keep the two newest releases, drop the rest
    ls -1dt "$BASE"/releases/*/ | tail -n +3 | xargs -r rm -rf
    exit 0
  fi
  sleep 2
done

echo "health check failed" >&2
if [ -n "$PREVIOUS" ] && [ -d "$PREVIOUS" ]; then
  ln -sfn "$PREVIOUS" "$BASE/current"
  pm2 reload "$APP" --update-env || true
  echo "rolled back to $PREVIOUS" >&2
fi
exit 1
