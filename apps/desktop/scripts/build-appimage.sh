#!/usr/bin/env bash
#
# Build an AppImage from the packaged Electron app.
#
# Usage: ./build-appimage.sh [arch]
#   arch: x64 or arm64 (default: x64)
#
# Prerequisites:
#   - The Electron app must already be packaged via `electron-forge make` or `electron-forge package`
#   - appimagetool must be available in PATH
#
# Environment variables:
#   TRILIUM_ARTIFACT_NAME_HINT: If set, used as the base name for the output file

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
DESKTOP_DIR="$(cd "$SCRIPT_DIR/.." && pwd)"
FORGE_DIR="$DESKTOP_DIR/electron-forge"

ARCH="${1:-x64}"
EXECUTABLE_NAME="trilium"
PRODUCT_NAME="Trilium Notes"

# Map architecture names
case "$ARCH" in
    x64)   APPIMAGE_ARCH="x86_64" ;;
    arm64) APPIMAGE_ARCH="aarch64" ;;
    *)     echo "Unsupported architecture: $ARCH"; exit 1 ;;
esac

# Find the packaged app directory
PACKAGED_DIR="$DESKTOP_DIR/dist/out/$PRODUCT_NAME-linux-$ARCH"
if [ ! -d "$PACKAGED_DIR" ]; then
    echo "Error: Packaged app not found at $PACKAGED_DIR"
    echo "Run 'electron-forge make' or 'electron-forge package' first."
    exit 1
fi

echo "Building AppImage from: $PACKAGED_DIR"

# Create AppDir structure
APPDIR="$DESKTOP_DIR/dist/out/$PRODUCT_NAME.AppDir"
rm -rf "$APPDIR"
mkdir -p "$APPDIR"

# Copy the packaged app contents into the AppDir
cp -a "$PACKAGED_DIR"/. "$APPDIR/"

# Create the AppRun entry point
cat > "$APPDIR/AppRun" << 'APPRUN_EOF'
#!/bin/bash
HERE="$(dirname "$(readlink -f "$0")")"
exec "$HERE/trilium" "$@"
APPRUN_EOF
chmod +x "$APPDIR/AppRun"

# Create the .desktop file
cat > "$APPDIR/$EXECUTABLE_NAME.desktop" << DESKTOP_EOF
[Desktop Entry]
Name=$PRODUCT_NAME
Comment=Build your personal knowledge base with Trilium Notes
GenericName=Note Taking Application
Exec=$EXECUTABLE_NAME %U
Icon=$EXECUTABLE_NAME
Type=Application
StartupNotify=true
StartupWMClass=$PRODUCT_NAME
Categories=Office;Utility;
DESKTOP_EOF

# Copy the icon (AppImage expects it at the root of AppDir)
if [ -f "$FORGE_DIR/app-icon/png/256x256.png" ]; then
    cp "$FORGE_DIR/app-icon/png/256x256.png" "$APPDIR/$EXECUTABLE_NAME.png"
elif [ -f "$APPDIR/icon.png" ]; then
    cp "$APPDIR/icon.png" "$APPDIR/$EXECUTABLE_NAME.png"
else
    echo "Warning: No icon found"
fi

# Determine output filename
UPLOAD_DIR="$DESKTOP_DIR/upload"
mkdir -p "$UPLOAD_DIR"

if [ -n "${TRILIUM_ARTIFACT_NAME_HINT:-}" ]; then
    OUTPUT_NAME="${TRILIUM_ARTIFACT_NAME_HINT//\//-}.AppImage"
else
    VERSION=$(node -e "console.log(require('$DESKTOP_DIR/package.json').version)")
    OUTPUT_NAME="TriliumNotes-v${VERSION}-linux-${ARCH}.AppImage"
fi

OUTPUT_PATH="$UPLOAD_DIR/$OUTPUT_NAME"

# Build the AppImage
echo "Creating AppImage: $OUTPUT_PATH"
ARCH="$APPIMAGE_ARCH" appimagetool "$APPDIR" "$OUTPUT_PATH"

# Clean up the AppDir
rm -rf "$APPDIR"

echo "AppImage created successfully: $OUTPUT_PATH"
