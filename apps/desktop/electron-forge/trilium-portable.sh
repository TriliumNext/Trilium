#!/usr/bin/env sh

DIR=`dirname "$0"`
export TRILIUM_DATA_DIR="$DIR/trilium-data"
export TRILIUM_ELECTRON_DATA_DIR="$DIR/trilium-electron-data"

exec "$DIR/trilium"

