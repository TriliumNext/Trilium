# Live reload (HMR)
Trilium uses Vite's HMR (hot module reloading) mechanism.

## Server live reload

If running the server using `pnpm server:start`, the server will watch for changes. For React components, they will be hot-reloaded without requiring a refresh. For other services, it will reload the page.

## Desktop live reload

`pnpm desktop:start` acts the same as `pnpm server:start` with hot-reloading for client-side changes. Changes on the desktop side require a complete re-run of the `pnpm desktop:start` command.