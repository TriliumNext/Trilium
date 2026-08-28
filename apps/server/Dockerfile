# Since better-sqlite3 v13 the addon is N-API based and ships prebuilt binaries
# for every supported platform/arch inside the package itself, which the server
# build copies into ./dist. There is therefore no native compile step and no
# builder stage any more. The Linux prebuilds need glibc >= 2.34 (x64) and
# >= 2.38 (arm64), so the base image is trixie rather than bullseye (glibc 2.31).
# Platforms without a prebuild (32-bit ARM) are served by Dockerfile.legacy,
# which still compiles from source.
FROM node:24.19.0-trixie-slim

# Install only runtime dependencies
RUN apt-get update && \
    apt-get install -y --no-install-recommends \
    gosu curl && \
    rm -rf \
    /var/lib/apt/lists/* \
    /var/cache/apt/*

WORKDIR /usr/src/app
COPY ./dist /usr/src/app
COPY ./start-docker.sh /usr/src/app

# The healthcheck reads the listening address the server records here.
ENV TRILIUM_DATA_DIR=/home/node/trilium-data

# Configure container
EXPOSE 8080
CMD [ "sh", "./start-docker.sh" ]
HEALTHCHECK --interval=60s --timeout=5s --start-period=30s CMD exec gosu node sh /usr/src/app/docker_healthcheck.sh
