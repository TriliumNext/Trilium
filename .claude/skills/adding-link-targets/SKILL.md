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
  dialog), and the navigation side (`ViewScope`, `VIEW_SCOPE_PARAMS`, `calculateHash()`, the type
  widget that scrolls to the target, `useSameNoteSwitch()`, `EmbeddedNotePane`'s link takeover,
  reference link labels, link parameters on shared pages). Also load it before changing any of
  those files.
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

Block ids, `?block=` links, their labels and excerpts are a feature of their own, which the text
note provider builds on: the `developing-block-references` skill.

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
| Navigation | `apps/client/src/services/navigation_state.ts` | `ViewScope` fields and `VIEW_SCOPE_PARAMS`, which a link parameter must be part of; `calculateHash()` |
| Landing | `apps/client/src/widgets/react/hooks/note_context.ts` | `useSameNoteSwitch()`, for a link to the note a widget already shows |
| Note panes of views | `apps/client/src/widgets/EmbeddedNotePane.tsx` | `useFollowLinksWithin()`, which leaves links with a target parameter to normal navigation |
| Link labels | `apps/client/src/services/link.ts` | `loadReferenceLinkTitle()` (the label on screen), `getReferenceLinkTitleSync()` (the text saved in the `<a>`) |
| Shared pages | `packages/trilium-core/src/share/content_renderer.ts` | `handleAttachmentLink()` (link hrefs), `getLinkedHeadingText()` (labels) |

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
- **A target that has a reference already gets it back.** The list the client shows can be older
  than the content: another window or a sync can have given the target a reference since. Return
  its `params` with the same `content`, as `createReference` in `text.ts` returns the id a heading
  has, so repeated and concurrent POSTs write once.
- **Return the same `content` when nothing changes**, so the note is not saved again. The registry
  saves with `note.setContent()`: no revision, no `saveLinks()`, and `dateModified` moves as for
  any change of the content.
- **A reference counts only where it first occurs**, since the view scrolls to the first match.
  List a target whose reference an earlier one also carries without `params`, and let
  `createReference` give it a new one in front of the old (`takenIds` in `text.ts`): the first of
  two equal attributes wins in browsers, in CKEditor and in `node-html-parser`. Draw a new id
  again while it occurs anywhere in the content.
- **Change only the bytes you mean to.** `node-html-parser` rewrites every attribute of an element
  it modifies and corrupts backslashes in them; splice the stored string at `range` offsets, as
  `insertBlockId()` does.
- **Never put a title in an error message**: 4xx messages reach the backend log, and the title can
  come from a protected note. Name the note id, the kind and the index.
- **Large content**: test a cheap regular expression before parsing (`MAY_HOLD_REFERENCES` in
  `text.ts`), and walk deep trees with an explicit stack, not recursion: a recursive walk
  overflows on content nested 20,000 levels deep.
- **No cache.** The text provider parses on every request, about 12 ms per 100 KiB of content
  dense with headings.
  If a parser costs enough to need a cache, key it by `blobId` and leave protected notes out, or
  their decrypted titles stay in memory after the protected session ends.

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

A link without a text of its own is a reference link: its text follows the note title, and a
parameter can add to it. Each surface that shows such a link labels it on its own:

| Function | Where | Labels today |
|---|---|---|
| `loadReferenceLinkTitle()` | `services/link.ts`: the label on screen, in editors and read-only views | The note title, then a `<small>` with the anchor name (`bookmark`) or the excerpt of the blocks (`block`) |
| `getReferenceLinkTitleSync()` | `services/link.ts`: the text saved inside the `<a>` in the note content | `Title - anchor`, `Title - excerpt` once the excerpt is cached |
| `resolveWikilinkChip()` | `type_widgets/markdown/editor_utils.ts`: the chip of a Markdown Wikilink | `block` and `bookmark` |
| `getLinkedHeadingText()` | core `share/content_renderer.ts`: shared pages | The heading text, for a `block` link to a heading of the same note |

