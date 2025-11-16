# Running a development build
First, follow the <a class="reference-link" href="../Environment%20Setup.md">Environment Setup</a>.

## Client

The client is not meant to be run by itself, despite being described as an app. See the documentation on the server instead.

## Server

*   To run the server in development mode, run `server:start`. The dev port is `8080`.
*   To run the server in production mode (with its own copy of the assets), run `server:start-prod`.
*   To build for Docker, see <a class="reference-link" href="Docker.md">Docker</a>.

To run with a custom port, change the `TRILIUM_PORT` environment variable from the `package.json`.

## Desktop

*   To run in development mode, use `pnpm desktop:start`.
*   To run in production mode, use `pnpm desktop:start-prod`.

## Safe mode

Safe mode is off by default, to enable it temporarily on a Unix shell, prepend the environment variable setting:

```
pnpm cross-env TRILIUM_SAFE_MODE=1 pnpm server:start
```

## Running on NixOS

When doing development, the Electron binary retrieved from NPM is not going to be compatible with NixOS, resulting in errors when trying to run it. However Trilium handles it automatically when running `pnpm desktop:start`.

If there's no `electron` the system path it will attempt to use `nix-shell` to obtain it.