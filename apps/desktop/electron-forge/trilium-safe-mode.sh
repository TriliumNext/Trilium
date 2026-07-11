#!/usr/bin/env sh

DIR=`dirname "$0"`
export TRILIUM_SAFE_MODE=1

exec "$DIR/trilium" --disable-gpu

