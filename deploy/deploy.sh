#!/usr/bin/env bash
# Build on your laptop, copy to the IPC, restart the service.
# Usage: ./deploy/deploy.sh user@192.168.1.50
set -euo pipefail

TARGET="${1:?Usage: deploy.sh user@ipc-address}"
APP_DIR=/opt/hmi

cd "$(dirname "$0")/.."

echo "Building frontend..."
(cd web && npm ci && npm run build)

echo "Copying to $TARGET:$APP_DIR ..."
# The IPC keeps its own server/.env and server/data (user accounts); node_modules are installed on the IPC
rsync -az --delete \
  --exclude node_modules --exclude .git --exclude server/.env --exclude server/data \
  ./ "$TARGET:$APP_DIR/"

echo "Installing and restarting..."
ssh "$TARGET" "cd $APP_DIR/server && npm ci --omit=dev && sudo systemctl restart hmi"

echo "Done: http://${TARGET#*@}:3000"
