#!/usr/bin/env sh

DIR=`dirname "$0"`
export NODE_TLS_REJECT_UNAUTHORIZED=0

exec "$DIR/trilium"

