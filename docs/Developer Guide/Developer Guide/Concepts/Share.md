# Share
## Share theme

The share theme represents the layout, styles and scripts behind the Share notes functionality. The current implementation is a heavy adaptation of [trilium.rocks](https://trilium.rocks/) which is a third-party share theme.

*   The theme resides in `packages/share-theme`.
*   The HTML is defined in `src/templates` using EJS templating.
*   The `src/scripts` and `src/styles` subdirectories house the rest of the theme.

## Building the share theme

*   In `packages/share-theme`, run `pnpm build` to trigger a build. This will generate `dist` which will then be used by the server.
*   Alternatively, use `pnpm dev` to watch for changes.
*   `pnpm dist` is the same build, minified. It is what the app builds run, so a release ships the minified assets while local development keeps readable ones.

Both scripts clear `dist` first, since esbuild writes into it without removing what an earlier build left there — a minified release build would otherwise be copied alongside the unminified files `pnpm install` produces. A `--module=` build (`build-scripts`, `build-styles`) builds one entry point and deliberately does not clear, so it leaves the other's output alone.

## Where the code lives

The share subsystem is in `packages/trilium-core/src/share`, so that every runtime that carries core can serve it:

*   `shaca` is the read-only cache of the `_share` subtree, loaded from raw rows.
*   `content_renderer.ts` renders one of its notes into a page.
*   `handlers.ts` holds the routes as transport-neutral handlers: each takes a `ShareRequest` and returns a `ShareReply` (status, headers, body or redirect), touching no Express type. `route_paths.ts` lists the URL patterns on their own, free of imports, so a router can register them without loading the renderer behind them.

What differs per platform goes through the `ShareProvider` (`share_provider.ts`): where the rows come from, where the EJS templates come from, and whether a note is allowed to supply its own template.

|  | Server / desktop | Standalone / mobile |
| --- | --- | --- |
| Rows | a second, read-only `better-sqlite3` connection (`apps/server/src/share/sql.ts`) | the one sqlite-wasm connection, shared with every other route |
| Templates | read from disk | bundled into the build with `?raw` |
| A note's own EJS template | allowed when backend scripting is enabled | never — this build has no backend scripting |

## Integration with the server for the share functionality

The server renders the templates using EJS templating from the share theme and hosts the assets.

*   In dev mode, the templates and assets are served directly from `packages/share-theme/dist`.
    *   Modifications to the assets (scripts or styles) will reflect without having to restart the server. However the share theme needs to be built first (see previous section).
    *   Changes to the template will require a restart of the server, since they are cached. Simply press Enter in the console with `pnpm server:start` to quickly trigger a restart.
*   In production mode, the share theme is automatically built by the server build script and copied to `dist/share-theme`.

`apps/server/src/share/routes.ts` is the Express adapter over the core handlers, and `apps/server/src/share/share_provider.ts` registers the provider above.

## Integration with the standalone (in-browser) build

`apps/standalone` serves the same pages from the browser. A `/share/` request is claimed by the service worker, forwarded to the tab that owns the database, and answered by the worker's `BrowserRouter` (`apps/standalone/src/lightweight/browser_routes.ts`); `share_provider.ts` beside it supplies the rows and the bundled templates. Nothing outside the browser can reach these pages — there is no server listening — so this is for working on the share feature and for reading published notes locally, not for publishing.

*   The subsystem is loaded by a dynamic `import()` on the first `/share/` request, which keeps EJS, the share theme and the syntax highlighter (~950 KB together) out of the worker's startup bundle. That only holds while nothing in the eager graph imports `share/index.ts`, which is why it is not re-exported from the `@triliumnext/core` barrel.
*   `ejs` is aliased to its own browser build in `vite.config.mts`: the package's ESM entry imports `node:fs` and `node:path`, which it only needs when no `includer` is passed, and the renderer always passes one.
*   The share theme's assets are copied into the build at the paths `content_renderer.ts` writes into the page (`share/assets`, `assets/v<version>/images`), in place of the `express.static` routes the server registers.
*   The pages are rendered by the tab holding the database, so at least one app tab must be open for a `/share/` URL to resolve.

## Exporting to static HTML files

The static export lives in `packages/trilium-core/src/services/export/zip/share_theme.ts`, so both the server and the standalone build offer it. It works quite similar to the normal sharing functionality, but it uses `BNote` instead of `SNote` (and so on for other entity types), in order to work regardless of whether a note is shared or not.

The same templates are used, except that the rendered pages are stored in the archive instead of served to web clients. The theme's built files and the built-in icon fonts reach the provider through `ShareThemeExportAssets`, which each platform fills in its zip export factory:

*   The server reads them from disk (`apps/server/src/services/export/zip/share_theme.ts`).
*   The standalone build fetches them from `share/assets`, where it already copies them for the share pages. The file names come from the `virtual:share-theme-assets` module, which `vite.config.mts` generates from `packages/share-theme/dist` for both the page and the worker bundle.