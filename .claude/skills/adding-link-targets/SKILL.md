---
name: adding-link-targets
description: >-
  Use when making the inside of a kind of content linkable, so that the link dialog's note page and
  the second page of the `@` list (text and Markdown editors) offer places in it: Markdown
  headings, PDF pages or outline entries, DOCX headings or bookmarks, spreadsheet sheets, or the
  same for attachments. Covers the reference routes (`GET` and `POST
  /api/notes/:noteId/references`), the `ReferenceProvider` registry in
  `packages/trilium-core/src/services/references/`, the shared types (`ReferenceTarget`,
  `ReferenceKind`, `REFERENCE_KINDS`, `ReferenceParams`), the client model in
  `apps/client/src/services/link_targets.ts` (`LinkTarget`, `LINK_TARGET_KINDS`, `TARGET_PARAMS`,
  `getLinkTargets()`), the lists that show targets (`LinkTargetList`, `LinkMentionList`, the
  dialog), and the navigation side (`ViewScope`, `VIEW_SCOPE_PARAMS`, the type widget that
  scrolls to the target, reference link titles). Also load it before changing any of those files.
---

# Adding link targets

A **target** is a place inside a note that a link can point at: a heading or an anchor of a text
note today, a Markdown heading or a PDF page next. A link points at a target by adding **link
parameters** to the path of the note: `#root/abc?block=eaJkN47U8kI4` for a heading,
`#root/abc?bookmark=setup` for an anchor, `#root/abc?page=3` for a PDF page.

The server lists the targets of a note through a **provider** chosen by note type and MIME type.
The client turns them into `LinkTarget` objects, and three lists show them, grouped by **kind**:
the note page of the link dialog, the second page of the `@` list, and the Heading / anchor page of
the dialog. None of the lists has code for a particular kind. A new kind of content therefore needs
a provider on the server, an entry in two registries if it brings a new kind or a new parameter,
and a type widget that scrolls to the target when a link opens the note.

The kind sets how a target looks (icon, card or menu header), never where it comes from. A
Markdown heading and a DOCX heading are both of kind `heading`.

## The pieces

