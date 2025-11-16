# Share
## Share theme

The share theme represents the layout, styles and scripts behind the Share notes functionality. The current implementation is a heavy adaptation of [trilium.rocks](https://trilium.rocks/) which is a third-party share theme.

*   The theme resides in `packages/share-theme`.
*   The HTML is defined in `src/templates` using EJS templating.
*   The `src/scripts` and `src/styles` subdirectories house the rest of the theme.

## Building the share theme

*   In `packages/share-theme`, run `pnpm build` to trigger a build. This will generate `dist` which will then be used by the server.
*   Alternatively, use `pnpm dev` to watch for changes.

## Integration with the server for the share functionality

The server renders the templates using EJS templating from the share theme and hosts the assets.

*   In dev mode, the templates and assets are served directly from `packages/share-theme/dist`.
    *   Modifications to the assets (scripts or styles) will reflect without having to restart the server. However the share theme needs to be built first (see previous section).
    *   Changes to the template will require a restart of the server, since they are cached. Simply press Enter in the console with `pnpm server:start` to quickly trigger a restart.
*   In production mode, the share theme is automatically built by the server build script and copied to `dist/share-theme`.

The server route handling this functionality is in `src/share/routes.ts`.

## Exporting to static HTML files

This functionality is also handled by the server, but in `src/services/export/zip/share_theme` instead. It works quite similar to the normal sharing functionality, but it uses `BNote` instead of `SNote` (and so on for other entity types), in order to work regardless of whether a note is shared or not.

The same templates are used and rendered by the server, except that they are stored in a file instead of served to web clients.