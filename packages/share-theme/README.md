# Share theme

The default theme for [shared notes](../../docs/User%20Guide/User%20Guide/Advanced%20Usage/Sharing.md) and for the static HTML export. It started as the theme of [trilium.rocks](https://trilium.rocks) by [Zerebos](https://github.com/zerebos).

- `src/templates/` — the EJS templates. `packages/trilium-core/src/share/content_renderer.ts` renders them on the server; a note can replace `page.ejs` with its own through `~shareTemplate`.
- `src/page/` — the parts of the page around the note (layout, header, navigation tree, search, table of contents, footer), and `src/content/` — the styles and enhancements for the note's own content (math, Mermaid, link embeds, adaptive colors). A script imports its own stylesheet, which shares its name and folder: `toc.ts` imports `./toc.css`.
- `src/index.ts` — the entry point. It sets every script up and imports the stylesheets that have no script; the order of its imports is the cascade order.

The client's Vite build bundles them, with `shareTheme()` from `apps/client/vite-plugins.mts`, into `scripts.js`, `scripts.css` and `tree.js` beside its own chunks, so the theme and the app load one copy of the code they share, and lists the files in `share_theme.json` for the static export. The development servers answer the three files from source.
