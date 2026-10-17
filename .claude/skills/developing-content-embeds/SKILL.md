---
name: developing-content-embeds
description: Use when building or changing an embed box in a text note — an included note, an attachment embed such as a canvas drawing (`CanvasDrawing`), or a source embed such as a Mermaid diagram (`MermaidDiagram`, `SOURCE_EMBED_TYPES`) — or adding a new kind of embed (a diagram language, an editor kept in an attachment). Covers the three storage forms (`data-note-id`, `data-attachment-id`, inline `<pre><code class="language-…">`), the editor plugin (`packages/ckeditor5/src/plugins/content_embed/`: `content_embed.ts`, `inline_source.ts`, the toolbar, tools and box-size dropdown), the host contract (`loadEmbeddedAttachment()`, `loadInlineEmbed()`), the client box (`ContentEmbed`, `text/utils.ts`), the content component contract (`useEditableEmbed()`, `ContentEmbedToolProvider`, Editable flag, display modes, fullscreen events), how to reuse the note type's own component as canvas and Mermaid do, the read-only paths (read-only notes, AI chat, Markdown preview, print, share pages), and the traps already hit (content rendered detached, CodeMirror read-only fixed at creation, the CKEditor separator `:first-child` rule, box sizes without a title, class clashes).
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
  undo in the note undoes source edits (`setSource()` is one step of the editor's undo and does
  **not** redraw the embed, which would remount its editor). It is converted only for languages in
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
2. **Host contract** (`packages/ckeditor5/src/augmentation.ts`, implemented in
   `apps/client/src/widgets/type_widgets/text/EditableText.tsx`): `loadEmbeddedNote()`,
   `loadEmbeddedAttachment()`, `loadInlineEmbed(source, $el, boxSize, { isFocused })`,
   `focusContentEmbed()`, `openContentEmbedMenu()`. The plugin never imports client code.
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
  - `hiddenToolbarItems` — moves box size, title or convert-to-link from the toolbar to the ⋮ menu.
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

## Recipe: a new source embed (a diagram language)

1. Add a `SourceEmbedType` to `SOURCE_EMBED_TYPES` in `apps/client/src/services/source_embeds.ts`:
   `language`, `mime` (a `*_ATTACHMENT_MIME` in `packages/commons/src/lib/notes.ts`), `contentType`,
   `load()` (lazy import of the component), `renderPreview()` (static rendering, used by the AI
   assistant's inline previews through `contentEmbed.renderInlinePreview`).
2. Map the MIME to the content type in `getFileContentType()` and give it an icon in the
   attachment icon map next to it; add the content type to the list in `content_renderer.ts`.
3. Write the component on the note type's parts (see the rule above). For a split source/preview
   view, `SplitLayout` + `useMountedPanes()` + `CodeEmbedEditor` give the layout, the divider, the
   error card and the stale badge for free.
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
| Read-only note, AI chat replies, tool results | `ReadOnlyTextContent` (`text/ReadOnlyText.tsx`) | `applyContentEmbeds()` → `loadEmbedded*()`; `applySourceEmbeds()` → `loadInlineEmbed()` with a fixed read-only source. Same box and component as the editor. |
| Markdown note preview, a chat reply while streaming | `ReadOnlyTextContent` with `isChanging` | Diagrams drawn in place (`rewriteMermaidDiagramsInContainer()` + `applyInlineMermaid()`), which keep the last drawing while the next renders; a box would remount on every update. |
| Print (`glob.device === "print"`), included notes, previews | `postProcessRichContent()` in `services/content_renderer_text.ts` | Drawn in place; printing snapshots before a box would draw. |
| Share pages | server `share/content_renderer.ts`, share theme `content/mermaid.ts` | Static: the drawing's picture as `<img>`, Mermaid drawn over its code block. No box. |

`isChanging` flips when a chat reply finishes: `RawHtmlBlock` is keyed on the choice, because the
in-place drawings replaced the code blocks the boxes need.

## Traps already hit

- **Content renders detached.** `loadInlineEmbed()` renders into a detached `div` before the box
  mounts it, so a hook that looks up `.closest(".include-note")` once finds nothing. Use the
  helpers (`useEmbedState()` / `whenInPage()` inside `content_embed_tools.ts`) that wait for the
  element to join the page. `registerContentEmbedTools()` likewise notifies the toolbar only once
  the content is in the page — otherwise an embed auto-selected on load shows the toolbar of an
  included note.
- **CodeMirror's `readOnly` is fixed at creation.** Remount the editor when editability changes
  (`key={isEditing ? "editing" : "read-only"}` on `CodeEmbedEditor`). Test with
  `EditorView.state.readOnly`, not `contenteditable`, which CodeMirror leaves `true`.
- **Box sizes need a title row.** Tiny and Expandable show only the title, so an untitled inline
  embed was invisible at Tiny. `INLINE_BOX_SIZES` (Small, Medium, Full) limits the dropdown, the
  command and the ⋮ menu (`getBoxSizes(domElement)`), and other sizes load as Medium. Give each
  size a height in the component's CSS (`[data-box-size="small"]`, `"full"`) and `100%` under
  `.include-note-content:fullscreen`, and size the wrapper too (`.source-embed`), or fullscreen
  fills only part of the screen.
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
