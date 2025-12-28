#!/usr/bin/env bash

SCRIPT_DIR=$(realpath $(dirname $0))
DB_FILE_PATH="$SCRIPT_DIR/../data/document.db"
SCHEMA_FILE_PATH="$SCRIPT_DIR/../src/assets/db/schema.sql"

if ! command -v sqlite3 &> /dev/null; then
  echo "Missing command: sqlite3"
  exit 1
fi

sqlite3 "$DB_FILE_PATH" .schema | grep -v "sqlite_sequence" > "$SCHEMA_FILE_PATH"

echo "DB schema exported to $SCHEMA_FILE_PATH"