---
name: working-with-toc-cache
description: >-
  Use when deciding whether a kind of content should keep its table of contents in a ToC cache,
  when wiring a new content type to it (a `TocFormat`, its generator, its heading type and
  fields, its reader version), when choosing how the headings of a format are identified (the
  hashed `heading` id, free or bound to a blob, next to native locators such as a PDF page or a
  DOCX bookmark), when making a renderer resolve those ids (the `data-toc-heading` marks of a
  server preview, `findHeading()` in a viewer that reads the document itself, link labels), or
  when changing the Outline tab of a PDF, DOCX, ODT or EPUB note or attachment
  (`CachedToCProvider`, the `tocDocument` context data that `Pdf.tsx`, `Office.tsx` and
  `Attachment.tsx` publish, the outline's build, active heading and Copy reference). Covers
  `packages/trilium-core/src/services/toc/` (`getToc()`, `readCachedToc()`, `buildToc()`,
  `saveClientToc()`, `registerTocGenerator()`, the PDF, DOCX, ODT and EPUB formats), commons
  `toc.ts` (`assignHeadingIds()`, `findHeading()`, `normalizeTocTitle()`, `TocCache`), the
  `GET`/`PUT .../toc` and `POST .../toc/build` routes, the `tocCache` attachment role, the
  viewer-built cache of standalone (`useTocBuild()`), and the contract fixtures. Also load it
  before changing any of those files.
---

# Working with the ToC cache

A **ToC cache** is a JSON attachment that holds the table of contents of one document: the
headings, each with an id, a plain-text title and a level, plus the fields and properties of its
**format**. It is read instead of the document whenever something needs the structure: the link
dialog and the `@` list (through the reference provider in `references/toc.ts`), the labels of
links to a heading, and the viewer that builds it where the server cannot.

The cache is keyed by the `blobId` of the document. A cache whose `targetBlobHash` is not the
document's current `blobId` is stale and is rebuilt on the next read, so nothing ever invalidates
it by hand.

Link targets in general (providers, kinds, the lists, navigation) are the `adding-link-targets`
skill. The PDF viewer side of the build and of `findHeading()` is the `developing-pdf-viewer`
skill. This skill owns the cache itself, its formats and its ids.

## When to use a ToC cache

Use one when both of these hold:

- **Reading the structure is expensive.** The document needs a heavy parser (pdf.js, `officeparser`,
  unzipping and parsing XML), the whole file in memory, or hundreds of milliseconds per read. The
  link dialog and the `@` list ask for the targets of every note the user picks, so a parse per
  request shows as latency while the user types. The cache turns each later listing into one read
  of a small JSON attachment.
- **The content changes rarely or never.** File notes and attachments (an uploaded PDF, a DOCX, an
  EPUB) keep their bytes for their whole life, so one build serves every later read. Because the
  ids come from the bytes alone, the cache also syncs to the other instances, and an instance that
  builds its own gets the same ids.

It is also the only way to list the structure of a format that the platform cannot parse at all
but a client viewer can (PDF on standalone and mobile, see "Generators").

Do not use one for:

- **Content edited often**: text, Markdown, code, canvas. Every save gives a new `blobId`, so every
  listing after an edit rebuilds the cache, rewrites the attachment and syncs an entity change for
  it. Parse on request instead, with a plain `ReferenceProvider`: the text provider costs about
  12 ms per 100 KiB of content dense with headings.
- **Content whose targets have stable ids of their own** that a cheap parse finds: block ids of
  text notes, sheet ids of a spreadsheet. A provider that reads them needs no cache.
- **A cache in memory.** Decrypted titles of a protected note would stay there after the protected
  session ends. The attachment is protected with its note; a `Map` is not.

## The pieces

| Piece | File | Role |
|---|---|---|
| Cache types and ids | `packages/commons/src/lib/toc.ts` | `TocHeading`, `TocCache`, `TOC_CACHE_VERSION`, `MAX_TOC_*`, `getTocCacheTitle()`, `getBlobTag()`, `normalizeTocTitle()`, `assignHeadingIds()`, `findHeading()`, `headingSource()` |
| API types | `packages/commons/src/lib/server_api.ts` | `CachedTocResponse`, `ClientTocRequest`, `TocConflictResponse`, `PendingToc` |
| Role | `packages/commons/src/lib/attachment_roles.ts` | `tocCache`: `derived: true`, so revisions, ZIP and share-theme exports, templates and copies leave it out, through `BNote.getPortableAttachments()` |
| Service | `packages/trilium-core/src/services/toc/index.ts` | `TocFormat`, `TocGenerator`, `GeneratedToc`, `getToc()`, `readCachedToc()`, `saveClientToc()`, `registerTocGenerator()`, `findTocFormat()`, `getTocFormatOf()`, `getHeadingIds()`, `createLevelTracker()`, `markTocHeadings()`, the `formats` list |
| Formats | `toc/pdf.ts`, `toc/office.ts`, `toc/epub.ts` | PDF outline; DOCX and ODT (`createOfficeTocFormat()`); EPUB (`epubTocFormat`, `EPUB_TOC_READER`, the types of the ToC pass, `TocPassRefusal`). The office and EPUB formats load their readers with `await import()` |
| Office reader | `toc/office_headings.ts` | `readPreviewHeadings()`, `readPreviewBookmarks()`, `readBookmarkNames()`, `markOfficePreview()` |
| EPUB reader | `toc/epub_pass.ts`, `toc/epub_package.ts`, `toc/xml.ts` | The ToC pass (`runTocPass()`, `convertMarkedEpub()`), `readEpubToc()`, `findLandings()`, `markEpubPreview()`; the package, navigation and NCX of a book (`readBookToc()`); the XML tokenizer (`readTokens()`, `parseXml()`) |
| Preview marks | `toc/preview_marks.ts` | `writePreviewMarks()`, `indexElementIds()`, `spliceInsertions()`: shared by the office and EPUB markings |
| ZIP parts | `packages/trilium-core/src/services/utils/zip_records.ts` | `readZipPart()`, `readZipIndex()`: the DOCX and ODT bookmarks and the EPUB pass read archives here, not through the platform's `ZipProvider` |
| PDF reader | `packages/commons/src/lib/pdf_toc.ts` | `readPdfOutline()`, `toPdfTocHeadings()`, `PdfTocHeading`, `PDF_TOC_READER`; shared by the server and the viewer |
| Server generator | `apps/server/src/services/toc/pdf.ts` | `registerPdfTocGenerator()`, called from `apps/server/src/www.ts` |
| Routes | `packages/trilium-core/src/routes/api/toc.ts` | `GET`/`PUT /api/notes/:noteId/toc` and `/api/attachments/:attachmentId/toc`, `POST .../toc/build` of both, `GET /api/attachments/:attachmentId/references` |
| Reference bridge | `packages/trilium-core/src/services/references/toc.ts` | `tocReferences` provider, `toTargets()` |
| Preview marking | `packages/trilium-core/src/routes/api/files.ts` | `sendOfficePreview()` calls `markTocHeadings()` |
| Client build | `apps/client/src/widgets/type_widgets/file/toc_build.ts` | `useTocBuild()`: the coordinator of the viewer's build (`ClientTocBuild`); `refreshBlobId()` |
| Outline | `apps/client/src/widgets/sidebar/CachedToCProvider.tsx` | `CachedToCProvider`, `useCachedToc()`, `TocDocumentState`, `ClientTocBuild`, `SERVED_FORMATS`, `isServedTocFormat()`; mounted by `TableOfContents.tsx`, enabled by `RightPaneContent.tsx` (see "The outline") |
| Outline publishers | `type_widgets/file/Pdf.tsx`, `file/Office.tsx`, `type_widgets/Attachment.tsx`, `services/content_renderer.ts` | Publish `tocDocument`; an attachment's through `onDocumentState` and `onTocBuild` |
| Client landing | `apps/client/src/services/bookmark_jump.ts`, `link_targets.ts` | `showDocumentTarget()`; `takeLinkTarget()` reads the target out of the view scope |
| Client labels | `apps/client/src/services/link.ts` | `getTocUrl()`, `rememberHeadingTitles()`, `loadLinkTargetLabel()`, the `headingTitles` memo |
| Contract fixtures | `packages/trilium-core/src/services/toc/fixtures/` | `toc_contract.*` and their JSON, written by `generate-toc-contract.mts` and `generate-office-toc-contract.mts` through the formats' own generators, with `buildContract()` and `writeContract()` of `contract.mts`; `epub_books.ts` builds the books of the EPUB specs |

## How a cache is read and built

`getToc(ref)` takes a `TocDocumentRef`, `{ kind: "note", noteId }` or
`{ kind: "attachment", attachmentId }`, and answers a `TocResult`:

1. `resolveDocument()` finds the entity and its format with `getTocFormatOf()`: a note by its
   `type`, an attachment by its `role` (`BAttachment.type` is never set), and both by MIME type.
   No format: `null`.
2. `findCacheAttachment()` looks on the owner note for attachments of role `tocCache` titled
   `toc-cache.json` (the note's own) or `<attachmentId>.toc-cache.json` (an attachment's). The
   valid one with the smallest attachment id wins, so two instances that built at once agree
   after sync. A cache is valid when it parses, has `version === TOC_CACHE_VERSION`, passes
   `format.isCurrent()` and has `targetBlobHash === entity.blobId`.
3. A valid cache answers `{ status: "ready", cache, format }`.
4. Otherwise the generator runs: a platform's registered one (`registerTocGenerator()`) before the
   format's own (`TocFormat.generator`). Without either the answer is `{ status: "client" }`, and
   the reference listing carries `pendingToc` so the lists say the file must be opened once.
5. Concurrent builds of one format, document and blob share one promise (`builds`). A failure that
   `isPermanentFailure()` accepts is remembered (`permanentFailures`, at most 1,000) and answers
   `unreadable` without reading again; any other failure is read again on the next request.
6. `assembleCache()` validates what the generator read, normalizes the titles, computes the ids on
   the server and builds the cache. Invalid output is logged and answers `unreadable`.
7. The save waits for `whenDatabaseFree()`, opens its own context and transaction, and checks
   that the document still has that blob and format (`saveBuild()`). If it changed, the build is
   `STALE` and runs once more; a second change throws `ConflictError`.
8. `saveCache()` writes into the existing attachment or a new one, then `sweep()` deletes the other
   caches of that title and the caches of attachments the note no longer has.

A document whose note cannot keep a cache (an attachment of a revision, a virtual note such as a
help page) is built on every request and never saved.

`buildToc()` (the `POST .../toc/build` route) answers the cache as `getToc()` finds or builds it,
or as `readCachedToc()` does where only a viewer reads the format. Both routes send each heading
with the `params` of a link to it (`format.getLinkParams()`), absent when no link can reach it, and
answer `{ status: "unavailable" }` for a gone document or content outside a protected session
(`answerUnavailable()` in `routes/helpers.ts`, from `NotFoundError` and
`ContentNotAvailableError`), since a client cannot read the status of a failed request. The
services keep throwing, so the reference routes still answer 404 and 400.

`readCachedToc()` (the `GET .../toc` route) never builds: it answers `ready`, `stale` (the newest
cache of an earlier blob, for labels), `missing` or `none`, and adds `pendingToc` where the viewer
must build. `saveClientToc()` (the `PUT`) takes what a viewer read, refuses it with a 409
`TocConflictResponse` when its `targetBlobHash` is not the current blob, keeps a valid cache that
exists already, and otherwise assembles and saves it exactly as a server build does.

## Heading identifiers

### What an id must survive

An id ties an entry of the cache to one heading of the content, and every later reader (a link, a
label, a marked preview, a viewer) finds the heading again by it. The tie must hold, wherever the
content allows, when the content changes and when its headings are reordered: a link to "Results"
still lands on "Results" after a paragraph is added above it, a section is deleted or two chapters
swap places. So an id names a heading by what it is, not by where it sits. Prefer, in this order:

1. **A stable name the content gives the heading**: a bookmark, an anchor or element `id`, a named
   destination. It survives edits, reordering and a new title. Only names the author keeps count:
   names an editor rewrites on save (Word's `_Toc…` and `_Ref…` bookmarks) are positions in
   disguise, which is why `readBookmarkNames()` drops names that start with `_`.
2. **A hash of the heading itself**: the free cache id, from its title path. It survives edits
   elsewhere and a reorder of its siblings, and changes only when the heading or an ancestor is
   retitled or moved under another parent.
3. **A position** (the nth heading, the nth of several equal titles, an offset) only when nothing
   else tells two headings apart. Bind it to the blob, as the bound cache id does, so that in
   another version it resolves to nothing instead of to whichever heading sits there now.

The same rule holds for resolving an id. A renderer reads its own copy of the content, computes or
reads the identifiers there and compares them with the link's; it never takes the nth heading of
its reading for the nth entry of the cache, or of a reading of another version. Pairing by index
within one reading is fine: `markOfficePreview()` pairs `headings[index]` with `ids[index]` because
both come from the same `readPreviewHeadings()` list.

### The cache id

Every heading of a cache has an `id` from `assignHeadingIds()`. Ids depend only on the titles and
levels of the outline, in document order, and on the blob for the headings that need it, so the
same bytes give the same ids on every instance, after an export and import, and in the viewer.

- **Hash**: FNV-1a twice over the heading's source, the titles from the top down joined by U+0008,
  then `:` and the position among the siblings of the same title (`headingSource()` shows it).
  14 characters of `[0-9a-z]`.
- **Free id** (`k3j9x0a1b2c3d4`): the hash alone. It survives any edit of the document that keeps
  the heading's title path unique, so a link to it outlives a new version of the file.
- **Bound id** (`<hash>.<blobTag>`, `<hash>.<n>.<blobTag>`, with `.p` for a protected blob): when
  the heading or one of its ancestors shares its title with a sibling, when two hashes collide
  (`<n>` is then the ordinal), or when the reader was cut at `MAX_TOC_HEADINGS` (`isCut`). The
  blob tag is the first 10 characters of the `blobId`. A position among equal titles can point at
  another heading in a new version, so the id is valid only for the exact bytes and resolves to
  nothing elsewhere; the renderer then falls back (see "Renderers").
- **Protection** changes the `blobId` (`PROTECTED_BLOB_PREFIX` is hashed in front of the bytes),
  so protecting a note changes its bound ids, and they carry `.p` so a resolver knows which digest
  to compare.

The server computes every id that is stored. `saveClientToc()` takes headings without ids, and
`parseHeadingFields()` passes on only the format's own fields, so an `id` that a client sends is
dropped.

### Choosing how a format identifies its headings

The cache id is the default because most documents give a heading no stable name. A format can add
other identifiers next to it; each kind of identifier has one place:

| The content gives | Where it goes | Example |
|---|---|---|
| Only an outline of titles | The cache id, `?heading=<id>` | DOCX and ODT headings |
| A locator the renderer can open without the outline | A field of the heading type, sent in `params` next to the id as a fallback | PDF `page`: `?page=5&heading=<id>` |
| A name the author gave, unique in the document | Another target kind from `getOtherTargets()`, with its own parameter, kept in the format's properties | DOCX and ODT bookmarks, `?bookmark=<name>` |
| Entries the renderer cannot show | Kept in the cache with a field that `getLinkParams()` answers `undefined` for | EPUB `isShown: false` |

Rules for heading fields:

- Declare the heading type in commons when the client or the viewer reads it
  (`PdfTocHeading extends TocHeading`), or in the format's module when only core does
  (`EpubTocHeading`), and type the format `TocFormat<YourHeading>`.
- **Fields never change ids.** Ids come from titles and levels only. A reader change that alters a
  title, a level, the order or which headings are kept changes ids, and needs a new reader
  version (see "Wiring a new format", step 3).
- Omit an absent field rather than writing `undefined`: the cache is JSON. `toPdfTocHeadings()`
  leaves `page` out for an entry that leads nowhere.
- Field names must not be `id`, `title` or `level`.
- A field that a renderer needs to find the heading, and that is not in `params`, is read from the
  cache through `GET .../toc` (`CachedTocResponse.headings`). No format does this yet; prefer a
  renderer that can rebuild the outline itself.

A new link parameter (anything other than `heading`, `page`, `bookmark`, `annotation`, `block`) also
needs `LINK_TARGET_PARAMS`, `ViewScope`, `VIEW_SCOPE_PARAMS`, `calculateHash()` and
`useFollowLinksWithin()`: the `adding-link-targets` skill, "Navigation".

## Wiring a new format

The routes, the reference provider, the lists and the labels need no change. A new format is:

1. **Decide** where the structure is read and how its headings are identified, in the order of
   "What an id must survive": a stable name first, a position last and bound to the blob. If the
   structure is the document's own table of contents and not something read from its preview, see
   the EPUB format: the cache keeps the whole authored outline, and the preview is marked from a
   record of where each entry landed.
2. **The heading type and reader version.** Export a version constant
   (`PDF_TOC_READER`, `DOCX_TOC_READER`) from commons when the viewer reads it, else from the
   format's module.
3. **The `TocFormat`**, in `packages/trilium-core/src/services/toc/<format>.ts` (or `office.ts`
   for another office type whose preview gives the headings and bookmarks), added to `formats` in
   `toc/index.ts`. `index.ts` imports every format at startup, so the format's module stays light
   and loads its reader with `await import()`, as `epub.ts` loads `epub_pass.ts`. Build a format
   on its own object rather than spreading another's: a property that only satisfies the other
   format's `isCurrent()` ends up in every cache. `findTocFormat()` takes the first match, so
   `isFor()` of two formats must never both accept a document.

```ts
import type { TocHeading } from "@triliumnext/commons";

import type { TocFormat } from "./index.js";
import { isOfficeInputFailure } from "./office.js";

const PPTX_MIME = "application/vnd.openxmlformats-officedocument.presentationml.presentation";

/** The version of the slide reader, stored as `slides.reader` in a ToC cache. */
export const SLIDES_TOC_READER = 1;

/** A slide title of a presentation (a sketch: no such format exists). */
export interface SlideTocHeading extends TocHeading {
    /** The slide the heading is on, 1 for the first. */
    slide?: number;
}

const slidesTocFormat: TocFormat<SlideTocHeading> = {
    name: "slides",
    isFor: (type, mime) => type === "file" && mime === PPTX_MIME,
    // Exactly the properties of the current reader: anything else rebuilds the cache.
    isCurrent: ({ slides }) => typeof slides === "object" && slides !== null
        && Object.keys(slides).length === 1
        && (slides as Record<string, unknown>).reader === SLIDES_TOC_READER,
    getLinkParams: ({ id }) => ({ heading: id }),
    parseHeadingFields({ slide }) {
        if (slide === undefined) {
            return {};
        }
        return typeof slide === "number" && Number.isInteger(slide) && slide >= 1
            ? { slide }
            : null;
    },
    isPermanentFailure: isOfficeInputFailure,
    async generator(content) {
        const { readSlideToc } = await import("./slides.js");
        return readSlideToc(content);
    }
};
```

   - `isCurrent()` compares the format's properties **exactly**, so bumping the reader version
     rebuilds every cache of the format on its next read, and only those.
   - `parseHeadingFields()` checks each field and returns only them; `null` refuses the whole
     cache. Never spread `raw` into the result.
   - `getLinkParams()` returns `undefined` for a heading that a link cannot reach; `toTargets()`
     then leaves it out as if absent (`createLevelTracker()`), so its children nest under the
     target before it.
   - `isPermanentFailure()` is `true` only for errors the same bytes always meet (a corrupt file,
     a password). `describeFailure()` names the error for the log without its message, which can
     quote the file.
   - `markPreview()` when the renderer is a server-converted HTML preview, and `getOtherTargets()`
     for targets of other kinds, such as bookmarks. Sort those when listing, not in the cache: a
     sort in the cache would depend on the locale of the instance that built it.
4. **The generator** (next section).
5. **The renderer** resolves the ids (see "Renderers"), and the type widget lands on
   `?heading=` (`adding-link-targets`, "Landing on the target").
6. **The contract fixture**: a small document with duplicate titles, nesting, a heading without a
   locator and protected ids, its JSON written by a script in `fixtures/` and checked by hand. Every
   reader of the format (server, core, viewer) compares with it, so a change of a reader or of the
   ids fails until the fixture and the reader version move together.
7. **Specs, docs and a changelog entry** (see "Testing").

## Generators

`TocGenerator = (content) => Promise<GeneratedToc>`. It runs outside any transaction and must not
write. It returns:

- `headings`: in document order, each with `title`, `level` and the format's fields, no `id`.
  - **Titles go through `normalizeTocTitle()` in the reader.** `assembleCache()` normalizes again
    (it is idempotent), but refuses the whole cache when a raw title is longer than
    `MAX_TOC_TITLE_LENGTH`, and the renderer must see the same titles as the cache.
  - **Levels are depths**: 1 at the top, never more than one deeper than the heading before.
    Convert tag levels or nesting with `createLevelTracker()`, passing only the headings that are
    kept: an `<h4>` under an `<h2>` is level 2, and an untitled heading is left out as if absent,
    so after `<h1>A</h1><h1></h1><h2>B</h2>` B is level 2 under A, as Word's navigation pane
    shows it. `readPreviewHeadings()`, `readBookToc()` and `toTargets()` all use it.
  - At most `MAX_TOC_HEADINGS`. A reader that stops there before another heading with a title
    sets `isCut`, which binds every id.
- `properties`: the format's own, at least `{ reader: <version> }`; stored under the format's name.

Pick where it runs:

| Where the parser can run | How | Example |
|---|---|---|
| In core, on every platform | `TocFormat.generator`, the parser loaded with `await import()` inside it | DOCX, ODT, EPUB (`officeparser`) |
| Only on Node | `registerTocGenerator(name, fn)` from `apps/server` at startup; desktop runs the same code | PDF (`unpdf`) |
| Only in a client viewer | No generator on that platform: `readCachedToc()` answers `pendingToc`, the viewer reads the document and the client saves it with `PUT .../toc` | PDF on standalone and mobile |

- A core generator must follow the core rules: no Node built-ins, binary through `utils/binary.ts`,
  and a parser that standalone's worker can load (`developing-standalone` skill). A format with a
  core generator never answers `pendingToc`, and its `PUT` is refused.
- A registered generator takes precedence over the format's own, which is how specs fake one
  (`registerTocGenerator()` in the test, `unregisterTocGenerator()` in `afterAll`).
- Keep a heavy parser out of the backend startup bundle: `await import()` inside the generator,
  and check it with the `analyzing-backend-bundle` skill.
- **A viewer-built cache** needs the viewer to read the outline with the **same reader** as the
  server (one shared function in commons, as `readPdfOutline()`), and to send the `blobId` of the
  bytes it read: a SHA-512 digest through `blobIdFromDigest()`, with `PROTECTED_BLOB_PREFIX` in
  front for a protected document (`digestBlobId()` in `packages/pdfjs-viewer/src/digest.ts`).
  `useTocBuild()` is written for the PDF viewer's iframe messages (`trilium-build-toc`,
  `pdfjs-viewer-toc-build`); another viewer needs its own request and answer, but the same rules:
  ask `GET .../toc` first and build only on `pendingToc`, save only the answer to the latest
  request, treat a 409 as "the document changed", and publish the build as `clientBuild` so the
  outline can ask for it and wait.

## Renderers: resolving an id

A link carries `?heading=<id>` (and maybe a locator). The renderer must find the heading without
trusting anything but its own reading of the document. There are two patterns.

### A server-converted preview (DOCX, ODT, EPUB)

1. `sendOfficePreview()` in `routes/api/files.ts` converts the document, then calls
   `markTocHeadings(format, html, { blobId, isProtected, content, tocPass })`, which runs
   `format.markPreview()`.
2. The marking reads the outline from the **same HTML** (or the same EPUB pass record) the
   generator read, computes the ids with `getHeadingIds()` for the blob being previewed, and
   `writePreviewMarks()` (`toc/preview_marks.ts`) splices `TOC_HEADING_ATTRIBUTE`
   (`data-toc-heading="<id>"`) into each heading's start tag and `TOC_BOOKMARK_ATTRIBUTE`
   (`data-toc-bookmark="<name>"`) into each bookmark's: every other byte stays as it was. Several
   entries that land on one element share one attribute, ids separated by spaces. Both markings
   find elements by id with `indexElementIds()`.
3. The client sanitizes the preview (data attributes survive DOMPurify, `id` attributes that
   clobber document properties do not) and lands with `showDocumentTarget()`: the first element
   whose `data-toc-heading` holds the id as one of its words, else whose `data-toc-bookmark` is the
   bookmark, found by comparing attribute values, never by a CSS selector built from them. No
   match scrolls the preview to its top.

The preview does not read the cache: the ids are recomputed from the HTML on every conversion.
That is why the generator and the marking must share the reading code (`readPreviewHeadings()`
for both); any divergence makes links land nowhere. A bound id from a link to an older blob finds
no element, which is the intended fallback.

The preview cache key includes the format name (`variant` in `sendOfficePreview()`), since a MIME
type change keeps the blob but changes the format. A preview whose EPUB pass failed is sent
uncached so the next request can mark it.

### A viewer that reads the document itself (PDF)

The viewer reads the outline with the shared reader and resolves the id with
`findHeading(id, outline, isOwnTag, { isCut })` from commons:

- An id that does not match the id pattern answers `-1`.
- A free id in an outline that `isCut` answers `-1`.
- A bound id calls `isOwnTag(blobTag, isProtected)`, which digests the document in the form the
  `.p` suffix names and compares tags. Only bound ids pay for the digest; free ids resolve from the
  titles alone. A rejected promise counts as `false`.
- Otherwise it computes the ids of the viewer's outline and returns the index of the match.

Then fall back in a fixed order. `resolveHeading()` in `packages/pdfjs-viewer/src/navigation.ts`:
the heading's own destination, the page it inherits from the first heading below it, the `page`
parameter of the link, nothing. This is why a format with a cheap locator puts it in `params` next
to the id.

The viewer also accepts the blob tag of a save of its document (`trilium-saved-revision`), so a
bound heading of the cache built from the save resolves without a reload.

### Labels and lists

- The lists read targets through `getToc()`; the reference listing returns the cache's
  `targetBlobHash` as `blobId`.
- Link labels read `GET .../toc` (never builds) through `loadHeadingTitle()` in
  `services/link.ts`, remembered per document and blob with `rememberHeadingTitles()`. A `stale`
  cache still gives a title once. `useTocBuild()` and `getLinkTargets()` feed the memo as they
  read. A link whose id is not in the cache falls back to the page label, then to the note title.
- Shared pages keep only `?block=`; a `heading` link opens the top of the shared page.

## The outline

The Outline tab of the right sidebar shows the cache of a PDF, DOCX, ODT or EPUB document, as a
note and as an attachment in the attachments view, through `CachedToCProvider`
(`apps/client/src/widgets/sidebar/CachedToCProvider.tsx`). Text, Markdown and AI chat notes have
providers of their own in `TableOfContents.tsx` and read no cache.

### Which documents get it

Three gates must agree:

- `TableOfContents()` mounts `CachedToCProvider` for a note when `isServedTocFormat(type, mime)`
  is true, and for every attachment in the attachments view.
- `useRightPaneTabs()` (`RightPaneContent.tsx`) enables the outline for the same notes, and for an
  attachment only once a `tocDocument` entry names that attachment.
- The type widget publishes `tocDocument` only for a document with a format, from
  `findTocFormatName()` in commons, the function the formats' `isFor()` call.

A new format gets an outline by adding its name to `SERVED_FORMATS` and publishing `tocDocument`
from its widget. A format shown by the server preview of `Office.tsx` and `Attachment.tsx` needs
only the name in the set.

### Publishing `tocDocument`

The widget writes a `TocDocumentState` into the context data of its note context:

| Status | When |
|---|---|
| `rendering` | A load or a render has started and its content is not in place yet |
| `unavailable` | The widget cannot show the document: a preview too large or not converted, a PDF that keeps failing to load |
| `shown` | The content is in place |

A `shown` entry has:

- `tocUrl` from `getTocUrl()`, and `ownerNoteId`, the note that keeps the cache attachment: its
  `tocCache` rows in `entitiesReloaded` reload the outline.
- `renderedBlobId`, the blob whose bytes are on screen. The rows apply only for it. It is the blob
  that a load or a fetch confirmed, never `note.blobId` read when publishing: a preview requests
  its blob with `?blobId=`, gets a 409 for another (`OfficePreviewChangedError`), reads the current
  blob with `refreshBlobId()` and renders again; the PDF viewer requests it in its file URL and
  confirms it at `documentloaded` under the token of its load.
- `linkPath` and `title`, from which _Copy reference_ builds its link (an attachment's path ends
  in `?viewMode=attachments&attachmentId=<id>`).
- `showTarget(params)`, which lands on a heading as a followed link does. Bind it to the load or
  render that published it: it returns `false` once that one is not the current one, or when the
  target is not found, and the outline then leaves the pane where it is.
- `findActiveHeading(headings)`, the id of the heading being read. The provider calls it on each
  render, so the widget publishes again when the reading position changes (`useActiveHeading()`
  in `Office.tsx` and `Attachment.tsx`, `pdfjs-viewer-position` in `Pdf.tsx`).
- `clientBuild`, only where the viewer builds the cache (PDF on standalone and mobile): the
  `ClientTocBuild` of `useTocBuild()`.

Every status has `attachmentId` for an attachment. The provider ignores an entry whose
`attachmentId` is not the one in the view scope: it is a late publish of another attachment.

A publisher (`useTocDocumentPublisher()` in `Office.tsx`, `useAttachmentTocDocument()` in
`Attachment.tsx`, `getTocDocument()` in `Pdf.tsx`) also:

- records what it publishes while hidden and writes it again when shown: `NoteDetailWrapper`
  keeps the widget mounted while the pane shows another note, and `NoteContext.setNote()` clears
  the context data;
- clears the entry on unmount only while it is still the one it wrote;
- for an attachment, publishes only while the view scope names it, through the renderer's
  `onDocumentState` and `onTocBuild` (`RenderOptions` in `content_renderer.ts`), each tied to a
  render generation.

### Loading and building

`useCachedToc()` loads once per `tocUrl` and `renderedBlobId`, when the outline is visible
(`useWhenShown()`):

1. `GET .../toc`. `ready` for the rendered blob shows the rows and feeds
   `rememberHeadingTitles()`; `ready` for another blob waits until the widget shows that blob.
2. `stale` or `missing` without `pendingToc`: this platform can build, so the provider sends
   `POST .../toc/build` (`buildToc()` in core), which returns the same response type.
3. With `pendingToc`: it waits for `clientBuild`, calls `request()` once per load while the
   build is `idle`, and takes `ready` once its `blobId` is the rendered one. Without a
   `clientBuild` the load fails.
4. `unreadable`, a failed request and a failed client build show _Try again_ (`retry()`, which
   requests a client build again and reloads). `unavailable` (a gone document, or one locked
   outside a protected session, from `answerUnavailable()` on the server) and
   `getUnavailableReason()` on the client show the unavailable placeholder. `none` shows the
   outline's empty state.

While a new blob loads or builds, the outline keeps the earlier rows of the same document rather
than the spinner, so a save of a PDF does not flash it. The spinner shows only without rows, with
_Building the table of contents…_ while a build runs. A heading without `params`
(`TocFormat.getLinkParams()` returned `undefined`) is a disabled row.

### Outline traps

- **Never publish an unconfirmed `note.blobId` as `renderedBlobId`.** A save in another tab
  changes the note before the widget shows the new bytes, and the rows of the new cache would
  then point into the old document.
- **`useActiveHeading()` needs the element that scrolls**: `.note-detail-file` for the office
  preview of a note, `.office-preview-scroll` for an attachment's.
- **`Pdf.spec.tsx` loads `@preact/signals`** (through `froca`, imported by `toc_build.ts`), which
  skips a second render with the same props: mount afresh in a spec instead.

## Traps

- **Do not call `getToc()` inside a transaction that stays open across an `await`** (an
  `asyncRoute` on standalone): the save waits for `whenDatabaseFree()`, which waits for its own
  caller. The `PUT` routes are plain `apiRoute`s for the same reason.
- **Never match a cached heading to the content by its index.** A cache built from one version and
  a reading of another agree on titles long after they disagree on positions; an index tie sends a
  link to whichever heading moved into the slot. Compare ids, or names the content carries.
- **A heading field is not part of the id.** Fixing a page number needs no reader bump; changing
  which entries are kept, their titles or their nesting does.
- **Reader drift is silent without the contract fixture.** The server and the viewer use the same
  code for PDF, and the office preview and generator share `readPreviewHeadings()`; a second
  implementation of a reader must be held to the fixture.
- **An upgrade of a parser library** (`officeparser`, `unpdf`, `pdfjs-dist`) can change titles or
  which headings exist. Run the contract specs after the upgrade and bump the reader of each format
  whose fixture moved.
- **Never put a title or the file's text in a log line or an error.** `describe()` names the
  document by kind and id; `describeFailure()` names an error by code.
- **The cache shows in the attachments of the note** under the role name "Table of contents cache",
  grouped with system attachments (`attachment_groups.ts`). It is derived: deleting it is harmless,
  and the next read rebuilds it.
- **A file of the user's titled `toc-cache.json`** is left alone: only role `tocCache` counts.

## Testing

| What | Spec |
|---|---|
| Ids, normalization, `findHeading()` | `packages/commons/src/lib/toc.spec.ts` |
| A shared reader | `packages/commons/src/lib/pdf_toc.spec.ts` |
| Read, build, save, sweep, failures, stale builds, client saves | `packages/trilium-core/src/services/toc/index.spec.ts` |
| A format's reader and marking against the contract fixtures | `toc/office.spec.ts`, `toc/office_headings.spec.ts`, `toc/epub.spec.ts` |
| The EPUB pass, landings and marking; a book's package and navigation | `toc/epub_pass.spec.ts`, `toc/epub_package.spec.ts` |
| The shared marking and levels; ZIP parts | `toc/preview_marks.spec.ts`, `createLevelTracker` in `toc/index.spec.ts`, `services/utils/zip_records.spec.ts` |
| The routes | `packages/trilium-core/src/routes/api/toc.spec.ts`, `routes/helpers.spec.ts` |
| The outline | `apps/client/src/widgets/sidebar/CachedToCProvider.spec.tsx`, `sidebar/RightPanelContainer.spec.tsx` (the gate), `type_widgets/file/Office.spec.tsx`, `Pdf.spec.tsx`, `type_widgets/Attachment.spec.tsx`, `services/content_renderer.spec.ts` |
| Targets from a cache | `packages/trilium-core/src/services/references/toc.spec.ts` |
| A server generator | `apps/server/src/services/toc/pdf.spec.ts` |
| The standalone platform (no PDF generator, `whenDatabaseFree`) | `apps/standalone/src/lightweight/platform_provider.spec.ts` |
| Landing in a preview | `apps/client/src/services/bookmark_jump.spec.ts` |
| Labels | `apps/client/src/services/link.spec.ts` |
| A viewer build and resolution | `packages/pdfjs-viewer/src/toc.spec.ts`, `navigation.spec.ts`, `digest.spec.ts` |

Core specs run under both runners:

```bash
pnpm --filter server test trilium-core/src/services/toc trilium-core/src/services/references/toc trilium-core/src/routes/api/toc src/services/toc
pnpm --filter standalone test trilium-core/src/services/toc trilium-core/src/services/references/toc trilium-core/src/routes/api/toc
pnpm --filter @triliumnext/commons test src/lib/toc src/lib/pdf_toc
pnpm --filter client test src/services/bookmark_jump src/services/link
pnpm --filter client test src/widgets/sidebar/CachedToCProvider src/widgets/sidebar/RightPanelContainer src/widgets/type_widgets/file/Office src/widgets/type_widgets/file/Pdf src/widgets/type_widgets/Attachment src/services/content_renderer
pnpm --filter @triliumnext/pdfjs-viewer test src/toc src/navigation src/digest
```

Where `pnpm` cannot start a script, run `../../node_modules/.bin/vitest run <patterns>` from the
package's directory instead. After a viewer change, rebuild it
(`pnpm --filter @triliumnext/pdfjs-viewer build`).

What a new format's specs cover, in `index.spec.ts` style: a build saves once and the next read
skips the generator; a new blob rebuilds into the same attachment; a reader bump rebuilds only
that format's caches; a cut outline binds every id; a protected document binds to the protected
blob; a permanent failure is not read again for that blob and a transient one is; an attachment's
cache sits on its note under its id. Then the marking or viewer resolution against the contract
fixture, under both core runners.

A format users can link into is user-facing: describe it where the User Guide covers the file
type (`docs.mjs impact "table of contents"`; the PDF and office pages describe theirs), and add a
changelog entry (`writing-documentation` skill).
