---
name: developing-content-embeds
description: >-
  Use when building or changing an embed in a text note — an included note, an attachment embed such as a canvas drawing (`CanvasDrawing`), or a source embed such as a Mermaid diagram (`MermaidDiagram`, `SOURCE_EMBED_TYPES`) — or adding an embed kind. Covers the storage forms (`data-note-id`, `data-attachment-id`, inline `<pre><code class="language-…">`), the editor plugin (`packages/ckeditor5/src/plugins/content_embed/`: `content_embed.ts`, `inline_source.ts`, toolbar, box-size dropdown), the host contract (`contentEmbed.loadAttachment()`, `contentEmbed.loadInline()`), the client box (`ContentEmbed`, `text/utils.ts`), the content component contract (`useEditableEmbed()`, `ContentEmbedToolProvider`, Editable, display modes, fullscreen), reusing the note type's component as canvas and Mermaid do, the read-only paths (AI chat, Markdown preview, print, share), and traps hit (detached content, CodeMirror read-only fixed at creation, the CKEditor `:first-child` separator rule, untitled box sizes, class clashes).
---

# Developing content embeds

An embed is a box in a text note that shows content other than text: another note, an attachment
of the note, or a source kept in the note itself. The box (title row, size, caption, fullscreen,
toolbar, menu) is shared; what it shows is a **content component** chosen by the kind of content.
Two components show what a fully featured embed looks like:

- **Canvas drawing** — `apps/client/src/widgets/type_widgets/canvas/CanvasDrawing.tsx`. Excalidraw
  scene in an attachment (`CANVAS_ATTACHMENT_MIME`). A picture while not edited, Excalidraw while
  Editable is on. Its own tools in the embed toolbar (`CanvasEmbedTools.tsx`).
- **Mermaid diagram** — `apps/client/src/widgets/type_widgets/mermaid/MermaidDiagram.tsx`. A
  *source embed*: the source sits inline as a code block, or in an attachment
  (`MERMAID_ATTACHMENT_MIME`); one component serves both. Source, split or preview view; zoom and
  syntax-help tools.