| Piece | File | Role |
|---|---|---|
| Shared types | `packages/commons/src/lib/server_api.ts` | `REFERENCE_KINDS`, `ReferenceKind`, `ReferenceParams`, `ReferenceTarget`, `NoteReferencesResponse`, `CreateReferenceRequest`, `CreateReferenceResponse` |
| Registry and routes | `packages/trilium-core/src/services/references/index.ts` | `ReferenceProvider`, `findReferenceTargets()`, `createReference()`, `registerReferenceProvider()` |
| Text note provider | `packages/trilium-core/src/services/references/text.ts` | Headings (`?block=`, ids written by `createReference`) and anchors (`?bookmark=`) |
| Route handlers | `packages/trilium-core/src/routes/api/notes.ts` | `getNoteReferences` (`asyncApiRoute`), `createNoteReference` (`apiRoute`), body validation |
| API document | `apps/server/internal.openapi.yaml` | `ReferenceKind` enum and the two operations; the API Reference page is generated from it |
| Client model | `apps/client/src/services/link_targets.ts` | `LinkTarget`, `LINK_TARGET_KINDS`, `TARGET_PARAMS`, `getLinkTargets()`, `createEditorHeadings()`, `createAnchorTargets()`, `nestTargets()`, `findTarget()`, `addParameters()` |
| Card list | `apps/client/src/widgets/react/LinkTargetList.tsx` | One card per kind, nesting by `level`; `useLinkDestinationKeys()` for a host that keeps the focus |
| `@` list | `apps/client/src/widgets/react/LinkMentionList.tsx` | Second page of the note list: a menu header per kind, filtering by title |
| Link dialog | `apps/client/src/widgets/dialogs/edit_link.tsx` | Note page (targets of the note picked) and Heading / anchor page (the editor's own document) |
| Navigation | `apps/client/src/services/navigation_state.ts` | `ViewScope` fields and `VIEW_SCOPE_PARAMS`, which a link parameter must be part of |

## How a target travels

1. The user picks a note. `getLinkTargets(noteId, notePath)` asks `GET
   /api/notes/:noteId/references`, unless the note is protected outside a protected session.
2. `findReferenceTargets()` picks the first provider whose `isFor(type, mime)` accepts the note.
   A note without one answers `{ targets: [] }`.
3. The provider's `findTargets(content)` returns `ReferenceTarget`s: `kind`, plain-text `title`,
   `level` for kinds that nest, and `params` when the target can be linked as it is.
4. The client wraps each one in a `LinkTarget`. `createLinkPath()` adds `params` to the note path.
   A target without `params` has `createReference()`, which saves the editors of the note and then
   asks `POST /api/notes/:noteId/references` to write a reference into the content.
5. The lists group the targets by kind, in the order the server sent them, and nest them by
   `level`. A pick inserts the link path.
6. Following the link parses the parameters into the `ViewScope` of the note context, and the type
   widget of the note scrolls to the target.

## Decide first

1. **Which notes.** `isFor(type, mime)` gets the note type and MIME type. Markdown notes are
   `type === "code"` with `isMarkdownMime(mime)`; PDF and DOCX files are `type === "file"` with
   their MIME type; spreadsheets are `type === "spreadsheet"`.
2. **Which kind.** Reuse a kind when the target is the same kind of thing (a heading is a heading).
   Add a kind to `REFERENCE_KINDS` only for a new kind of thing, such as a page or a sheet.
3. **Which link parameter, and is it stable.** A target that has a stable address already (a page
   number, a sheet id, an annotation id) gets `params` and needs no `createReference`. A target
   whose address must be written into the content first (a text heading without a block id) is
   listed without `params`, and the provider implements `createReference`. Prefer existing
   parameters (`block`, `bookmark`, `page`, `annotation`) when they mean the same thing.
4. **Where the content can be parsed.** Core runs on the server, in desktop and in standalone's
   browser worker. A parser that needs Node, or that standalone stubs out (`pdfjs-dist`, see the
   `developing-standalone` skill), belongs in a provider that the server registers.

## Server: write a provider

A provider is a plain object. Keep the parsing in exported pure functions, so that the spec needs
no database:

```ts
// packages/trilium-core/src/services/references/<content>.ts
import type { ReferenceTarget } from "@triliumnext/commons";

import type { ReferenceProvider } from "./index.js";

const sheetReferences: ReferenceProvider = {
    isFor: (type) => type === "spreadsheet",
    findTargets: (content) => typeof content === "string" ? findSheetTargets(content) : []
};

export default sheetReferences;

/** The sheets of the workbook in `content`, in tab order. */
export function findSheetTargets(content: string): ReferenceTarget[] {
    // ...
}
```

Then add it to `providers` in `references/index.ts`. The routes need no change.

Rules:

- **`title` is plain text, never HTML.** The lists render it as text, and content is not
  sanitized on save, so HTML from a note would be a stored XSS path. Decode entities, drop markup.
- **Order is part of the contract.** Return the targets in the order the lists show them, with the
  targets of each kind together. Sort inside the provider if the lists should show a sorted kind
  (the text provider sorts anchors by name, as the editor does).
- **`level` only for kinds that nest**, 1 for the top level. A target without `level` sits at the
  top level of its card and has no expander.
- **`params` hold unencoded values.** The client encodes them (`addParameters()`: `block` with
  `encodeBlockParameter()`, the rest with `encodeURIComponent()`).
- **`findTargets` can be async**, for a parser loaded with `await import()`. The GET route is an
  `asyncApiRoute` and holds no transaction, so `findTargets` must not write.
- **`createReference` is synchronous**: the POST route reads and writes in one transaction. It
  finds the target from `request.kind`, `request.index` (the position among the targets of that
  kind, as `findTargets` lists them) and `request.title`, and returns `null` when nothing matches
  (409). Match like `findHeading()` in `text.ts`: the target at `index` while its title is still
  `title`, otherwise the only target of that kind with that title.
- **Return the same `content` when nothing changes**, so the note is not saved again. The registry
  saves with `note.setContent()`: no revision, no `saveLinks()`.
- **Change only the bytes you mean to.** `node-html-parser` rewrites every attribute of an element
  it modifies and corrupts backslashes in them; splice the stored string at `range` offsets, as
  `insertBlockId()` does.
- **Never put a title in an error message**: 4xx messages reach the backend log, and the title can
  come from a protected note. Name the note id, the kind and the index.
- **Large content**: test a cheap regular expression before parsing (`MAY_HOLD_REFERENCES` in
  `text.ts`), and walk deep trees with an explicit stack, not recursion.

What the registry does for every provider:

- A note that no provider reads lists `{ targets: [] }`, and its POST answers 400.
- A protected note without a protected session answers 400 for both.
- Targets without `params` are left out when the provider has no `createReference`, or when
  `note.isContentWritable()` is false (help pages and other read-only virtual notes).
- Read-only notes (`#readOnly`) do get references: a reference is invisible, and a link needs it.

### Registering a provider from an app

A provider whose parser needs Node goes in `apps/server/src/` and is registered at startup with
`registerReferenceProvider()`, next to `registerServerLlmExtensions()` in `apps/server/src/www.ts`.
Load the parser with `await import()` inside `findTargets`, so it stays out of the startup bundle
(`analyzing-backend-bundle` skill). Desktop runs the same server code. Standalone then lists no
targets for those notes, which the lists show as "no targets".

### Attachments

The routes take a note. For PDF or DOCX attachments:

1. Generalize `findReferenceTargets()` and `createReference()` in `references/index.ts` to take
   the content source (`BNote` or `BAttachment`). Both have `mime`, `getContent()`,
   `setContent()` and `isContentAvailable()`. An attachment has a `role` (`file`, `image`) where
   a note has a type, and no `isContentWritable()`. Pass `"file"` as the type of a file
   attachment, as the private `attachmentRoleToNoteTypeMapping` in `battachment.ts` maps it, so a
   provider for file notes reads file attachments too; or let the provider match on `mime` only.
2. Add `GET` and `POST /api/attachments/:attachmentId/references` in `routes/index.ts`, with the
   same wrappers, and document them in `internal.openapi.yaml`.
3. On the client, a link to an attachment is `<notePath>?viewMode=attachments&attachmentId=<id>`,
   so the target parameters go after those. Add a `getLinkTargets()` twin for attachments, and a
   picker that offers them; the dialog's note page skips targets for attachment links today
   (`isAttachmentLink` in `edit_link.tsx`).

## Shared types: a new kind

1. Add the kind to `REFERENCE_KINDS` in `server_api.ts`.
2. Run the typecheck: `LINK_TARGET_KINDS` in `link_targets.ts` is a `Record<ReferenceKind, …>`,
   so the client fails to compile until the kind has an entry.
3. Add it to the `ReferenceKind` enum in `internal.openapi.yaml`, and regenerate the docs (see
   Documentation).

## Client: show the kind and its parameter

- **`LINK_TARGET_KINDS`** in `link_targets.ts`: `icon` (with the `bx` prefix), `getTitle()` (the
  card and menu header, an `add_link.link_to_<kind>` key in the client catalogue, see the
  `working-with-translations` skill), and `isTitleMirrored` (see below).
- **`TARGET_PARAMS`** in `link_targets.ts`: add a new parameter name. The dialog reads it from the
  link being edited (`splitTargetParameters()`), checks the target whose `params` are exactly
  those (`findTarget()`), and replaces it when another target is picked.
- Nothing else in the lists changes. `LinkTargetList` makes a card per kind (classes
  `link-target-group link-target-<kind>`), `LinkMentionList` a menu header per kind, and both nest
  by `level` and filter by `title`.
- **Strings written for headings and anchors**: `add_link.select_note_for_targets`,
  `add_link.no_link_targets`, `add_link.heading_reference_failed` and
  `add_link.title_from_heading` name headings and anchors. Reword them when a kind of another
  nature (pages, sheets) arrives.
- **The client asks the server about every note picked**, except a protected note outside a
  protected session. Do not add a client-side type check: the server's registry is the one place
  that knows which notes have targets.

### `isTitleMirrored` and reference link titles

A link without a text of its own is a reference link: its text follows the note title, or for a
`?block=` link the text of the block (`loadReferenceLinkTitle()` in `services/link.ts`, and the
Markdown chip in `resolveWikilinkChip()`, `type_widgets/markdown/editor_utils.ts`).
`isTitleMirrored: true` tells the dialog that a link to the kind shows the target's title: the
title field's placeholder says so, and a selection without text gets the target's title. Set it to
`true` only if those functions label the kind's parameter; otherwise the link shows the note
title, and the dialog must say that.

### The note being edited

The server reads the saved content. The note open in an editor can have unsaved targets, and a
reference the server writes would be lost on the editor's next save. So the editor supplies its
own targets:

- The `@` list takes `getOwnTargets(notePath)` (CKEditor: `getOwnLinkTargets()` in
  `type_widgets/text/config.ts`). The Markdown completions (`createCompletionList()` in
  `type_widgets/code/editor_completions.tsx`) pass none yet.
- The dialog takes `noteId`, `headings` (`LinkTarget[]`) and `anchors` in `EditLinkOpts`
  (CKEditor: `getEditLinkOpts()` in `EditableText.tsx`). The Markdown editor's
  `showEditLinkDialog()` passes none yet.
- An editor's own targets give themselves references synchronously in `createLinkPath()` (as
  `createEditorHeadings()` does with `assignBlockId()`), and have no `createReference`.
