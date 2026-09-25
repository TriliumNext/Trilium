#!/bin/sh

# Use built-in directory, unless the user has already overridden or mounted their data directory.
if [ -z "${TRILIUM_DATA_DIR:-}" ]; then
    if [ ! -d "$XDG_DATA_HOME/trilium-data" ] && [ -d "$HOME/.local/share/trilium-data" ]; then
        export TRILIUM_DATA_DIR="$HOME/.local/share/trilium-data"
    else
        export TRILIUM_DATA_DIR="$XDG_DATA_HOME/trilium-data"
    fi
fi

exec zypak-wrapper /app/lib/electron/trilium /app/lib/trilium "$@"