A parameter that should show in the label needs a branch in each. A link to blocks of the note it
is in shows only the excerpt, without the note title: callers pass that note as `hostNoteId`.

`isTitleMirrored: true` tells the dialog that a link to the kind shows the target's title: the
title field's placeholder says so, and a selection without text gets the target's title. Set it to
`true` only if those functions label the kind's parameter; otherwise the link shows the note
title, and the dialog must say that.

### The note being edited

The server reads the saved content. The note open in an editor can have unsaved targets, and a
reference the server writes would be lost: an editor with unsaved changes ignores the reload that
the write triggers (`hasUnsavedChanges()` in `widgets/react/hooks/editor.ts`), and its next save
writes content without the reference. Inserting the link makes the editor dirty at once, so this
always happens for the note being edited. So the editor supplies its own targets:

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

### Changing the lists

A new kind needs none of this; it matters when the lists themselves change.

- **Startup allowlist.** `NoteAutocomplete.tsx` and `FormAutocomplete.tsx` load at startup and are
  on the client's startup allowlist, so they must gain no imports: `pnpm dev:check-startup` fails
  in CI (`measure-startup-requests` skill). `LinkMentionList` composes the second page from their
  exports instead.
- **Held picks.** `useAutocomplete()` in `FormAutocomplete.tsx` keeps `pickedSinceRender` set
  after a pick that `holdOnPick` holds while nothing renders, so the next Enter is not taken and
  Tab closes the list. `LinkMentionList` therefore takes Enter and Tab itself on key repeat and
  while the highlighted row cannot be picked (`canPick()`: a target only once the link is in the
  text, the whole note at any time).
- **The option.** `textNoteCompletionLinkTargetsEnabled` turns the second page off in both
  editors. Each list reads it as it draws, so an open editor follows a change without a rebuild:
  `createNoteMentionList()` (`text/mention_list_view.tsx`) then draws `NoteMentionList` although
  the text editor's config passes `getOwnLinkTargets`, and the Markdown `createCompletionList()`
  does the same. The link dialog does not read it.
- **Links that match no target.** The dialog's selection is a `NotePart`: `{ target }`,
  `{ params }` or `null`. A link being edited whose parameters match no listed target (a
  paragraph, a range of blocks) is `{ params }` and keeps them until another target is picked.
- **A failed reference.** `createReference()` posts through `postWithSilentErrors()`, so the
  caller's toast (`add_link.heading_reference_failed`) is the only one. The dialog then stays open;
  the `@` list (`getTargetLinkPath()`) leaves the link to the whole note. The dialog bumps
  `generationRef` on reset and unmount, so a POST that answers after Escape applies nothing.

## Navigation: make the link land

A link parameter does nothing until the note view reads it:

1. Add the parameter to `ViewScope` and to `VIEW_SCOPE_PARAMS` in `navigation_state.ts`, or links
   lose it with a "Unrecognized hash parameter" warning. Add it to `calculateHash()` too, so it
   survives the tab state, popups and detached windows until the widget consumes it: `block`,
   `page` and `annotation` are written there, `bookmark` is not. Values go through
   `encodeURIComponent()`; `block` uses `encodeBlockParameter()` to keep its colon readable.
2. In the type widget, read it from `noteContext.viewScope`, scroll to the target, then clear it,
   as `revealLinkTarget()` in `type_widgets/file/Pdf.tsx`, `EditableText.tsx` and
   `ReadOnlyText.tsx` do (the text widgets through `consumeBookmark()` in
   `services/bookmark_jump.ts` and `consumeBlockReference()` in `services/block_reference.ts`).
   See "Landing on the target" below.