**The rule both follow: the embed is built from the note type's own component, not beside it.**
`CanvasDrawing` renders `CanvasEditor` from the canvas note (`canvas/Canvas.tsx`); `MermaidDiagram`
renders `SplitLayout` from `helpers/SplitEditor.tsx` and `SvgPreview` / `SvgZoomControls` /
`useSvgRender()` / `useSvgZoom()` from `helpers/SvgSplitEditor.tsx`, the same parts the Mermaid
note uses. A first version of the Mermaid embed reimplemented its panes, viewer and error box and
drifted at once (a raw error box instead of the note's error card, no divider). When the note
type's component is bound to a note (labels, `noteContext`, `EditableCode`), **extract the
note-independent part into an exported component in the same module** and have the note type use
it too — `SplitEditor` → `SplitLayout` + `useMountedPanes()` is the worked example. Only the parts
that are about storage stay separate (the embed's source pane is `CodeEmbedEditor` bound to a
`ContentEditor`, the note's is `EditableCode` bound to the note).

## The three storage forms

What the text note saves, and what the editor model holds (`contentEmbed` element):

| Form | Saved HTML | Model attributes |
|---|---|---|
| Included note | `<figure class="include-note" data-note-id="…" [data-block="…"]>` | `noteId`, `block` |
| Attachment | `<figure class="include-note" data-attachment-id="…">` | `attachmentId` |
| Inline source | `<pre data-box-size=… [data-display-mode=…] data-hide-title data-editable><code class="language-mermaid">…</code></pre>` | `language`, `source` |

All three carry `boxSize`, `hideTitle`, `editable`, `displayMode` (`data-box-size`,
`data-hide-title`, `data-editable`, `data-display-mode`) and the resized size as
`--include-note-width` / `--include-note-height` in `style`. The figure keeps an optional
`<figcaption>`.

- **Inline source** (`inline_source.ts`, `ContentEmbedInlineSource`) keeps the document readable
  elsewhere: the note exports to Markdown as a fenced `mermaid` block, other apps render it, and
  undo in the note undoes source edits through the shared undo history (see _Undo history_ below).
  `setSource()` writes outside the undo stack and does **not** redraw the embed, which would
  remount its editor. The plugin hands out one `InlineEmbedSource` per embed element, which keys
  its history. It is converted only for languages in
  `contentEmbed.inlineLanguages` (from `SOURCE_EMBED_TYPES` in `text/config.ts`); a code block of
  another language stays a code block.
- **Legacy blocks** — a `<pre>` without `data-box-size` predates the embed (the old Mermaid
  plugin). `getModeOfSavedView()` loads it editable, in the view of its
  `data-trilium-display-mode` or split, at Medium. A saved embed keeps exactly what it has.
- **Attachment** suits large or binary content and content with its own save cycle (Excalidraw).
  The attachment's content type comes from `getFileContentType()` in
  `packages/commons/src/lib/notes.ts` (`canvasDrawing`, `mermaidDiagram`), which
  `getRenderedContent()` dispatches on.

## How a box gets its content

1. **Editor plugin** (`packages/ckeditor5/src/plugins/content_embed/`). `content_embed.ts` owns the
   model, the converters, the commands (`contentEmbedBoxSize`, `toggleContentEmbedTitle`,
   `toggleContentEmbedCaption`, `toggleContentEmbedEditable`, `contentEmbedDisplayMode`,
   `convertEmbedToLink`), the box-size rules and observables such as `isSelectedEmbedInline`.
   `content_embed_toolbar.ts` lists the toolbar items; `content_embed_tools.ts` turns the
   content's tools into buttons; `content_embed_box_size_dropdown.ts` the size menu. The editing
   view renders an `.include-note-wrapper` and asks the **host** to fill it.
2. **Host contract** (`ContentEmbedHost` in `content_embed.ts`, read from the editor config
   as `contentEmbed`): `loadNote()`, `loadAttachment()`,
   `loadInline(source, wrapper, boxSize, { isFocused })`, `focusAttachment()`, `openMenu()`,
   `getTools()`, `enter()` and `getAttachmentHref()`. `EditableText.tsx` implements them as
   `contentEmbedHandlers`, which `CKEditor.tsx` hands to `buildConfig()` through a getter. The
   plugin never imports client code.
3. **Box** (`text/utils.ts`). `loadEmbeddedAttachment()` / `loadInlineEmbed()` render the content
   with `content_renderer`, wrap it in `ContentEmbed` (`text/ContentEmbed.tsx`: title row,
   fullscreen, exit-fullscreen overlay) and `mountEmbedBox()`. Content that left the page while it
   loaded is disposed; `watchContentEmbeds()` disposes boxes removed later.
4. **Content** (`services/content_renderer.ts`). `renderCanvasDrawing()` and `renderSourceEmbed()`
   mount the component through `mountInteractiveWidget()` when `options.interactive`, with
   `getContentEditor()` as its `ContentEditor`; otherwise a static rendering (the drawing's picture).
   Lazy modules are listed in `CONTENT_RENDERERS.file` so read-only pages and the share theme never
   load the editors.

## The content component contract

A content component receives the content and an optional `ContentEditor`
(`canEdit()`, `getUnsavedContent()`, `scheduleSave()`, `release()`; no editor = read-only). Source
embeds receive `SourceEmbedProps` (`content`, `editor`) whichever storage the source has:
`InlineSourceEmbed` and `AttachmentSourceEmbed` in `text/SourceEmbed.tsx` adapt the two.

- **`useEditableEmbed(rootRef, { editor, note, tools, focusTarget })`** (`text/editable_embed.tsx`)
  returns `canEdit` (an editor that can save, no `#readOnly`, database writable) and `isEditing`
  (`canEdit` and the embed's Editable toggle on). It registers `tools` while `canEdit` and moves
  the focus to `focusTarget` when the box takes it. Nested embeds stay read-only
  (`NestedEmbedContext`).
- **Toolbar tools** — a `ContentEmbedToolProvider` (`text/content_embed_tools.ts`):
  `getTools()`, `execute(id)`, `subscribe()`, plus
  - `hasEditableFlag` — shows the Editable toggle; the embed carries `data-editable="true"`.
  - `hasDisplayModes` — shows Source/Split/Preview; the embed carries `data-display-mode`.
  - `hiddenToolbarItems` — moves box size, title, convert-to-link or Editable from the toolbar to
    the ⋮ menu (an extended code block hides box size and Editable).
  - `boxSizeIcon` — an SVG the box size dropdown shows in place of the size name, which moves to
    its tooltip (`Box size: %0`). Code and Markdown embeds set it even while read-only
    (`hasEditableFlag: false`), so every one of them shows the icon; code embeds through
    `useContentEmbedMenus()`.
  - `getMenuItems()` — items of the ⋮ menu after Editable, in a group of their own
    (`useContentEmbedMenus(rootRef, menus, menuItems)` passes them through).
- **A CodeMirror pane in an embed** (code, Markdown, Mermaid) takes its line wrapping and line
  numbers from `useEmbedLines(rootRef, note)` (`code/CodeEmbed.tsx`): pass `wrapLines` /
  `hasLineNumbers` to `EmbedSourcePane` or `CodeEmbedEditor`, and `menuItems` (the _Word wrap_
  and _Line numbers_ submenus) to `getMenuItems()` while the content can be edited. A note keeps
  the wrapping in `#wrapLines`; everything else lives in `data-code-wrap-lines` /
  `data-code-line-numbers`, on the `<pre>` for inline source (the code view command sets only
  line numbers on a note embed). `ReadOnlyText` copies them from the `<pre>` to its box.
- **The `/` list** of a CodeMirror pane is the note's own: `CodeEditor` calls
  `useEditorCompletions()` (`code/editor_completions.tsx`) with its `completions` prop, which
  `CodeEmbedEditor` passes while it has an `editor`. For any language other than Markdown it
  only loads the snippets of the pane's MIME type and hands them to `CodeMirror`'s `getSnippets`,
  which `codeCompletions()` (`code/code_completions.tsx`) lists with the TypeScript completions.
  For Markdown it registers its own list instead: the commands and snippets, `@` and `[[`, which
  need `ownerNote` (the note an attachment belongs to) for uploads and new notes.
  `getEdgeLeftBy()` holds the caret in the embed while either list is open. Specs that mount an editable Markdown pane mock
  `services/task_states`; specs that mount any of them keep `services/i18n` partial
  (`importOriginal`), as `NoteAutocomplete` reads it.
  - `group` on a tool — a separator goes between groups. Notify listeners only when the tools
    really changed (`MermaidDiagramTools.update()` compares a JSON snapshot) and after the render
    (`queueMicrotask`), as a listener updates the editor's toolbar.
- **Reading the embed's state** from the content: `useIsContentEmbedEditable(ref)`,
  `useContentEmbedDisplayMode(ref)` (saved mode or `null`; resolve with `resolveDisplayMode(mode,
  !isEditing)` from `helpers/split_editor_mode.ts`), `useContentEmbedEvent(ref, name, cb)` for
  `fullscreenChangeStart` / `enterFullscreen` / `leaveFullscreen`, and
  `showContentEmbedFullscreen(element)`.
- **Fullscreen hides the editor's toolbar** (only the content box goes fullscreen). Content whose
  controls live in the toolbar must show them over itself meanwhile — `MermaidDiagram` shows
  `SvgZoomControls` while `!canEdit || isFullscreen`. The box already has an exit button.
- **Fullscreen without a title row.** The title row holds the box's fullscreen button, so an
  untitled Medium or Full box (`needsFullscreenButton()` / `useNeedsFullscreenButton()`) needs
  the content to offer one: a toolbar tool while it can be edited, an `OverlayFullscreenButton`
  after the zoom buttons while read-only (no toolbar then). A read-only drawing still has none.

## Undo history

The edits made in an embed's CodeMirror (code, Markdown, Mermaid, inline or not) and in a drawing
canvas's Excalidraw are steps of the text editor's undo stack, in order with the text's own
changes. Three layers, with one recorder per editor in the middle:

- **`EmbedHistory`** (`packages/ckeditor5/src/plugins/content_embed/embed_history.ts`, required by
  `ContentEmbed`) is editor-agnostic. `push({ undo, redo })` adds a batch that only adds or removes
  the `embedHistoryStep` marker (`affectsData: false`): it fires `change`, which resets the typing
  buffer, but not `change:data`. The `revert` events of `undo`/`redo` run the step; a step that
  returns `false` is skipped and the command runs again. `isLatest()` tells the content whether
  its step can still grow. `undo()`/`redo()` are for keys pressed inside an embed: they focus the
  text editor when the reverted change was its own.
- **`SharedHistory`** (`packages/codemirror/src/shared_history.ts`) records the transactions of
  every view of one document, grouped as `history()` groups them, and applies a step to the view
  whose document matches, else through `write` while no view shows it (a remount in progress). A
  step whose document changed since does not apply. `view.setSharedHistory()` replaces the view's
  own `history()` and routes Mod-Z/Mod-Y/Mod-Shift-Z, the `historyUndo`/`historyRedo` input
  events and Vim's `u`/`Ctrl-R` to the host.
- **`DrawingHistory`** (`canvas/drawing_history.tsx`) does the same for Excalidraw, whose 0.18
  history is private. `useCanvasDrawingPersistence()` takes a `DrawingMount` when it reads the
  content, attaches it once the scene shows, calls `record()` on each `onChange` and `detach()` in
  a layout cleanup. A step is an element delta (before/after clones and the changed keys, never
  `version`/`versionNonce`/`updated`/`status`) plus the background, recorded once
  `isInteracting()` is false (pointer up, text submitted, line finished). A change with no input
  inside the root since the last record (an image that finished loading) joins the last step while it
  `isLatest()`. `api.registerAction()` replaces Excalidraw's `undo`/`redo` by name, so its keys,
  its footer buttons and `CanvasTools` (which clicks `button-undo`) reach the host; the
  replacement button copies Excalidraw's `ToolButton` markup. Without a mounted Excalidraw, a step
  reads the drawing through the `DrawingStore` it attached with (the unsaved content, else the
  blob, so a save made elsewhere since stays), patches it and writes it back; the steps queue one
  after another and count in `revision` once written; a step on a live canvas waits behind them. They also patch an Excalidraw that attached
  during the read (patches are idempotent), and a mount that loaded before a written step (an
  undone Editable toggle remounts) reads the drawing again at attach. Undo sorts by fractional index when a step sets `index`,
  as Excalidraw renumbers an out-of-order array instead of reordering it.
  `excalidraw_contract.spec.ts` pins the Excalidraw internals this relies on.
- **`EmbedHistories`** (`text/embed_history.ts`, one per `EditableText`) gives a `ContentHistory`
  (`host` + `write`) per note ID, attachment ID or `InlineEmbedSource`, as `ContentEditor.history`.
  Its `host` also tells whether the note can undo or redo (`isEnabled()`, `subscribe()`), for the
  drawing's buttons. It imports no CodeMirror or Excalidraw at runtime: `CodeEmbedEditor` creates
  the `SharedHistory` on it and `getDrawingHistory()` the `DrawingHistory`, each attached while
  mounted, read-only included.

Content loaded from elsewhere goes through `view.loadText()`, which stays out of the history; a
`setText()` (re-indent) is a step. The `content` prop of `CodeEmbedEditor` loads, so a change made
while read-only (the re-indent stand-in in `CodeEmbed.tsx`) calls `setText()` on the read-only view,
after loading the unsaved content of the other embeds into it, or Undo skips it or reverts their
edits. Another editor joins by pushing its own steps to `EmbedHistory` through the same `host`.
Included text notes keep their own history. Testing it live: open the note in one tab only, as
editors of one note in several tabs reload each other's saves and mix up the result.

## Recipe: a new source embed (a diagram language)

1. Add a `SourceEmbedType` to `SOURCE_EMBED_TYPES` in `apps/client/src/services/source_embeds.ts`:
   `language`, `mime` (a `*_ATTACHMENT_MIME` in `packages/commons/src/lib/notes.ts`), `contentType`,
   `load()` (lazy import of the component), `renderPreview()` (static rendering, used by the AI
   assistant's inline previews through `contentEmbed.renderInlinePreview`).
2. Map the MIME to the content type in `getFileContentType()` and give it an icon in the
   attachment icon map next to it; add the content type to the list in `content_renderer.ts`.
3. Write the component on the note type's parts (see the rule above). For a split source/preview
   view, `SplitLayout` + `useMountedPanes()` + `EmbedSourcePane` (in `code/CodeEmbedEditor.tsx`)
   give the layout, the divider, the error card, the stale badge and a source pane that stays
   mounted behind the preview and shares the note's undo history. Delay re-rendering with `useDebouncedValue()`. Give the root
   the `include-note-box-height` class for the 10/20/50em heights per box size and full height in
   fullscreen (content with a height of its own can fit it at Full instead, as
   `MarkdownEmbed.css` sets `height: auto` down to the split's columns), and round it with `--_include-note-content-*-radius` (edge to edge) or
   `--_include-note-framed-*-radius` (inside the 2px frame), all in `style.css`.
4. An insert command: `INSERT_INLINE_EMBED_COMMAND` with `{ language, source }` (see
   `mermaid_ui.ts` and `slash_commands.ts`). New embeds are editable, untitled and Medium.
5. Read-only rendering needs nothing more: `applySourceEmbeds()` in `ReadOnlyText.tsx` picks up any
   language of `SOURCE_EMBED_TYPES`.

## Recipe: a new attachment embed with its own editor (like canvas)

1. A MIME constant and content type (`getFileContentType()`), a `CONTENT_RENDERERS.file` entry and a
   `render…()` branch in `getRenderedContent()` that mounts the component when interactive and
   renders a static picture otherwise.
2. Insert by uploading an empty file as an embed (`insertDrawingCanvas()` in
   `file_upload/file_upload_ui.ts`: `fileUpload` with `asEmbed`, `boxSize`, `hideTitle`,
   `editable`, `focusEmbed`).
3. Persistence through the `ContentEditor` (`useAttachmentEditor()` / `bindAttachmentEditor()` in
   `text/attachment_saves.ts` batch and retry the saves, and flush them before leaving). If other
   places need a picture without loading the editor (share pages, previews), save one as an image
   attachment beside the content, as `persistence.ts` does under `getDrawingPictureTitle()`.
4. An attachment detail view reusing the same editor (`CanvasDrawingDetail` in `Attachment.tsx`).
5. Share pages render on the server (`renderAttachmentEmbed()` in
   `packages/trilium-core/src/share/content_renderer.ts`): add a branch there, or the attachment
   falls back to a link.

## Read-only paths

| Where | Path | What an embed gets |
|---|---|---|
| Read-only note, AI chat replies, tool results | `ReadOnlyTextContent` (`text/ReadOnlyText.tsx`) | `applyContentEmbeds()` → `loadEmbedded*()`; `applySourceEmbeds()` → `loadInlineEmbed()` (`text/utils.ts`) with a fixed read-only source. Same box and component as the editor. |
| Markdown note preview, a chat reply while streaming | `ReadOnlyTextContent` with `isChanging` | Diagrams drawn in place (`rewriteMermaidDiagramsInContainer()` + `applyInlineMermaid()`), which keep the last drawing while the next renders; a box would remount on every update. |
| Print (`glob.device === "print"`), included notes, previews | `postProcessRichContent()` in `services/content_renderer_text.ts` | Drawn in place; printing snapshots before a box would draw. |
| Share pages | server `share/content_renderer.ts`, share theme `content/mermaid.ts` | Static: the drawing's picture as `<img>`, Mermaid drawn over its code block. No box. |

`isChanging` flips when a chat reply finishes: `RawHtmlBlock` is keyed on the choice, because the
in-place drawings replaced the code blocks the boxes need.

## Traps already hit

- **A write held back is part of the note.** `InlineSourceEmbed` writes the source 500 ms after the
  last change. Until then the text note's model does not have it, so a note switch saved the old
  source and `setData()` then dropped the embed, whose later write went to the graveyard. The
  editor hands each held write to `InlineSourceSaves` (`text/attachment_saves.ts`), which marks the
  note changed, and `getData()` in `EditableText` flushes it first — as `AttachmentSaves` does for
  attachments. The write is outside the undo stack, so it can land after an undo without clearing
  Redo; the undo step itself is recorded when the source changes (see _Undo history_).
- **Non-interactive rendering must be finished when it returns.** A presentation slide snapshots
  `getRenderedContent()` and disposes it at once, so a mounted component that draws in an effect
  leaves it blank. Without `options.interactive`, draw a picture before returning
  (`SourceEmbedType.renderPreview()`, `renderCanvasDrawingPicture()`).
- **Draw a level's diagrams before its embeds render.** `applyInlineMermaid()` reads the source
  from the text of each `.rendered-mermaid-diagram`, so a pass over a container whose embeds are
  already drawn renders their SVG text and replaces the drawing with an error.
  `postProcessRichContent()` draws its own diagrams before `renderContentEmbeds()`, and printing
  adds no pass of its own. `trim` keeps the `<style>` inside each SVG.
- **Keep the block ID.** A read-only view that swaps the saved element for a box copies
  `data-trilium-block-id` onto it (on the `<pre>`, or the `<code>` of older diagrams), or links to
  the block stop resolving.

- **Content renders detached.** `loadInlineEmbed()` renders into a detached `div` before the box
  mounts it, so a hook that looks up `.closest(".include-note")` once finds nothing. Use the
  helpers (`useEmbedState()` / `whenInPage()` inside `content_embed_tools.ts`) that wait for the
  element to join the page. `registerContentEmbedTools()` likewise notifies the toolbar only once
  the content is in the page — otherwise an embed auto-selected on load shows the toolbar of an
  included note.
- **Switch editability in place, never by remounting.** `CodeMirror.tsx` follows its `readOnly`
  prop through `setReadOnly()`, which keeps the view, its scroll and selection, and starts a new
  undo history unless the view has a shared one. A `key` that remounted `CodeEmbedEditor` on the toggle painted an empty `<pre>` (a
  Full box collapsed) and then CodeMirror's light default until `setTheme()` loaded the theme. An
  embed renders read-only before it finds its figure, so this runs on every editable load too.
  `CodeMirror` keeps the `onContentChanged` it was created with, so `CodeEmbedEditor` reads the
  current `editor` through a ref, and releases it in a layout cleanup as `editor` goes away. Test
  with `EditorView.state.readOnly`, not `contenteditable`, which CodeMirror leaves `true`, and
  assert the view is the same one after the toggle. A read-only `CodeEmbedEditor` carries the
  `read-only` class, which hides the active-line highlight.
- **A parent render can run effects ahead of CodeMirror's.** Preact runs a component's pending
  effects when it renders again before they flush, which once ran `CodeEmbedEditor`'s effects
  before `CodeMirror` created the view: no find target, no `onReady`. Its effects wait for the
  `view` state that `onInitialized` sets; the content loads in a layout effect, so it paints with
  the editor.
- **Box sizes need a title row.** Tiny and Expandable show only the title, so an untitled inline
  embed was invisible at Tiny. `INLINE_BOX_SIZES` (Small, Medium, Full) limits the dropdown, the
  command and the ⋮ menu (`getBoxSizes(domElement)`), and other sizes load as Medium. Give each
  size a height in the component's CSS (`[data-box-size="small"]`, `"full"`) and `100%` under
  `.include-note-content:fullscreen`, and size the wrapper too (`.source-embed`), or fullscreen
  fills only part of the screen.
- **Embeds nest, so scope box rules with `>`.** `.include-note[data-box-size="full"] .x` or
  `.include-note-content:not(:fullscreen) .x` also matches the content of an embed inside that
  box: a nested Medium box took the Full height, and a nested box in fullscreen lost its height.
  Chain the embed's own elements, as `MarkdownEmbed.css` does: `.include-note >
  .include-note-wrapper > .include-note-body > .include-note-content > .rendered-content`.
- **CKEditor hides a toolbar separator that is `:first-child`.** The leading separator of the
  content tools needs an override in `packages/ckeditor5/src/theme/content_embed_tools.css`.
  `CONTENT_EMBED_DISPLAY_MODE_SEPARATOR` separates Editable from the view buttons.
- **Keep the Editable flag and the view separate.** Switching the view never touches `editable`
  (`contentEmbedDisplayMode` command), and a mode left unset resolves from Editable (split while
  editable, preview otherwise).
- **Class clashes.** The read-only in-place drawing is `.rendered-mermaid-diagram`, not
  `.mermaid-diagram`, the root of the embed component; one name matched both stylesheets.
- **Inline embeds have no note**: hide the caption and title commands, and show the ⋮ menu
  (`isSelectedEmbedInline`); `link_context_menu.ts` offers the display modes and the inline sizes.
- **Stacking.** The split editor's error card and overlay controls use `z-index: 10`; the box's
  exit-fullscreen group sits above them (`11`, `style.css`).
- **Shortcut hints** (`useContextualShortcutHints`) do not work inside an embed: its content is a
  standalone Preact root hosted by `appContext`, so leave the hints button out.

## Testing

- Editor plugin: browser-mode specs beside the plugin (`inline_source.spec.ts`,
  `content_embed*.spec.ts`), run with `pnpm --filter @triliumnext/ckeditor5 test <name>`; see the
  `ckeditor5-testing` skill.
- Client: `MermaidDiagram.spec.tsx`, `CanvasDrawing.spec.tsx`, `content_embed_tools.spec.tsx`,
  `editable_embed.spec.tsx`, `SourceEmbed.spec.tsx`, `ReadOnlyText.spec.tsx`,
  `SvgSplitEditor.spec.tsx`. Mount the component in a `figure.include-note` >
  `.include-note-content` to give it an embed; set `data-editable` / `data-display-mode` on the
  figure to drive it; dispatch `enterFullscreen` on the content box for fullscreen.
- `react-zoom-pan-pinch` measures layout happy-dom lacks: mock `TransformWrapper` /
  `TransformComponent` (the mock drops `wrapperClass`, so assert on `.svg-preview-root`).
- Translations do not resolve in client specs: count buttons or use ids rather than `aria-label`
  text. And `expect(x?.querySelector(…)).not.toBeNull()` passes when `x` is `undefined` — assert
  `x` first.

## Documentation

User-facing changes go in `docs/User Guide/User Guide/Note Types/Text/Insert buttons.md` (sections
_Drawing canvas_, _Mermaid diagram_) and `Include Note.md` for the box itself; then
`node .claude/skills/writing-documentation/docs.mjs sync` and `check`.

## Related

- **ckeditor5-plugin-development** / **ckeditor5-testing** — editor plugin conventions and specs.
- **building-client-ui** — `OverlayControlGroup`, `ZoomControls` and the other overlay controls.
- **developing-mermaid-highlighting** — the CodeMirror Mermaid language the source pane uses.
- **developing-share-pages** — the share theme's own rendering of embeds and diagrams.
