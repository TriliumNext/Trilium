---
name: developing-pdf-viewer
description: >-
  Use when changing Trilium's built-in PDF viewer — anything under `packages/pdfjs-viewer` (the code injected into Mozilla's PDF.js viewer: `bootstrap.ts`, `navigation.ts`, `annotations.ts`, `pages.ts`, `toc.ts`, `digest.ts`, `layers.ts`, `attachments.ts`, `persistence.ts`, `editing.ts`), the client side that talks to it (`apps/client/src/widgets/type_widgets/file/Pdf.tsx`, `PdfViewer.tsx`, `toc_build.ts`, the sidebar panels in `widgets/sidebar/pdf/`), the postMessage protocol between them, PDF links (`?page=` / `?annotation=` / `?heading=`), the build of the ToC cache by the viewer, or a bug where the viewer "does not pick up" a change. Covers the mandatory rebuild after every viewer change, the message protocol, the hidden-but-mounted viewer, the pdf.js timing traps, and how to test at each level.
---

# Developing the PDF viewer

A PDF note renders in an iframe running Mozilla's PDF.js viewer, vendored in
`packages/pdfjs-viewer/viewer/` (`viewer.mjs`, `viewer.html`, refreshed by `pnpm --filter
@triliumnext/pdfjs-viewer update-viewer`) plus Trilium's own code in `packages/pdfjs-viewer/src/`,
bundled into `web/custom.mjs`. The client never imports that code: `Pdf.tsx` and the viewer talk
only through `postMessage`.

## Rebuild the viewer after every change to it

**After any edit under `packages/pdfjs-viewer/` (`src/`, `viewer/`, `scripts/`), run the build
before testing anything in an app:**

```bash
pnpm --filter @triliumnext/pdfjs-viewer build
```

Every app serves the **built** `packages/pdfjs-viewer/dist`, never the sources: the server in
development (`getPdfjsAssetDir()` in `apps/server/src/routes/assets.ts`), desktop, and standalone
(`apps/standalone/vite.config.mts`). `dist` is built only by the root `prepare` script, i.e. on
`pnpm install`; `pnpm server:start` and the other `*:start` scripts do not rebuild it and do not
watch it. Vite hot-reloads the client half of a change while the viewer half stays at whatever was
built last, so a stale `dist` looks exactly like a bug in the new code — or like a fix that works,
when the old viewer happens to behave. Check the age when in doubt:

```bash
ls -l --time-style=+%H:%M packages/pdfjs-viewer/dist/web/custom.mjs
```

- For a longer session, `pnpm --filter @triliumnext/pdfjs-viewer watch` rebuilds `custom.mjs` on
  save. Then reload the app page: the iframe loads the viewer afresh with the note.
- The viewer's own Playwright suite (`pnpm --filter @triliumnext/pdfjs-viewer e2e`) builds before
  serving, but `reuseExistingServer` keeps a harness server that is already running — and its stale
  bundle — outside CI.
- The unit specs (`pnpm --filter @triliumnext/pdfjs-viewer test`) import the sources directly and
  need no build. Green specs therefore say nothing about what an app serves.
- When reporting a viewer change done, say that `dist` was rebuilt, so the user's running instance
  picks it up on reload.

## The message protocol

- **Viewer → client**: `pdfjs-viewer-*` messages, typed in `apps/client/src/types-pdfjs.d.ts`
  (`PdfMessageEvent`). Every message carries `noteId` and `ntxId` (from the iframe URL, set in
  `bootstrap.ts`), and `Pdf.tsx` drops any message not addressed to its own note and context,
  because every viewer posts to the same parent window.
- **Client → viewer**: `trilium-*` messages, posted to `iframeRef.current.contentWindow`; the viewer
  checks `event.origin`. They are not typed on the viewer side.
- `Pdf.tsx` turns the viewer's data into note-context data (`toc`, `pdfPages`, `pdfAnnotations`,
  `pdfAttachments`, `pdfLayers`), which the right sidebar panels read with `useGetContextData()`.
  Write it through `publish()`, not `noteContext.setContextData()` — see below.
- Most setup runs on pdf.js `documentloaded` and only when the note is editable (`bootstrap.ts`);
  `setupPdfAnnotations()` runs for read-only PDFs too. The first `pdfjs-viewer-annotations`
  message is the client's signal that the viewer can scroll.
- **Every request that moves the view goes through one listener**, `setupNavigation()` in
  `navigation.ts`, registered before the first `await` of `main()`, for every viewer:
  `trilium-scroll-to-heading` (`{ headingId, pageNumber }` from a link, `{ headingKey }` from the
  sidebar) and `trilium-scroll-to-annotation` (`{ annotationId?, pageNumber }`). A request waits
  for the document and its initial view; only the latest one moves the view, synchronously, with
  `scrollPageIntoView()` or the rectangle of an annotation, then `update()`. A page past the end
  opens the last page. The embedded viewer has no `pdfHistory`.
