# Trilium Web Clipper

## Context

The Web Clipper is an extension for the Trilium Notes application, an open-source note-taking application that can be used either in standalone mode via the desktop application or connected to a server.

The extension lives in the official monorepo, [TriliumNext/Trilium](https://github.com/TriliumNext/Trilium), under `apps/web-clipper`. The sources archive holds the monorepo files the build reads, unchanged and at the same paths:

- `apps/web-clipper`, the extension;
- a few stylesheets and fonts from `apps/client`, the Trilium application, whose styles the popup and options page share;
- the workspace files: `package.json`, `pnpm-workspace.yaml`, `pnpm-lock.yaml`, `tsconfig.base.json` and `patches/`.

Each release is a snapshot of the commit tagged `web-clipper-v` followed by the version in `apps/web-clipper/package.json`.

There are some warnings regarding the use of `innerHTML`. They come from [`defuddle`](https://github.com/kepano/defuddle), the article extraction library behind the Obsidian Web Clipper, which the extension installs unmodified from npm. It runs only when the user opens the popup or saves a page, and it removes scripts, event handler attributes and `javascript:` URLs from the article it returns.

## Building from source

Requirements: Node.js 24 and pnpm 12.10.1 (`npm install -g pnpm@12.10.1`).

From the root of the sources archive:

1.  `pnpm install --filter web-clipper --frozen-lockfile` to install the dependencies.
2.  `pnpm --filter web-clipper build:firefox` to build the Firefox extension.
3.  The output will be available in `apps/web-clipper/.output/firefox-mv2`.

## Testing

To test it, a functional Trilium Notes desktop application is required:

1.  Download the latest version of Trilium Notes from [https://triliumnotes.org/](https://triliumnotes.org/) (top-right bottom automatically detects the platform).
2.  During the first setup, create a new database.
3.  Allow the Firewall port if asked.
4.  Install the Web Clipper extension into the browser.
5.  The extension should be able to see the Trilium instance and become active.
6.  Web pages can now be clipped and they will appear in the local Trilium instance.
