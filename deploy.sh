#!/usr/bin/env bash
# Push the app to a static host over SSH.
#   HOST=seating@your-hetzner-box DEST=/var/www/seating ./deploy.sh
set -euo pipefail

HOST="${HOST:?set HOST, e.g. root@1.2.3.4 or user@seating.example.com}"
DEST="${DEST:-/var/www/seating}"

rsync -avz --delete \
  --exclude '.*' \
  index.html app.css app.js \
  "$HOST:$DEST/"

echo "Deployed to $HOST:$DEST"
