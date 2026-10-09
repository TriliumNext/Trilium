# Share theme

The default theme for [shared notes](../../docs/User%20Guide/User%20Guide/Advanced%20Usage/Sharing.md) and for the static HTML export. It started as the theme of [trilium.rocks](https://trilium.rocks) by [Zerebos](https://github.com/zerebos).

- `src/templates/` — the EJS templates. `packages/trilium-core/src/share/content_renderer.ts` renders them on the server; a note can replace `page.ejs` with its own through `~shareTemplate`.
- `src/scripts/` and `src/styles/` — the client-side script and stylesheet every shared page loads.

`pnpm --filter share-theme build` bundles the scripts and styles into `dist/`, which the server, desktop, standalone and static-export builds copy. `pnpm install` runs it, but no `*:start` script does, so rebuild after changing a script or style (or run `pnpm --filter share-theme dev` to watch).
