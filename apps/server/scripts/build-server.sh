#!/usr/bin/env bash

set -e  # Fail on any command error

# Debug output
echo "Matrix Arch: $MATRIX_ARCH"

# Detect architecture from matrix input, fallback to system architecture
if [ -n "$MATRIX_ARCH" ]; then
    ARCH=$MATRIX_ARCH
else
    ARCH=$(uname -m)
    # Convert system architecture to our naming convention
    case $ARCH in
        x86_64) ARCH="x64" ;;
        aarch64) ARCH="arm64" ;;
    esac
fi

# Debug output
echo "Selected Arch: $ARCH"

script_dir=$(realpath $(dirname $0))

# Set Node.js version and architecture-specific filename
NODE_VERSION=$(cat "../../.nvmrc")
BUILD_DIR="$script_dir/../dist"
DIST_DIR="$script_dir/../out"

NODE_FILENAME=node-v${NODE_VERSION}-linux-${ARCH}

echo "Downloading Node.js runtime $NODE_FILENAME..."
cd $BUILD_DIR
wget -qO- https://nodejs.org/dist/v${NODE_VERSION}/${NODE_FILENAME}.tar.xz | tar xfJ -
mv $NODE_FILENAME node
cd ..


rm -rf $BUILD_DIR/node/lib/node_modules/{npm,corepack} \
    $BUILD_DIR/node/bin/{npm,npx,corepack} \
    $BUILD_DIR/node/CHANGELOG.md \
    $BUILD_DIR/node/include/node \
    $BUILD_DIR/node_modules/electron* \
    $BUILD_DIR/electron*.{js,map}

printf "#!/bin/sh\n./node/bin/node main.cjs\n" > $BUILD_DIR/trilium.sh
chmod 755 $BUILD_DIR/trilium.sh

VERSION=`jq -r ".version" package.json`

ARCHIVE_NAME="TriliumNotes-Server-${VERSION}-linux-${ARCH}"
echo "Creating Archive $ARCHIVE_NAME..."

mkdir $DIST_DIR
cp -r "$BUILD_DIR" "$DIST_DIR/$ARCHIVE_NAME"
cd $DIST_DIR
tar cJf "$ARCHIVE_NAME.tar.xz" "$ARCHIVE_NAME"
rm -rf "$ARCHIVE_NAME"

echo "Server Build Completed!"