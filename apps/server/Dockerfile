# Since better-sqlite3 v13 the addon is N-API based and ships prebuilt binaries
# for every supported platform/arch inside the package itself, which the server
# build copies into ./dist. There is therefore no native compile step and no
# builder stage any more. The Linux prebuilds need glibc >= 2.34 (x64) and
# >= 2.38 (arm64), so the base image is trixie rather than bookworm (glibc 2.36).
# Platforms without a prebuild (32-bit ARM) are served by Dockerfile.legacy,
# which still compiles from source.
FROM node:24.21.0-trixie-slim

# Install only runtime dependencies
RUN apt-get update && \
    apt-get install -y --no-install-recommends \
    curl && \
    rm -rf \
    /var/lib/apt/lists/* \
    /var/cache/apt/*

WORKDIR /usr/src/app
COPY ./dist /usr/src/app
COPY ./start-docker.sh /usr/src/app

# A new named volume takes its owner from the mount point, so a container started with --user
# can write to it. Other UIDs need to pass through /home/node to reach a volume of their own.
RUN mkdir -p /home/node/trilium-data && \
    chown node:node /home/node/trilium-data && \
    chmod 700 /home/node/trilium-data && \
    chmod 711 /home/node

# The healthcheck reads the listening address the server records here.
ENV TRILIUM_DATA_DIR=/home/node/trilium-data

# Configure container
EXPOSE 8080
CMD [ "sh", "./start-docker.sh" ]
HEALTHCHECK --interval=60s --timeout=5s --start-period=30s CMD sh /usr/src/app/docker_healthcheck.sh
