---
name: developing-share-pages
description: Use when working on Trilium's share functionality — shared pages under `/share/`, the static HTML (share-theme) export, the share theme package (`packages/share-theme`: EJS templates, page model, browser scripts and CSS), core's share renderer (`packages/trilium-core/src/share/content_renderer.ts`, `handlers.ts`, shaca), the per-platform share providers, `~shareTemplate` custom templates, `~shareHtml` snippets, or any `#share*` label. Covers where each piece runs (server, desktop, standalone worker, visitor's browser), the render pipeline from note to page, the page model and its template variables, what custom templates are promised, CSS ordering, how to test each layer (both core runners, happy-dom, node:vm), and the traps already hit on this code.
---

# Developing shared pages

A shared note is rendered **on the backend** into a complete HTML page by core, using the share
theme's EJS templates, and then enhanced **in the visitor's browser** by the share theme's script
bundle. The same renderer produces the static HTML export, with every page written to a ZIP.

## Where the code lives

```
packages/trilium-core/src/share/        backend, runs in server, desktop and the standalone worker
  route_paths.ts       SHARE_ROUTE_PATHS (import-free, so a platform can register routes cheaply)
  handlers.ts          transport-neutral handlers: credentials, protected notes, raw, images, search
  content_renderer.ts  note → content HTML (getContent), page render (renderNoteContent,
                       renderNoteForExport), preparePageContent, highlighting
  shaca/               share cache: SNote/SBranch/SAttribute/SAttachment over a read-only SQL view
  share_provider.ts    ShareProvider interface: sql, readTemplate, isScriptingEnabled, isReady
apps/server/src/share/                  Express adapter (routes.ts) + Node provider (share_provider.ts)
apps/standalone/src/lightweight/        browser provider (share_provider.ts: templates bundled ?raw)
                                        and route adapter (browser_routes.ts)
packages/trilium-core/src/services/export/zip/share_theme.ts   static export (renderNoteForExport)
packages/share-theme/
  src/model/page.ts    the page model: pure functions from notes to template values
  src/templates/       page.ejs + partials (boot_script, tree_item, toc_item, prev_next, 404)
  src/index.ts         browser entry; imports CSS in cascade order, calls each setup*()
  src/page/            page chrome: one script next to its CSS (layout, header, navigation,
                       search, toc, theme_switch, footer)
  src/content/         content enhancements (math, mermaid) and content CSS
  scripts/build.ts     esbuild → dist/scripts.js + dist/scripts.css, and dist/tree.js on its own
                       (no code splitting, so it loads as one file) (run by tsx)
```

`packages/share-theme/package.json` exports `./templates/*` and `./model/*` **from source** (core
imports the model as `@triliumnext/share-theme/model/page`); everything else resolves to `dist/`.

## The render pipeline

1. **Route** — `handlers.ts` resolves the note through shaca, checks `shareCredentials`, rejects
   protected notes, and calls `renderNoteContent(note, canAccessEmbed)`. A page route first awaits
   `ensureShareHighlighting()` (the renderer is synchronous; language registration is not).
2. **Content** — `getContent(note, options)` renders by note type into `{ header, content, isEmpty }`.
   Text goes through `renderText()` (node-html-parser): include-note embeds via the commons
   resolver (`resolveContentEmbed`), link previews via commons markup, reference links, inline
   links via `getShareLink()`, syntax highlighting bounded by `shouldSyntaxHighlight()`.
3. **Template values** — `renderNoteContentInternal()` builds the variables: the legacy ones
   (`note`, `content`, `subRoot`, `cssToLoad`, `jsToLoad`, `t`, `utils`, `ancestors`, …) plus the
   page model's (`head`, `snippets`, `logo`, `prevNext`, `navigation`, `childLinks`, `language`,
   `lastUpdated`, `contentClasses`).
4. **Template** — a `~shareTemplate` (only when backend scripting is enabled) gets those values with
   the content as it is. The default `page.ejs` additionally gets the output of
   `preparePageContent()`: content with heading anchors and image `alt`/`loading`, `headings` and
   `toc`.
