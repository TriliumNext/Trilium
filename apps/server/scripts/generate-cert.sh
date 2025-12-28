#!/usr/bin/env bash
# Script generates certificate by default into the ~/trilium-data/cert where it is expected by Trilium
# If directory is given in argument, certificate will be created there.

if [ $# -eq 0 ]
  then
    DIR=~/trilium-data/cert
else
    DIR=$1
fi

mkdir -p "$DIR"
cd "$DIR"

openssl req -newkey rsa:4096 -x509 -sha256 -days 3650 -nodes -out cert.crt -keyout key.key
