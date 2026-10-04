# Docker
To build the server for Docker:

*   Go to `apps/server` and run:
    *   `pnpm docker-build-debian` or
    *   `pnpm docker-build-alpine`.
*   To not only build but also run the Docker container, simply replace `docker-build` with `docker-start` (e.g. `pnpm docker-start-debian`).
*   To check that an image also runs as a non-root user, as CI does, run `sh scripts/check-docker-non-root.sh triliumnext-debian` (or `triliumnext-alpine`).

Build the images on Linux or in WSL. The build keeps only the host's prebuilt `better-sqlite3` binary, so an image built from a `dist` made on Windows fails at startup with `Cannot find module …/better_sqlite3.node`.

For the registries the image is published to, the legacy repositories and cleaning up old images, see <a class="reference-link" href="Docker%20Hub%20maintenance.md">Docker Hub maintenance</a>.