5. **Browser** — `tree.js`, the first entry of `jsToLoad` and the only `blocking="render"` one,
   restores the tree's expansion, scroll position and clicked clone before the first paint.
   `scripts.js` then wires the expand buttons, search, ToC scroll tracking, theme switch, footer
   date, math, Mermaid, link previews and tabs. `boot_script.ejs` runs inline in `<head>` before the
   first paint (theme class, collapsed panes, `window.glob`).

The static export calls `renderNoteForExport()` with `isStatic: true`, which also expands embeds
at every depth and drops the login link and the last-updated date.

## The page model (`packages/share-theme/src/model/page.ts`)

Everything a template would otherwise compute lives here, as pure functions over `ShareNote`,
the structural subset of a note that both `SNote` and `BNote` satisfy (`pnpm typecheck` verifies
this; extend the interface rather than importing core types). Its spec runs on plain fake notes
(`fakeNote()` / `addChild()` in `page.spec.ts`) — no shaca, no database.

| Function | Feeds |
| --- | --- |
| `getPageHead` | title, description, no-index, OpenGraph (relative image completed with `#shareOpenGraphURL`), `metaTags` |
| `getHtmlSnippets` | `~shareHtml` per `#shareHtmlLocation` |
| `getSiteLogo` | logo link and size (`#shareLogoWidth/Height` are proportions; drawn 32 px wide) |
| `getShareLink` | **the only** link-target rule: first non-blank of `#shareExternalLink`, `#shareExternal`, else `./shareId` — used by the tree, subpages, index and inline links |
| `getNavigationTree`, `getSiteAncestorIds` | the tree; expansion follows the first parent **inside the site** |
| `getPrevNextLinks` | tree-order previous/next, inside the site; hidden notes get none |
| `getTableOfContents` | nests `PageHeading`s from core's `preparePageContent()` |
| `getChildLinks`, `getContentClasses` | subpage list, `#content` classes |
| `getPageLanguages`, `getLastUpdated` | `<html lang dir>` from the display language, `#content lang dir` from the content language when it differs, the date via `Intl` |

Rules:
- **Templates only print.** A condition belongs in a template only if it tests a value the model
  already produced (`navigation.length`, `childLinks.length`). Anything that walks notes, reads
  labels or transforms HTML goes into the model (or into core when it changes `content`).
- **Content transforms belong to core**, in the parse `renderText()`/`preparePageContent()` already
  does — never a regex over HTML in a template.
- A clone's "parent" is always the **first parent inside the site** (`getSitePosition()`), never
  `getParentNotes()[0]`.

## What custom templates are promised

`~shareTemplate` notes are copies of an earlier `page.ejs`, documented on the *Custom share
template* page of the User Guide. So:
- **Never remove or rename a template variable**, even an unused one (`header` is always `""`).
  Add new ones and list them in that page's table.
- Custom templates receive `content` **without** the anchors and image attributes
  `preparePageContent()` adds: copies of the old template add their own, and doubling them shows
  twice. `headings`/`toc` are passed to the default template only.
- Partials of a custom template resolve from its child notes, not from the theme's templates.

## Browser side

- **Every module imports its own CSS**; `index.ts` imports in cascade order (a module's CSS lands
  where it is first imported). Moving an import moves CSS; compare the bundle's declarations when
  reordering.
- **No inline scripts besides `boot_script.ejs`.** Top-level `const`/`let` in a classic inline
  script is a global binding shared with `~shareHtml` snippets — keep everything inside the IIFE.
  `boot_script.spec.ts` enforces both and that `page.ejs` has no `<script>`.
- Code that must run before the first paint and needs the DOM goes in `tree.ts`'s bundle, which is
  render-blocking; keep it small, since every page waits for it. Everything else stays in
  `scripts.js`, and `~shareJs` scripts never block.
- Anything needed before the first paint is driven from the root class the boot script sets
  (`theme-dark`/`theme-light`, `left-pane-collapsed`) — the theme switch is styled from it, not
  from `:checked`, so it needs no script to look right.
- Look elements up by ID with `getElementById`, not `querySelector("#" + slug)` (a slug may start
  with a digit).
- Code shared with the app comes from commons or ckeditor5 by subpath
  (`@triliumnext/commons/src/lib/…`, e.g. `enhanceLinkPreviews`, `getMermaidConfig`,
  `applyTabs`); shared content CSS comes from `packages/ckeditor5/src/theme/`.
