#!/bin/sh
# Probes the running server for docker's HEALTHCHECK.
#
# The server records where it is listening once it has bound, so there is nothing to resolve
# here: no config.ini to parse and no guess at a port. A missing file means the server never
# reached the point of listening, which is itself unhealthy.
#
# curl reports its own failures (7 refused, 28 timeout), and treats a 3xx as success, so the
# status is compared here instead of relying on --fail. Docker reads 0 as healthy and 1 as
# unhealthy, and reserves 2, so every failure is collapsed onto 1.

data_dir="${TRILIUM_DATA_DIR:-/home/node/trilium-data}"
url_file="$data_dir/healthcheck-url"
socket_file="$data_dir/healthcheck-socket"

[ -s "$url_file" ] || exit 1
url=$(cat "$url_file") || exit 1

# -k because a loopback probe asks whether the server answers, not who it is, and the certificate
# is usually self-signed and issued for a name this request does not use.
if [ -s "$socket_file" ]; then
    status=$(curl -s -k --max-time 2 -o /dev/null -w '%{http_code}' \
        --unix-socket "$(cat "$socket_file")" "$url") || exit 1
else
    status=$(curl -s -k --max-time 2 -o /dev/null -w '%{http_code}' "$url") || exit 1
fi

[ "$status" = "200" ] || exit 1
