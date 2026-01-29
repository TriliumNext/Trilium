# Project Structure
As the application grew in complexity, we decided to switch to a monorepo based on `pnpm`. Our initial monorepo implementation used NX, but we've switched to pure `pnpm` workspaces and our own build scripts.

## Project structure

The mono-repo is mainly structured in:

*   `apps`, representing runnable entry-points such as the `desktop`, the `server` but also additional tooling.
    *   `client`, representing the front-end that is used both by the server and the desktop application.
    *   `server`, representing the Node.js / server version of the application.
    *   `desktop`, representing the Electron-based desktop application.
    *   `web-clipper`, representing the browser extension to easily clip web pages into Trilium, with support for both Firefox and Chrome (manifest V3).
*   `packages`, containing dependencies used by one or more `apps`.
    *   `commons`, containing shared code for all the apps.

## Working with the project

For example to run the server instance:

```
pnpm server:start
```

## Running and building

Each application has a number of tasks. Here's a non-exhaustive list of the tasks that are useful during development. See <a class="reference-link" href="Building">Building</a>.

## Managing dependencies across the mono-repo

We are using [pnpm workspaces](https://pnpm.io/workspaces) to manage the project structure. The workspace configuration is in `pnpm-workspace.yaml` at project level but it generally should not be modified.