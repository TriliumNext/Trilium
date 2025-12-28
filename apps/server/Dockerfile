FROM node:24.12.0-bullseye-slim AS builder
RUN corepack enable

# Install native dependencies since we might be building cross-platform.
WORKDIR /usr/src/app/build
COPY ./docker/package.json ./docker/pnpm-workspace.yaml /usr/src/app/
# We have to use --no-frozen-lockfile due to CKEditor patches
RUN pnpm install --no-frozen-lockfile --prod && pnpm rebuild

FROM node:24.12.0-bullseye-slim
# Install only runtime dependencies
RUN apt-get update && \
    apt-get install -y --no-install-recommends \
    gosu && \
    rm -rf \
    /var/lib/apt/lists/* \
    /var/cache/apt/*

WORKDIR /usr/src/app
COPY ./dist /usr/src/app
RUN rm -rf /usr/src/app/node_modules/better-sqlite3
COPY --from=builder /usr/src/app/node_modules/better-sqlite3 /usr/src/app/node_modules/better-sqlite3
COPY ./start-docker.sh /usr/src/app

# Configure container
EXPOSE 8080
CMD [ "sh", "./start-docker.sh" ]
HEALTHCHECK --start-period=10s CMD exec gosu node node /usr/src/app/docker_healthcheck.cjs