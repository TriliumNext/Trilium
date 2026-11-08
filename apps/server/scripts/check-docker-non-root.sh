#!/bin/sh
# Starts a Trilium image as a non-root user and fails unless it reports healthy.
#
# Usage: check-docker-non-root.sh <image>
#
# Every case runs hardened the way Kubernetes `restricted` pods and rootless setups do: a
# read-only root filesystem, no capabilities and no-new-privileges. The cases differ in who
# owns the data directory:
#   - UID 1000 (`node`) on a fresh named volume, which Docker creates from the image's
#     mount point, so the image must provide one that `node` can write to.
#   - An arbitrary UID on a directory it owns, as when mounting a host directory to match a
#     host user, so the path to the data directory must be traversable by users other than
#     `node`.

set -eu

image="${1:?usage: $0 <image>}"
data_dir="/home/node/trilium-data"
timeout=120
failed=0
containers=""

cleanup() {
    for name in $containers; do
        docker rm -f "$name" >/dev/null 2>&1 || true
        docker volume rm -f "$name-data" >/dev/null 2>&1 || true
    done
}
trap cleanup EXIT

# start <name> <uid:gid> [owner]: owner, when given, is set on the volume before the start.
start() {
    name="$1"
    user="$2"
    owner="${3:-}"
    containers="$containers $name"
    mount="type=volume,src=$name-data,dst=$data_dir"
    # `docker volume create` reuses an existing volume, such as one an interrupted run left behind.
    docker rm -f "$name" >/dev/null 2>&1 || true
    docker volume rm -f "$name-data" >/dev/null
    docker volume create "$name-data" >/dev/null
    if [ -n "$owner" ]; then
        docker run --rm --user 0:0 --entrypoint chown -v "$name-data:/data" "$image" "$owner" /data
        # Docker fills an empty volume from the image's mount point, owner included, but never
        # a host directory mounted with -v, which this volume stands in for.
        mount="$mount,volume-nocopy=true"
    fi
    docker run -d --name "$name" \
        --user "$user" \
        --read-only --tmpfs /tmp \
        --cap-drop ALL --security-opt no-new-privileges \
        --mount "$mount" \
        "$image" >/dev/null
}

# wait_healthy <name>: waits for Docker's health status and prints the logs on failure.
wait_healthy() {
    name="$1"
    elapsed=0
    while [ "$elapsed" -lt "$timeout" ]; do
        state=$(docker inspect -f '{{.State.Status}} {{if .State.Health}}{{.State.Health.Status}}{{end}}' "$name")
        case "$state" in
            "running healthy") echo "ok      $name"; return 0 ;;
            "running starting") ;;
            *) break ;;
        esac
        sleep 2
        elapsed=$((elapsed + 2))
    done

    echo "FAILED  $name: $state after ${elapsed}s"
    echo "--- container log"
    docker logs "$name" 2>&1 | tail -n 40
    echo "--- healthcheck log"
    docker inspect -f '{{if .State.Health}}{{range .State.Health.Log}}{{.ExitCode}}: {{.Output}}{{end}}{{end}}' "$name"
    failed=1
}

start trilium_nonroot_node 1000:1000
start trilium_nonroot_other 1234:1234 1234:1234

wait_healthy trilium_nonroot_node
wait_healthy trilium_nonroot_other

exit "$failed"