- The Heading / anchor page of the dialog is for the editor's own document only. Its anchors link
  as `#name`, not through the note path.

## Navigation: make the link land

A link parameter does nothing until the note view reads it:

1. Add the parameter to `ViewScope` and to `VIEW_SCOPE_PARAMS` in `navigation_state.ts`, or links
   lose it with a "Unrecognized hash parameter" warning. Add it to `calculateHash()` only when it
   must survive in the tab's URL; `bookmark` and `block` are consumed once and are not written.
2. In the type widget, read it from `noteContext.viewScope` once the content is shown, scroll to
   the target, then clear it, as `revealLinkTarget()` in `type_widgets/file/Pdf.tsx`,
   `consumeBookmark()` in `services/bookmark_jump.ts` and `consumeBlockReference()` in
   `services/block_reference.ts` do.
3. Backlinks need nothing: `findInternalLinks()` and `findMarkdownInternalLinks()` in core's
   `services/notes.ts` take links with any query.
4. Markdown keeps the query in Wikilinks (`toWikilink()` writes `[[noteId?page=3]]`), and its
   chips label only `block` and `bookmark` (`resolveWikilinkChip()`).
5. Shared pages handle only `?block=` (`showBlockReference`, `developing-share-pages` skill).

## Testing

| What | Spec | How |
|---|---|---|
| The provider | `references/<content>.spec.ts` | Pure functions: content in, targets out; `createReference` with a fake `createId` |
| The routes | `routes/api/notes.spec.ts`, `describe("references")` | `CoreApiTester`: a note of the type, 200/400/404/409, the content after the POST, no revision |
| CSRF on the POST | `apps/server/src/routes/api/core_routes_http.spec.ts` | Only if a new route is added |
| A new kind | `link_targets.spec.ts`, `LINK_TARGET_KINDS` case | The icon, the title key, `isTitleMirrored` |
| The parameter | `link_targets.spec.ts`, `splitTargetParameters()` case | Read out of a link path |
| The landing | The type widget's spec | The view scrolls to the target and clears the parameter |

