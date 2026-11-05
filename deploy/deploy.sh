#!/usr/bin/env bash
# Redeploy over ssh: pack the repo (minus node_modules / dist / .git), upload,
# rebuild the image and restart. The server's .env is left untouched.
#   deploy/deploy.sh [ssh-host] [remote-dir]
set -euo pipefail
HOST=${1:-my-server}
DIR=${2:-/opt/gomind}
ROOT=$(cd "$(dirname "$0")/.." && pwd)
TGZ=$(mktemp -t gomind)
trap 'rm -f "$TGZ"' EXIT

# COPYFILE_DISABLE / --no-xattrs keep macOS from shipping ._* AppleDouble files.
(cd "$ROOT" && COPYFILE_DISABLE=1 tar czf "$TGZ" --no-xattrs \
  --exclude=.git --exclude=node_modules --exclude='web/node_modules' \
  --exclude='web/dist' --exclude='web/tsconfig.tsbuildinfo' \
  --exclude='rapfi-*.cjs' --exclude=.env --exclude=.DS_Store .)
echo "upload $(du -h "$TGZ" | cut -f1) -> $HOST:$DIR"
# Rate-limited: an unthrottled tar-over-ssh pipe got reset by the host.
scp -q -l 40000 "$TGZ" "$HOST:/tmp/gomind.tgz"

ssh "$HOST" DIR="$DIR" 'bash -s' <<'REMOTE'
set -euo pipefail
mkdir -p "$DIR" && cd "$DIR"
tar xzf /tmp/gomind.tgz && rm -f /tmp/gomind.tgz
[ -f .env ] || { cp .env.example .env; echo "created .env from .env.example — edit BIND if needed"; }
docker compose up -d --build --remove-orphans
sleep 2
docker compose ps
BIND=$(grep -E '^BIND=' .env | cut -d= -f2 || true)
BIND=${BIND:-127.0.0.1:8000}
case "$BIND" in *:*) ;; *) BIND="127.0.0.1:$BIND" ;; esac
BIND=${BIND/#0.0.0.0/127.0.0.1}
echo "health: $(curl -fsS "http://$BIND/health")"
REMOTE
