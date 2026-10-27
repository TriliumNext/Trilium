#!/bin/sh

# Use built-in directory, unless the user has already overridden or mounted their data directory.
if [ -z "${TRILIUM_DATA_DIR:-}" ]; then
    if [ ! -d "$XDG_DATA_HOME/trilium-data" ] && [ -d "$HOME/.local/share/trilium-data" ]; then
        export TRILIUM_DATA_DIR="$HOME/.local/share/trilium-data"
    else
        export TRILIUM_DATA_DIR="$XDG_DATA_HOME/trilium-data"
    fi
fi

# Chromium hands GNOME's tray its icon as a file in TMPDIR; the sandbox's /tmp is private,
# while this directory has the same path on the host.
export TMPDIR="$XDG_RUNTIME_DIR/app/$FLATPAK_ID"

exec zypak-wrapper /app/lib/electron/trilium /app/lib/trilium "$@"