- **Headings**: the sidebar names a heading by its key `outline-<n>`, its position in the outline
  that `ensureOutline()` reads once per document with commons' `readPdfOutline()`. A link names it
  by the id of the ToC cache, which `findHeading()` (commons `toc.ts`) resolves; a bound id (with
  a blob tag) costs one digest of the document, `getDocumentBlobId()` in `digest.ts`, shared and
  kept per document and form (Web Crypto, else `@noble/hashes` in 4 MiB slices).
- **The ToC build**: on platforms where the server cannot read PDFs, the client posts
  `trilium-build-toc` (`{ requestId, isProtected, data? }`) after each load and each save
  (`useTocBuild()` in `toc_build.ts`); `setupTocBuild()` answers `pdfjs-viewer-toc-build` with the
  outline, the `blobId` of the bytes and the time, or `{ failed: true }`. Bytes of a save are
  opened with their own loading task, which is destroyed whether the open succeeds or not. The
  answer to the latest request only is saved with `PUT .../toc`.

## The viewer outlives the note it shows

`NoteDetailWrapper` keeps each type widget mounted, hidden, while the pane shows a note of another
type, so a PDF → text note → same PDF round trip reuses the iframe with its document loaded. Two
consequences:

- `NoteContext.setNote()` clears the context data on the way out, and the viewer never sends it
  again. `Pdf.tsx` keeps what it last received per key and republishes it when `isVisible` turns
  true; anything new published while hidden is recorded, not written.
- Anything that scrolls must wait for `isVisible`: a hidden viewer throws "offsetParent is not set
  -- cannot scroll" and the scroll is lost. `noteSwitched` reaches the hidden viewer before it is
  shown.

## pdf.js timing traps

- **The initial view undoes an early scroll.** pdf.js restores the last-read position at
  `documentinit` and, for pages of unequal size, again after `pagesPromise`. `trackDocument()` in
  `navigation.ts` makes every request wait for both.
- **A resize scrolls back to the recorded position.** `onResize()` reapplies an `auto`,
  `page-fit` or `page-width` zoom and `#setScaleUpdatePages()` scrolls to `_location`, which pdf.js
  records in `pdfViewer.update()` on the next frame's scroll event. A viewer shown again resizes,
  often in the same frame as a jump. After a programmatic scroll, call `pdfViewer.update()` and
  scroll instantly, never smoothly.
- **An annotation's element is not a reliable target.** Pages render only near the viewport, and
  while an annotation tool is active pdf.js hides each editable annotation's element behind an
  editor. Position from the rectangle (`page.getAnnotations()`, or `annotationStorage.serializable`
  for what was edited in this session) through `pageView.viewport.convertToViewportPoint()`;
  pdf.js 6 has no `convertToViewportRectangle()`.
- **Ids drawn this session are temporary.** A stored annotation's id is its object reference
  (`12R`); one drawn since the document loaded has an editor id (`pdfjs_internal_editor_N`) that the
  next load does not reuse.

## Testing

| Level | What | Command |
|---|---|---|
| Viewer unit | `src/*.spec.ts` against real pdf.js and a thin `PDFViewerApplication` (`src/test/viewer_app.ts`, fixture PDF in `src/test/fixture_pdf.ts`) | `pnpm --filter @triliumnext/pdfjs-viewer test --run` |
| Client unit | `Pdf.spec.tsx` (the protocol, with `PdfViewer` mocked), sidebar panel specs | `pnpm --filter client test src/widgets/type_widgets/file/Pdf.spec.tsx src/widgets/sidebar/pdf/` |
| Viewer e2e | built bundle + a stub parent (`e2e/harness`) | `pnpm --filter @triliumnext/pdfjs-viewer e2e` |
| App | in-memory e2e fixture with `Dacia Logan.pdf` (`oUfFD9lugwiQ`) and `Layers test.pdf` (`n7gU3aBDPKd9`) | see `building-client-ui` → `references/inspecting-the-running-app.md` — **rebuild `dist` first** |

A timing bug (a jump undone, a panel empty after navigation) usually passes in a fast headless
run. Instrument the iframe (`contentWindow` `resize` listener, `PDFViewerApplication.pdfViewer`
`_location` / `currentScale`, a wrapped `postMessage`) to read the order of events, then force the
losing order in the repro — for example resize the iframe right after the client posts — before
trusting a fix.