Core specs run under both runners:

```bash
pnpm --filter server test trilium-core/src/services/references trilium-core/src/routes/api/notes.spec
pnpm --filter standalone test trilium-core/src/services/references trilium-core/src/routes/api/notes.spec
pnpm --filter client test src/services/link_targets src/widgets/react/LinkTargetList src/widgets/react/LinkMentionList src/widgets/dialogs/edit_link
```

Where `pnpm` cannot start a script, run `../../node_modules/.bin/vitest run <patterns>` from the
app's directory instead.

In client specs, `t()` returns `undefined` unless `services/i18n` is mocked to echo the key. A spec
that registers a provider unregisters it in `afterAll` (`unregisterReferenceProvider()`).

## Documentation

- After editing `internal.openapi.yaml`, regenerate the generated API Reference page and the in-app
  help (`writing-documentation` skill, `docs.mjs sync`). Never edit them by hand.
- A kind that users can link to is user-facing: describe it where the User Guide explains links
  to headings and anchors (`docs.mjs impact "Link to a heading"` finds the pages), and add a
  changelog entry.

## Traps

- **The order of a kind must not change between the GET and the POST** for the same content: the
  POST finds the target by its position among its kind. Do not sort a kind that takes references
  in one route and not in the other.
- **Do not list a target without `params` that `createReference` cannot reach.** The registry only
  drops such targets when the provider has no `createReference` at all.
- **A target can have several parameters** (`{ page: "5", annotation: "12R" }`). `findTarget()`
  matches the exact set, so a page target `{ page: "5" }` and an annotation target on that page
  stay apart.
- **Two editors of one note**: `createReference()` on the client triggers `saveNoteChanges` before
  the POST. An editor in another window with unsaved changes can still overwrite the reference;
  the link then shows as broken, as a deleted block does.
- **Sync replaces whole blobs**: a reference written here and an edit made elsewhere before sync
  can lose the reference.

Worked sketches for Markdown headings, PDF pages, DOCX files and spreadsheets:
[references/examples.md](references/examples.md).
