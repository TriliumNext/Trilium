# Share theme

The default theme for [shared notes](../../docs/User%20Guide/User%20Guide/Advanced%20Usage/Sharing.md) and for the static HTML export. It started as the theme of [trilium.rocks](https://trilium.rocks) by [Zerebos](https://github.com/zerebos).

- `src/templates/` — the EJS templates. `packages/trilium-core/src/share/content_renderer.ts` renders them on the server; a note can replace `page.ejs` with its own through `~shareTemplate`.
- `src/page/` — the parts of the page around the note (layout, header, navigation tree, search, table of contents, footer), and `src/content/` — the styles and enhancements for the note's own content (math, Mermaid, link embeds, adaptive colors). A part's script and stylesheet share a name and a folder: `toc.ts`, `toc.css`.
- `src/index.ts` and `src/index.css` — the two entry points. `index.ts` sets every script up; `index.css` imports every stylesheet, and its order is the cascade order.

`pnpm --filter share-theme build` bundles them into `dist/` (`scripts.js`, `styles.css`, and `scripts.css` for the third-party styles `index.ts` imports), which the server, desktop, standalone and static-export builds copy. `pnpm install` runs it, but no `*:start` script does, so rebuild after changing a script or style (or run `pnpm --filter share-theme dev` to watch).
