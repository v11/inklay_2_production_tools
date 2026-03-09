#!/usr/bin/env bash
set -euo pipefail

if [ "$#" -ne 1 ]; then
  echo "Usage: $0 <beta|prod>"
  exit 1
fi

TARGET="$1"
case "$TARGET" in
  beta)
    SOURCE_FILE=".env.beta"
    ;;
  prod|production)
    SOURCE_FILE=".env.production"
    ;;
  *)
    echo "Unknown target: $TARGET (use beta or prod)"
    exit 1
    ;;
esac

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_DIR="$(cd "$SCRIPT_DIR/.." && pwd)"
SOURCE_PATH="$PROJECT_DIR/$SOURCE_FILE"
TARGET_PATH="$PROJECT_DIR/.env"

if [ ! -f "$SOURCE_PATH" ]; then
  echo "Missing $SOURCE_FILE"
  echo "Create $SOURCE_FILE in $PROJECT_DIR with at least:"
  echo "  FIREBASE_DB_URL=..."
  echo "  SERVICE_ACCOUNT_FILENAME=..."
  echo "  DEVICE_SECRET_PEPPER=..."
  exit 1
fi

cp "$SOURCE_PATH" "$TARGET_PATH"

echo "Switched Firebase config to '$TARGET'"

grep -E '^(FIREBASE_DB_URL|SERVICE_ACCOUNT_FILENAME)=' "$TARGET_PATH" || true
