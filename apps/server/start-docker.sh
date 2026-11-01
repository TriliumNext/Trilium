#!/bin/sh

# Without root (`--user`, Kubernetes `runAsNonRoot`, rootless Podman) the container can neither
# remap `node` nor change ownership, so Trilium runs as the user it was started with.
if [ "$(id -u)" != "0" ]; then
    if [ -n "${USER_UID}${USER_GID}" ]; then
        echo "Running as $(id -u):$(id -g), so USER_UID and USER_GID are ignored; set the user with --user instead"
    fi
    exec node ./main.mjs
fi

[ ! -z "${USER_UID}" ] && usermod -u ${USER_UID} node || echo "No USER_UID specified, leaving 1000"
[ ! -z "${USER_GID}" ] && groupmod -og ${USER_GID} node || echo "No USER_GID specified, leaving 1000"

chown -R node:node /home/node
exec su -c "node ./main.mjs" node