3. Add the parameter to the check in `useFollowLinksWithin()` (`widgets/EmbeddedNotePane.tsx`).
   The note pane of the geo map, calendar and other views takes over a plain link to a note the
   view can show, and opens the note in the pane without its parameters. A link with
   `attachmentId`, `bookmark` or `block` is left to normal navigation, so it lands in a note tab.
   `page` and `annotation` are not in that check yet.
4. Backlinks need nothing: `findInternalLinks()` and `findMarkdownInternalLinks()` in core's
   `services/notes.ts` take links with any query.
5. Markdown keeps the query in Wikilinks (`toWikilink()` writes `[[noteId?page=3]]`), and its
   chips label only `block` and `bookmark` (`resolveWikilinkChip()`).
6. Shared pages keep only `block`. `handleAttachmentLink()` in core's `share/content_renderer.ts`
   rewrites a link in shared content to the share link of its note and carries `?block=` over;
   every other parameter is dropped, so such a link opens the top of the shared page. The page
   reads `?block=` with `showBlockReference()` (`developing-share-pages` skill). A parameter that
   should work on shared pages needs both.

### Landing on the target

- **Wait for the content.** Return without clearing the parameter while the content is not
  rendered, or a link opened in a new tab is used up against an empty container. `EditableText`
  waits for the editor (`revealLinkTargetWhenReady()`: the editor initialized, then one animation
  frame); `ReadOnlyText` skips the render without a blob; `Pdf.tsx` waits until the viewer is
  shown and has listed its annotations.
- **A link to the note that is already open** changes the view scope but not the content, so code
  that runs when the content loads does not run again. Listen to `noteSwitched` for the same note
  context and the same note: `useSameNoteSwitch()` in `widgets/react/hooks/note_context.ts`, or
  `useTriliumEvent("noteSwitched", …)` as `Pdf.tsx` does.
- **Check that the widget shows that note and is visible** before taking the parameter. A switch
  from note A to note B can reach the widget before B's content has arrived; the search then runs
  on A's content, reports a broken target and clears the parameter. And `NoteDetail` can keep two
  widgets of one note mounted (`EditableText` and `ReadOnlyText`, once `#readOnly` has been
  toggled): both get the event, and the hidden one must leave it. `EditableText` checks
  `isVisible !== false && contentNoteIdRef.current === note.noteId`.
- **Show the start of the target.** `scrollIntoView({ block: "center" })` hides the start of a
  tall target. `scrollToBlocks()` in ckeditor5's `block_reference/block_reference_read_only.ts`
  centers the target but keeps at least 15% of the viewport above it (`MIN_TOP_GAP`). Open what
  hides the target first, as `expandAncestorDetails()` in `services/collapsible.ts` opens
  collapsed blocks.
- **Clearing is local.** `NoteContext.setNote()` keeps a copy of the view scope it is given, so a
  caller that passes its own scope (an excerpt's _Open in new tab_) keeps its parameter.

## Testing

| What | Spec | How |
|---|---|---|
| The provider | `references/<content>.spec.ts` | Pure functions: content in, targets out; `createReference` with a fake `createId` |
| The routes | `routes/api/notes.spec.ts`, `describe("references")` | `CoreApiTester`: a note of the type, 200/400/404/409, the content after the POST, no revision |
| CSRF on the POST | `apps/server/src/routes/api/core_routes_http.spec.ts` | Only if a new route is added |
| A new kind | `link_targets.spec.ts`, `LINK_TARGET_KINDS` case | The icon, the title key, `isTitleMirrored` |
| The parameter | `link_targets.spec.ts`, `splitTargetParameters()` case | Read out of a link path |
| The landing | The type widget's spec | The view scrolls to the target and clears the parameter; it waits for the content; a link to the open note lands, but not for another note context or while hidden (`ReadOnlyText.spec.tsx` has these cases) |
| The pane check | A spec beside `EmbeddedNotePane.tsx` (none yet) | A link with the parameter is left to normal navigation |
| The label | `link.spec.ts` | Both label functions, only if the parameter is labeled |

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
