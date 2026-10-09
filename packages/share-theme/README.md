# Share theme

The default theme for [shared notes](../../docs/User%20Guide/User%20Guide/Advanced%20Usage/Sharing.md) and for the static HTML export. It started as the theme of [trilium.rocks](https://trilium.rocks) by [Zerebos](https://github.com/zerebos).

- `src/templates/` — the EJS templates. `packages/trilium-core/src/share/content_renderer.ts` renders them on the server; a note can replace `page.ejs` with its own through `~shareTemplate`.
- `src/page/` — the parts of the page around the note (layout, header, navigation tree, search, table of contents, footer), and `src/content/` — the styles and enhancements for the note's own content (math, Mermaid, link embeds, adaptive colors). A script imports its own stylesheet, which shares its name and folder: `toc.ts` imports `./toc.css`.
- `src/index.ts` — the entry point. It sets every script up and imports the stylesheets that have no script; the order of its imports is the cascade order.

`pnpm --filter share-theme build` bundles them into `dist/scripts.js` and `dist/scripts.css`, which the server, desktop, standalone and static-export builds copy. `pnpm install` runs it, but no `*:start` script does, so rebuild after changing a script or style (or run `pnpm --filter share-theme dev` to watch).
