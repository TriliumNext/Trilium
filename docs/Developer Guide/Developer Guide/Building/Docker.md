# Docker
To build the server for Docker:

*   Go to `apps/server` and run:
    *   `pnpm docker-build-debian` or
    *   `pnpm docker-build-alpine`.
*   Similarly, to build the rootless versions: `pnpm docker-build-rootless-debian` or `pnpm docker-build-rootless-alpine`.
*   To not only build but also run the Docker container, simply replace `docker-build` with `docker-start` (e.g. `pnpm docker-start-debian`).