- Mermaid loads the client's `share_mermaid` entry through the `client/share_mermaid.json`
  manifest, so diagrams match the app; it redraws on theme change.

## Testing

| Layer | How | Command |
| --- | --- | --- |
| page model | fake notes | `pnpm --filter @triliumnext/share-theme test` |
| browser scripts | `// @vitest-environment happy-dom`; set `offsetTop` etc. by hand (no layout) | same |
| inline scripts | render the `.ejs`, run in a `node:vm` context | same |
| core renderer | shaca fixtures (`buildShareNote`), `getContent()` / `renderNoteContent()` | `pnpm --filter server test src/share` **and** `pnpm --filter standalone test src/share` |

**The share code is held at 100% coverage** (lines, branches, functions, statements), and CI fails
below it:
- the share theme package, by `packages/share-theme/vitest.config.ts` (`--coverage` in the
  `share-theme` CI step, Codecov flag `share-theme`);
- `packages/trilium-core/src/share/**` and `apps/server/src/share/**`, by the per-glob thresholds in
  `apps/server/vite.config.mts`; core's share code and `lightweight/share_provider.ts` again in
  `apps/standalone/vite.config.mts`. Each runner must reach 100% on its own;
- the merged result, by the `share` project status in `codecov.yml`.

Check a change with `--coverage` on the narrowest run, e.g. `npx vitest run share --coverage` in
`apps/server` and `apps/standalone`; the threshold errors name the glob that falls short. Other
core files print `PARSE_ERROR` noise in that run (untested files are parsed untransformed); it does
not fail the run. Cover a branch with a test; remove it only when the types or the callers rule it
out. Never delete a public `SNote`/`SAttribute`/`SAttachment` method for coverage: custom templates
can call any of them.

- The server and standalone setup files load core before a spec's `vi.mock()` runs, so a mock of a
  module core already imported (icon packs, search) never reaches the renderer or the handlers.
  Use `vi.spyOn()` on the module namespace or its default export instead, or `vi.resetModules()`
  with `vi.doMock()` and a dynamic import for a module tested in isolation (the platform adapters).
- Core specs that render `page.ejs` with hand-built variables (the subpage-list helper in
  `content_renderer.spec.ts`) must be given every new variable, or EJS throws `ReferenceError`.
  Prefer full renders through `renderNoteContent()` for new page-level checks.
- **Prove the red run.** For template or model changes, copy the file to the scratchpad, put the
  `HEAD` version in place (`git show HEAD:<path> > <path>`), run the spec, copy the file back. For
  a pure refactor, render the old and new template with the same values and compare the output.
- node-html-parser elements break Vitest's pretty-printer on failure; assert
  `querySelector(...) === null` as a boolean, or compare mapped attributes.
- Values from a `node:vm` context have another `Object` prototype: use `toEqual`, not
  `toStrictEqual`.
- The share theme's `tsconfig.json` covers specs and browser code alike; a spec needing Node
  types adds `/// <reference types="node" />`.

## Running and seeing a change

- The share theme bundle is served from `packages/share-theme/dist` in development: run
  `pnpm --filter @triliumnext/share-theme build` (or `dev` to watch) after changing its scripts
  or CSS.
- The Node provider **caches each template after the first read**, and core changes need the
  server to restart: restart the dev server after changing a template or the renderer.
- Standalone bundles the templates (`?raw` imports): a **new partial** must be added to
  `TEMPLATES` in `apps/standalone/src/lightweight/share_provider.ts`; the server reads the
  template folder by name and needs nothing.

## Documentation

User-facing share behavior is documented in `docs/User Guide/User Guide/Advanced Usage/Sharing.md`
(feature list, attribute reference, OpenGraph table) and `Sharing/Custom share template.md`
(template variables). Update them in the same commit, then run the `writing-documentation`
skill's `docs.mjs sync` and `check` **from the repository root** — a shell sitting inside
`docs/User Guide` makes the sync fail halfway on Windows and delete hundreds of files.

## Compared with other publishers

Obsidian Publish declares every site `lang="en"` (even its Chinese and Japanese help sites) and
has no language setting. Quartz takes `lang` from a site locale or a note's frontmatter and formats
dates with that locale. Trilium marks the page with the display language and the content with the
note's content language separately, so the theme's own texts are not mislabeled.
