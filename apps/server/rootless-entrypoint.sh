#!/bin/bash
# Rootless entrypoint script for Trilium Notes
# Works with both Debian and Alpine-based images

# Check if runtime UID/GID match the expected values
if [ "${TRILIUM_UID}" != "$(id -u)" ] || [ "${TRILIUM_GID}" != "$(id -g)" ]; then
  echo "Detected UID:GID mismatch (current: $(id -u):$(id -g), expected: ${TRILIUM_UID}:${TRILIUM_GID})"
  # Check GID mismatch
  if [ "${TRILIUM_GID}" != "$(id -g)" ]; then
    echo "ERROR: Cannot change GID at runtime in rootless mode."
    echo "       Current GID: $(id -g), Expected GID: ${TRILIUM_GID}"
    echo "       Please use docker run with --user $(id -u):$(id -g) instead."
    exit 1
  fi
  # Check UID mismatch
  if [ "${TRILIUM_UID}" != "$(id -u)" ]; then
    echo "ERROR: Cannot change UID at runtime in rootless mode."
    echo "       Current UID: $(id -u), Expected UID: ${TRILIUM_UID}"
    echo "       Please use docker run with --user $(id -u):$(id -g) instead."
    exit 1
  fi
fi

# Make sure data directory has correct permissions
mkdir -p "${TRILIUM_DATA_DIR}"

# Start the app
exec node ./main.mjs
