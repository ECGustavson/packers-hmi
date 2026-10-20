#!/usr/bin/env bash
# Build the image on your laptop, ship it to the IPC, restart the container.
# Usage: ./deploy/deploy-docker.sh user@192.168.1.50 [platform]
#   platform defaults to linux/arm64 (CX9240). Use linux/amd64 for x86 IPCs.
set -euo pipefail

TARGET="${1:?Usage: deploy-docker.sh user@ipc-address [platform]}"
PLATFORM="${2:-linux/arm64}"
APP_DIR=/opt/hmi

cd "$(dirname "$0")/.."

echo "Building image for $PLATFORM..."
docker buildx build --platform "$PLATFORM" -t hmi:latest --load .

echo "Sending image to $TARGET..."
ssh "$TARGET" "mkdir -p $APP_DIR"
docker save hmi:latest | gzip | ssh "$TARGET" "gunzip | docker load"

echo "Copying config..."
scp deploy/docker-compose.yml "$TARGET:$APP_DIR/"
# .env is created from the example on first deploy only, never overwritten
ssh "$TARGET" "test -f $APP_DIR/.env" || scp server/.env.example "$TARGET:$APP_DIR/.env"

echo "Starting..."
ssh "$TARGET" "cd $APP_DIR && docker compose up -d --force-recreate && docker image prune -f"

echo "Done: http://${TARGET#*@}:3000"
