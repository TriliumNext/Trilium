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
  `setupPdfAnnotations()` and the position tracking run for read-only PDFs too. The first
  `pdfjs-viewer-annotations` message is the client's signal that the viewer can scroll.
- **Loads**: each navigation of the frame carries a `loadToken` URL parameter
  (`window.TRILIUM_LOAD_TOKEN`, from `nextPdfLoadToken()` in `PdfViewer.tsx`) and asks for one blob
  in its file URL (`open?blobId=`, which answers 409 for another blob). Every viewer posts
  `pdfjs-viewer-document-loaded` and `pdfjs-viewer-document-error` with its token; a viewer addressed
  to a note also posts `pdfjs-viewer-position` and the page rotations (`pdfjs-viewer-rotations`,
  `pdfjs-viewer-page-rotation`, `position.ts`), and the sidebar messages (page info, current
  page, thumbnails, attachments, layers, annotations) carry the token too. `Pdf.tsx` drops a
  message of another token, and `PdfViewer` takes its reports by frame and token
  (`onDocumentLoaded`, `onDocumentError`). A load is a blob in a mode: a new note, a new blob and a
  switch between read-only and editable each start one, with a new token, so the frame navigates
  once. Each `pdf*` section is `{ status: "loading", loadToken }` from the start of the load (the
  ones the load reports: Annotations always, Pages, Attachments and Layers only when editable; the
  others are cleared) until its message makes it `ready`, an empty list included. A link lands
  only on a `ready` Annotations entry. A reload is a new URL, never `location.reload()`. After a load error the widget reads the current
  blob (`refreshBlobId()`) and loads it, even the same blob, since pdf.js reports a refused fetch
  and a broken file alike; two errors in a row for one blob, or three in all, make it
  unavailable, which clears every section. An own save keeps the frame: the upload answers the new `blobId`, and
  `trilium-saved-revision` (`{ loadToken, blobId, isProtected }`) tells the viewer its tag.
- **Every request that moves the view goes through one listener**, `setupNavigation()` in
  `navigation.ts`, registered before the first `await` of `main()`, for every viewer:
  `trilium-scroll-to-heading` (`{ headingId, pageNumber }`, from a link and from the outline alike)
  and `trilium-scroll-to-annotation` (`{ annotationId?, pageNumber }`). A request waits
  for the document and its initial view; only the latest one moves the view, synchronously, with
  `scrollPageIntoView()` or the rectangle of an annotation, then `update()`. A page past the end
  opens the last page. The embedded viewer has no `pdfHistory`.
- **Headings**: the viewer sends no outline. The sidebar shows the ToC cache (`CachedToCProvider`,
  the `working-with-toc-cache` skill, "The outline"), which `Pdf.tsx` serves through its
  `tocDocument` entry: `showTarget()` posts the request a link posts, and `findActiveHeading()`
  compares the reading position with each heading's `left`/`top` (`findActivePdfHeading()` in
  commons `pdf_toc.ts`, along the axis that runs down the screen at each page's rotation). The
  viewer resolves an id of the cache with `findHeading()` (commons `toc.ts`) over the outline that
  `ensureOutline()` reads once per document; a bound id (with a blob tag) costs one digest of the
  document, `getDocumentBlobId()` in `digest.ts`, shared and kept per document and form (Web
  Crypto, else `@noble/hashes` in 4 MiB slices), unless it is the tag of a saved revision of the
  loaded document. An outline cut at `MAX_TOC_HEADINGS` (`readPdfOutline()` reports `isCut`) binds
  every heading to the blob, so `findHeading()` takes the flag, and a free id made before
  `PDF_TOC_READER` 2 opens its page.
- **The ToC build**: on platforms where the server cannot read PDFs, the client posts
  `trilium-build-toc` (`{ requestId, isProtected, data? }`); `setupTocBuild()` answers
  `pdfjs-viewer-toc-build` with the outline, its `isCut`, the `blobId` of the bytes and the time,
  or `{ failed: true }`. Bytes of a save are opened with their own loading task, which is destroyed
  whether the open succeeds or not. The coordinator, `useTocBuild()` in `toc_build.ts`, starts a
  request on a viewer load and on a save (the latest wins), lets a demand of the outline
  (`clientBuild.request()`) join a running one, is `building` from its `GET` until its `PUT`
  settles, ends with the ready cache that either found, and fails at once on a load error. The
  cache, its ids and the formats beside PDF: the `working-with-toc-cache` skill.

## The viewer outlives the note it shows

`NoteDetailWrapper` keeps each type widget mounted, hidden, while the pane shows a note of another
type, so a PDF → text note → same PDF round trip reuses the iframe with its document loaded. Two
consequences:

- `NoteContext.setNote()` clears the context data on the way out, and the viewer never sends it
  again. Each load keeps what it published (`PdfLoad.published`), and `syncSidebar()` writes that
  map back when `isVisible` turns true and clears the sections it lacks, never `tocDocument`;
  anything new published while hidden is recorded, not written.
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
