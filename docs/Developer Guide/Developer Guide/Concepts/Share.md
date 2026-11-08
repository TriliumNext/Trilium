# Share
## Share theme

The share theme represents the layout, styles and scripts behind the Share notes functionality. The current implementation is a heavy adaptation of [trilium.rocks](https://trilium.rocks/) which is a third-party share theme.

*   The theme resides in `packages/share-theme`.
*   The HTML is defined in `src/templates` using EJS templating.
*   `src/page` holds the parts of the page around the note (layout, header, navigation tree, theme switch, search, table of contents, footer) and `src/content` the styles and scripts for the note's own content (math, Mermaid, link embeds, adaptive colors). A script imports its own stylesheet, which sits next to it under the same name: `toc.ts` imports `./toc.css`.
*   `src/index.ts` is the single entry point. It sets every script up and imports the stylesheets that have no script; the order of its imports is the order of the bundled stylesheet.
*   The build emits `scripts.js`, `tree.js` and `scripts.css`, the only stylesheet a shared page loads (`#shareOmitDefaultCss` drops it).

## Building the share theme

The share theme has no build of its own: the client's Vite build bundles it, through `shareTheme()` in `apps/client/vite-plugins.mts`, which standalone's build uses as well.

*   `scripts.js` and its chunks are written to the client's `src/`, next to the app's chunks, so the theme and the app share one copy of what both use (such as Mermaid). The theme imports Mermaid with a plain `import("mermaid")`.
*   `scripts.css` and `tree.js` are built on their own, for older browsers than the app (`chrome96`). `scripts.css` keeps the order in which `index.ts` imports the stylesheets, which the app's build would change by moving the ones the app shares into its chunks. `tree.js` builds to one file, since the page's first paint waits for it.
*   `share_theme.json` lists the files a page can load, with those only Mermaid loads apart, for the static export.
*   The development servers answer `scripts.js` and `tree.js` from source and `scripts.css` empty, since Vite injects the styles from the modules. A change to a script or a style needs no rebuild.

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

*   In dev mode, the client's Vite server answers the theme's scripts from source (see the previous section), and the templates are read from `packages/share-theme/src/templates`.
    *   Changes to the template will require a restart of the server, since they are cached. Simply press Enter in the console with `pnpm server:start` to quickly trigger a restart.
*   In production mode, `/share/assets/` is served from the client build's `src/`, and the templates are copied to `dist/share-theme`.

`apps/server/src/share/routes.ts` is the Express adapter over the core handlers, and `apps/server/src/share/share_provider.ts` registers the provider above.

## Integration with the standalone (in-browser) build

`apps/standalone` serves the same pages from the browser. A `/share/` request is claimed by the service worker, forwarded to the tab that owns the database, and answered by the worker's `BrowserRouter` (`apps/standalone/src/lightweight/browser_routes.ts`); `share_provider.ts` beside it supplies the rows and the bundled templates. Nothing outside the browser can reach these pages — there is no server listening — so this is for working on the share feature and for reading published notes locally, not for publishing.

*   The subsystem is loaded by a dynamic `import()` on the first `/share/` request, which keeps EJS, the share theme and the syntax highlighter (~950 KB together) out of the worker's startup bundle. That only holds while nothing in the eager graph imports `share/index.ts`, which is why it is not re-exported from the `@triliumnext/core` barrel.
*   `ejs` is aliased to its own browser build in `vite.config.mts`: the package's ESM entry imports `node:fs` and `node:path`, which it only needs when no `includer` is passed, and the renderer always passes one.
*   The share theme's files are in `src/` with the app's chunks, and a static host cannot serve `share/assets` from there, so the build writes `scripts.js`, `scripts.css` and `tree.js` to `share/assets` as well, the first two loading their namesakes in `src/`. The icon fonts and images are copied to the paths `content_renderer.ts` writes into the page (`share/assets/fonts`, `assets/v<version>/images`), in place of the `express.static` routes the server registers.
*   The pages are rendered by the tab holding the database, so at least one app tab must be open for a `/share/` URL to resolve.

## Exporting to static HTML files

The static export lives in `packages/trilium-core/src/services/export/zip/share_theme.ts`, so both the server and the standalone build offer it. It works quite similar to the normal sharing functionality, but it uses `BNote` instead of `SNote` (and so on for other entity types), in order to work regardless of whether a note is shared or not.

The same templates are used, except that the rendered pages are stored in the archive instead of served to web clients. The theme's built files and the built-in icon fonts reach the provider through `ShareThemeExportAssets`, which each platform fills in its zip export factory. Both copy the files `share_theme.json` lists into `assets/`, and those of Mermaid only when a note of the subtree has a diagram (`getShareThemeExportFiles()`):

*   The server reads them from the client build's `src/` (`apps/server/src/services/export/zip/share_theme.ts`), so exporting from a development server needs `pnpm client:build` first.
*   The standalone build fetches them from `/src/`. Its development server builds no share theme, so exporting needs a production build.