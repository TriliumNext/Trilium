---
name: developing-content-embeds
description: >-
  Use when building, changing or reviewing an embed in a text note: an included note, an attachment embed such as a canvas drawing (`CanvasDrawing`), a source embed such as a Mermaid diagram (`MermaidDiagram`, `SOURCE_EMBED_TYPES`), media from a URL (`ContentEmbedMedia`), or a new embed kind or content type. Covers the storage forms and every reader of them, the editor plugin (`packages/ckeditor5/src/plugins/content_embed/`), the host contract (`ContentEmbedHost`, `bindContentEmbedHandlers`), the client box (`ContentEmbed`, `text/utils.ts`), the content component contract (`useEditableEmbed()`, `ContentEmbedToolProvider`, Editable, display modes, fullscreen), the rule that every kind renders in editable text, read-only content, print and share pages, Search in note inside embeds (`FindTarget`, `registerEmbedFindTarget`), caret navigation (`useEmbedCaretNavigation`), the shared undo history, disposal and saves across several views, editors of other notes inside an embed, checklists of every place a new content type, source language, MIME type, model attribute, command, menu item, toolbar item or host method must reach, the spec map and test helpers, hosting a third-party editor, and the traps already hit.
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

## Every kind renders on four surfaces

A kind of embed is not finished until it renders everywhere a text note shows:

| Surface | Entry point | What the embed gets |
|---|---|---|
| Editable text | the host's `contentEmbed.load*()` → `text/utils.ts` → the `ContentEmbed` box | the component, editable while Editable is on |
| Read-only content (a read-only note, AI chat, tool results, the content of a box) | `prepareEmbedBoxes()` (`text/embed_boxes.ts`) | the same box and component, read-only |
| Print, tooltips, list previews | `postProcessRichContent()` → `renderContentEmbeds()` → `getRenderedContent()` without `interactive` | a static rendering, finished when the call returns |
| Share pages and the static HTML export | core `share/content_renderer.ts` (the `.include-note` pass, `renderAttachmentEmbed()`, `setMediaBox()`) and the share theme's scripts and CSS | static HTML, built on the server |

_Read-only paths_ below has the details. When a share page cannot render the content, it offers a
link to download it, provided other applications can open the file: `renderAttachmentEmbed()`
falls back to `api/attachments/<id>/download`. Content with neither a rendering nor such an
application shows the "unavailable" box (`replaceWithUnavailable()`). The download link stands in
only for content no share page can draw, never for a rendering it could do. The checklists in
[references/checklists.md](references/checklists.md) list what each surface needs from a new
content type or language.

## The storage forms

What the text note saves, and what the editor model holds (`contentEmbed` element):

| Form | Saved HTML | Model attributes |
|---|---|---|
| Included note | `<figure class="include-note" data-note-id="…" [data-block="…"]>` | `noteId`, `block` |
| Attachment | `<figure class="include-note" data-attachment-id="…">` | `attachmentId` |
| Inline source | `<pre data-box-size=… [data-display-mode=…] data-hide-title data-editable><code class="language-mermaid">…</code></pre>` | `language`, `source` |
| Media | `<section class="link-embed" data-url=… data-embed-type="youtube" … [data-position=…]>`, or `"video"` or `"audio"` | the link preview fields: `url`, `embedType`, `title`, `image`, … |
| Later kind | `<section data-trilium-embed="<kind>" …>fallback</section>` | `unknownContentEmbed`: `embedAttributes`, `embedContent` |

All three carry `boxSize`, `hideTitle`, `editable`, `displayMode` (`data-box-size`,
`data-hide-title`, `data-editable`, `data-display-mode`) and the resized size as
`--include-note-width` / `--include-note-height` in `style`. The figure keeps an optional
`<figcaption>`.

**Captions of an embed whose element is not a `<figure>`** (`_defineCaptionedEmbedConverters()`
in `content_embed.ts`). While such an embed has a caption, the note saves its element in a
`<figure class="captioned-content-embed">` (`CAPTIONED_CONTENT_EMBED_CLASS`), followed by the
`<figcaption>`, and without a caption it saves the bare element again. Every kind gets this
without code of its own: a `low` data downcast listener wraps whatever element the kind's
converter bound, a data mapper hook puts the caption after that element, and an upcast at
`high` converts the element and turns the `<figcaption>` into the `caption` of the embed
(`isEmbedCaptionToggleable()`), or into text after content that takes none. The figure is bound
to the embed as well, view to model only, so the mapper counts it as one node; the embed still
maps to its element, where the attribute converters (width, position) write. A kind opts in
through `hasCaptionSupport()`; only inline source embeds stay out. Read-only views replace the
figure with the box and move the caption into it (`replaceWithEmbedBox()` in
`content_renderer_text.ts`); share pages move `style`, `data-box-size` and `data-position` from
the element to the figure (`moveBoxToCaptionedFigure()`), which the share CSS places; Markdown
export keeps the figure as raw HTML.

**An embed whose caption has the selection looks selected**, as one whose player or editor has
the focus (which selects it): `markWidgetOfSelection()` (`widget_utils.ts`, shared with the aside)
adds `ck-widget_selected` after `Widget` marks the selection and takes it away on
`cleanSelection`. `Widget` itself marks only widgets inside the selection.

- **Inline source** (`inline_source.ts`, `ContentEmbedInlineSource`) keeps the document readable
  elsewhere: the note exports to Markdown as a fenced `mermaid` block, other apps render it, and
  undo in the note undoes source edits through the shared undo history (see _Undo history_ below).
  `setSource()` writes outside the undo stack and does **not** redraw the embed, which would
  remount its editor. The plugin hands out one `InlineEmbedSource` per embed element, which keys
  its history. It is converted only for languages in
  `contentEmbed.inlineLanguages`, which `buildConfig()` in `text/config.ts` derives from
  `SOURCE_EMBED_TYPES` (`services/source_embeds.ts`); a code block of another language stays a
  code block.
- **Media** (`media_embed.ts`, `ContentEmbedMedia`) is the _Embed_ display mode of a link
  preview that plays something (`getLinkPreviewPlayer()` in commons): a YouTube video
  (`embedType` `youtube`), or the video or audio file at its URL (`video`, `audio`). It keeps the
  saved form of the link preview, so released versions show a YouTube video as a player and a
  file as a card, and adds `data-box-size`, `data-hide-title`, `data-position` and
  `--include-note-width`. A video has Medium and Full, an audio file Small alone
  (`getMediaEmbedBoxSizes()`; the ⋮ menu drops a one-size submenu). `readMediaEmbedBox()` reads a
  YouTube video saved before as Full and untitled, and `createMediaEmbed()` makes a new video
  Medium and untitled at `getVideoMediumWidth()` (20em high), which the box size command sets
  again, and an audio file Small and untitled. Height follows width for a video and the controls
  for audio (`isHeightResizable` is per element). A size change only restyles the figure: the
  `attribute:boxSize` converter skips `reloadEmbeddedContent()` for media, since a new player
  stops the playback. The box carries `media-embed` and `video-embed` or `audio-embed`
  (`getMediaEmbedClasses()`). `LinkEmbed.css` rounds a video file's player and placeholder as
  `.link-embed-video` is, and lifts `--include-note-media-max-height` off its `.video-preview`,
  which would keep the video of a wider player at 20em, at the top. An audio box keeps the Small
  rules of an audio attachment and drops only the 8rem floor of `.rendered-media`.
  A file plays in Trilium's `MediaPreview` with a `MediaSource` from `getExternalMediaSource()`
  (`isExternal`, `poster`): a video waits behind `MediaProxy` and its thumbnail, audio mounts with
  `preload="none"`, and neither reads the waveform or taps the visualizer's analyser, through
  which a cross-origin file without CORS headers plays silent. A file that does not play shows
  `PlaybackError` (`MediaPlayer.tsx`), which puts the HTTP error of the host under the message:
  `fetchHttpStatus()` (`media_source.ts`) asks `api/link-embed/status` (`getHttpStatus()`), which
  reads the status without the body, since a media element reports none. In a video embed the
  error box takes the player's shape (`LinkEmbed.css`). The server tells a file from a
  page in the same fetch: `fetchPage()` reads only the first 64 KB of a media type
  (`prefixLength`) and `probeMedia()` (`services/media_probe.ts`) reads the container header. The
  client falls back on the extension (`getMediaFileTypeOfUrl()`) when the server answers
  unresolved. A video file that `createMediaEmbed()` makes without an `image` gets a thumbnail:
  after the change the plugin calls `contentEmbed.captureVideoThumbnail()` and writes `image`, and
  `aspectRatio` when unset, in the batch that inserted the embed, so one undo removes both.
  `services/media_thumbnail.ts` reads the frame from the host with `crossOrigin`, else through
  the Node-only `api/link-embed/media-proxy` token route, and stores it through
  `api/link-embed/thumbnail`. A caption is saved in the captioned figure (above). The video toolbar also
  shows while the caret is in the caption (`findRelatedMedia()`), and its Copy address (URL) and Display
  act on the video through `ChangeLinkDisplayCommand._getTarget()`: the selected preview, else,
  unless the caret is on a link, the video of the caption (`getCaptionedEmbed()`).
  `getSelectedLinkWidget()` itself reads only the selected element, as the link balloon shares
  the command and Ctrl+K in a caption must edit the caption's own link. `rebuildLinkWidget()`
  copies the caption into a preview that keeps its shape; a Card, Icon & text or Text link has no
  caption, so `keepCaptionText()` moves its content into a paragraph after the video.
  The shape is the link preview field `aspectRatio` (`data-aspect-ratio="9/16"`), which the
  server reads from oEmbed for the video's `/shorts/` address (the watch address of a Short
  answers 16:9). `getVideoAspectRatio()` validates it; every box that draws a player (the
  editing figure, `prepareMediaEmbeds()`, `renderLinkEmbedHtml()`, the share renderer's
  `setMediaBox()`) writes it as `--video-aspect-ratio`, which the player's `aspect-ratio` and the
  70vh cap of Full read. Only Full is capped; Medium keeps its saved width. `setMediaBox()` also
  writes `data-box-size` on the shared section, Full for a video saved before box sizes. A
  preview without one is 16:9. A new link preview field goes into `LINK_PREVIEW_DATA_ATTRIBUTES`
  and `readLinkPreviewData()`, both `LinkEmbedMetadata` types (commons and the editor's
  `augmentation.ts`) and the client's `fetchMetadata()`; `META_KEYS`, the schemas and the
  converters follow the map. It renders through `contentEmbed.loadMedia()` (`loadMediaEmbed()`, whose title row
  opens the embed menu only in the editor) and has a toolbar of its own (`mediaEmbed` in
  `content_embed_toolbar.ts`): Copy address (URL), the link preview's Display dropdown and ⋮. The caption
  is toggled from ⋮ only. Its ⋮ menu
  (`getMediaItems()`, picked by the `url` of `ContentEmbedState`) puts _Open externally_
  (`openUrlExternally()` in `services/open.ts`) above the embed's commands and _Delete_ below.
  Its _Edit..._ (and Ctrl+K on the selected embed) opens the link dialog in its media form
  (`EditLinkOpts.isMedia`, from `LinkAtSelection.isMedia`: address and title only), which applies
  through `insertLinkEmbed`: another address keeps the embed until `getMediaAttributes()` accepts
  the fetched metadata, then `createChangedMediaEmbed()` replaces it, keeping its attributes and
  caption; an address that plays nothing rejects, and `getEditLinkOpts()` shows the error toast.
  A right click on the content opens the same menu at the pointer (`MENU_CONTENT_TYPES` in
  `ContentEmbed.tsx`), with the `.include-note` as the origin's target: `getMenuEmbed()` reads the
  embed only from the title row or the embed element itself. A loaded YouTube frame keeps its
  right clicks; its facade does not.
  `prepareEmbedBoxes()` swaps the section for the same box in read-only content.
  The box has no backdrop (`DIRECT_CONTENT_TYPES`), so one click plays and selects. The
  facade takes the focus on click and `playVideo()` hands it to the player once loaded:
  Chromium blurs the editor when a focused element is removed. A click into a frame fires no
  focus event in the page, so `fireFrameFocusEvents()` in `content_embed.ts` fires `focus` at a
  frame in an embed that a window `blur` leaves focused, and `blur` on the next window `focus`;
  the embed's own `focus` listener and `FocusTracker` do the rest. A click from one frame into
  another fires no window event either, so after a window `blur` one shared interval
  (`watchFrameFocus()`, 200 ms, for every editor's check in `frameFocusChecks`) reads
  `document.activeElement` until no frame has the focus or the window has it back. These
  synthetic events neither bubble nor fire `focusin`/`focusout`, so the box's
  `useFocusWithin()`, which draws the `.include-note-body.active` outline, also listens to
  `focus`/`blur` in the capture phase.
  `createLinkPreview()` in `link_embed_commands.ts` is the one place that picks `linkMention`,
  `linkEmbed` or a media embed for a display mode. The Insert media prompt (`insert_media.ts`)
  inserts the player only once `fetchMetadata()` has returned, with no link meanwhile: its
  `onInsert()` rejects on unresolved metadata or an address that plays nothing, and the host's prompt keeps Insert disabled while
  it waits and shows an error toast when it rejects.
- **Legacy blocks** — a `<pre>` without `data-box-size` predates the embed (the old Mermaid
  plugin). `getModeOfSavedView()` loads it editable, in the view of its
  `data-trilium-display-mode` or split, at Medium. A saved embed keeps exactly what it has.
- **Later kind** (`CONTENT_EMBED_KIND_ATTRIBUTE` in `packages/commons/src/lib/content_embeds.ts`)
  is the form for any new kind that is neither a note/attachment reference nor a code block, so
  that an older version keeps it instead of dropping it on save, without a sync version bump.
  `UnknownContentEmbed` (`unknown_embed.ts`) keeps the section raw through
  `registerRawContentMatcher()`, renders it as an `.include-note` box that the host fills through
  `contentEmbed.loadUnknown()` (`ContentEmbedError`, the box of a missing note, with the
  `bx-error` icon), and writes it back with its `class` and
  `data-*` attributes (anything else, `style` included, is dropped) and its content, sanitized by
  the host's `contentEmbed.sanitizeHtml`. Its upcast runs at `high`, before General HTML Support.
  A new kind must follow the contract older versions rely on:
  - Settings go in `data-*` attributes on the section, never in `style` (the import sanitizer
    keeps `--include-note-*` only on `figure` and `pre`, and `--include-note-width` on
    `section`).
  - A note reference is `data-note-id` on the section itself, which `findIncludeNoteLinks()`
    turns into the `includeNoteLink` backlink.
  - An attachment reference is `data-attachment-id` on any element, an
    `api/attachments/<id>/image` URL in `src`, `data-image` or `data-favicon`, or an
    `attachmentId=` link in `href`: the forms `checkImageAttachments()` keeps from erasure and
    rewrites when the attachment is copied.
  - The content is a static fallback (a link, a picture, the source in a `<pre>`): old read-only
    views, share pages and Markdown export show it.

  Read-only views never show the fallback either: `emptyUnknownEmbeds()`
  (`content_renderer_text.ts`) empties each section into an `.include-note` box, keeping only
  the kind, `data-box-size` and the block ID. `prepareEmbedBoxes()` then mounts the same error
  box (`loadUnknownEmbed()`), in read-only content and in the content of a box, and a static
  rendering leaves the box empty, as it leaves a missing note's. Share pages replace the
  section, and an include of a missing or unshared note or attachment, with
  `<div class="include-note-unavailable">` and a generic message (`replaceWithUnavailable()`
  in core's `share/content_renderer.ts`), as the page is public.

  The version that adds a kind registers its converter above `high`. If that converter needs the
  section's children, narrow `ENVELOPE` in `unknown_embed.ts` to leave the kind out: the raw
  matcher removes the children before any converter runs.
- **Attachment** suits large or binary content and content with its own save cycle (Excalidraw).
  The attachment's content type comes from `getFileContentType()` in
  `packages/commons/src/lib/notes.ts` (`canvasDrawing`, `mermaidDiagram`), which
  `getRenderedContent()` dispatches on.

### Who reads the saved form

A change to a storage form reaches every reader, most of them outside the client:

- **Match `.include-note`, never a tag.** Notes saved before captions keep
  `<section class="include-note">`, and the Obsidian and Notion importers still write it, as the
  Evernote and Markdown importers write a bare `<pre><code class="language-mermaid">`. The editor
  keeps converting both.
- **`data-attachment-id`**: `checkImageAttachments()` and the drawing helpers in core
  `services/notes.ts`, `BAttachment.convertToNote()` (rewrites it to `data-note-id`), zip import
  (`getNewAttachmentId()`), the share renderer (`renderAttachmentEmbed()`), the editor's
  `ReferenceLinkEditing#updateAttachmentLinks()`, and the client's `loadEmbeddedAttachment()`,
  `prepareEmbedBoxes()` and `content_renderer_text.ts`. A section with neither ID is an upload in
  progress, which every reader tolerates.
- **`data-note-id`**: `findIncludeNoteLinks()` turns it into the `includeNoteLink` relation, for
  text notes only. Its pattern needs `class` before `data-note-id`, the order the data downcast
  writes, and zip import remaps included note IDs only through that relation.
- **Markdown export** writes an inline source as a plain fence, without its box size or flags.
- **The server sanitizer** runs on import, with the tags of the user's `allowedHtmlTags` option: a
  tag added to the defaults does not reach existing databases.
- **Names kept on purpose**: every `include-note*` class (stored in notes and a theming surface),
  the `includeNoteLink` relation, the `addIncludeNoteToText` action (its option key),
  `api.refreshIncludedNote`, and the `include_note.*` translation keys. In code the feature is a
  "content embed"; "embed" alone belongs to `link_embed/`, the link previews.

## How a box gets its content

1. **Editor plugin** (`packages/ckeditor5/src/plugins/content_embed/`). `content_embed.ts` owns the
   model, the converters, the commands (`insertContentEmbed`, `contentEmbedBoxSize`,
   `toggleContentEmbedTitle`, `toggleContentEmbedCaption`, `toggleContentEmbedEditable`,
   `contentEmbedDisplayMode`, `contentEmbedPosition`, `setContentEmbedCodeView`,
   `convertLinkToEmbed`, `convertEmbedToLink`, `deleteContentEmbed`), the box-size rules and
   observables such as `isSelectedEmbedInline` and `selectedEmbedTools`. `inline_source.ts` adds
   `insertInlineEmbed` and `extended_code_block.ts` `insertExtendedCodeBlock`.
   `deleteContentEmbed` serves any kind: `getDeleteAndConvertGroup()` in
   `apps/client/src/menus/link_context_menu.ts` ends the ⋮ menu of a note, an attachment, a video
   and an extended code block with it as _Delete block_, with a neutral icon, so it reads apart
   from an attachment's red _Delete attachment..._ that follows it. _Convert to link_ and the
   attachment's _Convert attachment into note..._ come last. Other inline sources (Mermaid) do not
   offer it.
   `content_embed_toolbar.ts` lists the toolbar items; `content_embed_tools.ts` turns the
   content's tools into buttons; `content_embed_box_size_dropdown.ts` and
   `content_embed_position_dropdown.ts` are the size and position menus; `content_embed_caret.ts`
   moves the caret into and out of embeds; `media_embed.ts`, `inline_source.ts`,
   `extended_code_block.ts` and `unknown_embed.ts` are the kinds with converters of their own. The
   editing view renders an `.include-note-wrapper` and asks the **host** to fill it.
2. **Host contract** (`ContentEmbedHost` in `content_embed.ts`, read from the editor config as
   `contentEmbed`, a `Partial`, so the plugin calls each member with `?.`). `EditableText.tsx`
   implements the loaders and actions as `contentEmbedHandlers`: `loadNote()`, `loadAttachment()`,
   `loadInline(source, wrapper, boxSize, { isFocused })`, `flushInline()` (the editor calls it
   before copy, cut and drag), `loadUnknown()`, `loadMedia()`, `focusAttachment()`,
   `getAttachmentHref()`, `openMenu()`, `getTools()` and `enter()`. `CKEditor.tsx` hands them to
   `buildConfig()` through a getter, and `bindContentEmbedHandlers()` in `text/config.ts` forwards
   each one **by name**: a member missing there is never called, and nothing fails.
   `buildConfig()` sets the rest itself: `pickNote()`, `inlineLanguages`,
   `renderInlinePreview()`, `sanitizeHtml()` and `captureVideoThumbnail()`. The plugin never
   imports client code.
3. **Box** (`text/utils.ts`). `loadEmbeddedNote()` and `loadEmbeddedAttachment()` render the
   content with `content_renderer`; `loadInlineEmbed()` loads the source type's component and
   mounts it with `mountInteractiveWidget()` itself. Each wraps the content in `ContentEmbed`
   (`text/ContentEmbed.tsx`: title row, fullscreen, exit-fullscreen overlay) and `mountEmbedBox()`,
   which disposes content that left the page while it loaded. `loadUnknownEmbed()` and
   `loadMediaEmbed()` mount without it, as the editor calls them before the box is in the page.
   `watchContentEmbeds()` disposes boxes removed later.
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
  `getTools()`, `execute(id)`, `subscribe()`. One provider per element: content that registers
  its own passes `tools: null` to `useEditableEmbed()`, or the two replace each other. The
  provider is declared twice, in the client and in `packages/ckeditor5/src/augmentation.ts`
  (without `getMenuItems()`); change both. Its members, besides those three:
  - `hasEditableFlag` — shows the Editable toggle; the embed carries `data-editable="true"`.
  - `hasDisplayModes` — shows Source/Split/Preview; the embed carries `data-display-mode`.
  - `hasPositions` — gives an inline source the Position submenu of the ⋮ menu and the toolbar's
    position dropdown; the embed carries `data-position`. A note, attachment or video embed has
    the submenu without it (`hasEmbedPositions()`), and the dropdown only with it.
  - `hiddenToolbarItems` — moves the box size dropdown, the position dropdown or Editable from
    the toolbar to the ⋮ menu (an extended code block hides all three). Title and Convert to link
    are in the ⋮ menu only. Its union, `ContentEmbedToolbarItem`, is declared in both places too.
  - `hiddenToolbarItemsWhileEditable` — the same, only while the embed's Editable toggle is on
    (`isSelectedEmbedEditable` of `ContentEmbed`, read on `ui#update`). `CanvasTools` hides
    Editable this way: a read-only drawing offers it in the toolbar, an editable one in ⋮ only.
  - `boxSizeIcon` — an SVG the box size dropdown shows in place of the size name, which moves to
    its tooltip (`Box size: %0`). Code and Markdown embeds set it even while read-only
    (`hasEditableFlag: false`), so every one of them shows the icon; code embeds through
    `useContentEmbedMenus()`.
  - `getMenuItems()` — items of the ⋮ menu after Editable, in a group of their own
    (`useContentEmbedMenus(rootRef, menus, menuItems)` passes them through).
  - `toolbarTitle` — the name that the mobile formatting toolbar gives the embed's tools, on its
    `Name ›` button and at the start of their row (`ContextToolbar`, which reads it from
    `selectedEmbedTools` on every `ui#update`). _Embed_ when left out; `CanvasTools` sets
    _Canvas_.
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
- **Reading the embed's state** from the content: `useContentEmbedAttribute(ref, name)`,
  `useContentEmbedFlag(ref, name)` / `getContentEmbedFlag(embed, name)`,
  `useIsContentEmbedEditable(ref)`,
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

## Search in note

_Search in note_ (Ctrl+F) searches the note and the content of its embeds as one document, in
document order. An embed takes part only when its content registers a **find target**; content
without one is skipped, and nothing reports it.

- **The contract** is `FindTarget` (`apps/client/src/widgets/merged_find.ts`). `find(term, options)`
  counts the matches without making one current; `highlight(index | null)` makes match `index`
  current and scrolls to it; `getFirstMatchBelow(top)`; `canReplace(index)`; `replace()` and
  `replaceAll()` return the number of matches left; `close(index)` selects that match and returns
  whether it took the focus; `watchContent?(callback)` serves content that changes.
- **Register** it with `registerEmbedFindTarget(element, target)` (`text/content_embed_tools.ts`)
  in an effect, and call the returned function on cleanup. Of the targets inside one embed, the
  innermost wins, so an editor that replaces the preview searches instead of it. Unregister while
  the content is hidden, not only on unmount: `CodeEmbedEditor` registers only while `isShown` and
  calls `cleanSearch()` as it goes, so a Markdown embed in Preview searches its preview.
- **Reuse an engine** before writing one:
  - `HtmlFindTarget` (`find_in_html.ts`) over rendered HTML. `ContentEmbed` registers
    `MergedFind(new HtmlNoteFindTarget(content))` on the preview of each type in
    `SEARCHABLE_CONTENT_TYPES`, so the boxes nested in a preview search, and open, themselves.
  - `CodeMirrorFindTarget` (`find_in_code.ts`) over a CodeMirror view.
  - `MergedFind(new TextEditorFindTarget(editor))` (`find_in_text.ts`) over a text editor and its
    own embeds, as `useEditorFindTarget()` in `TextEmbedEditor.tsx` registers it.
  - `DrawingFindTarget` (`canvas/drawing_find.tsx`) is the example for content outside the DOM: it
    matches the scene's text elements, draws the matches through Excalidraw (or an SVG overlay on
    the picture), pans to a match out of view and restores the view after.
- **Each target removes only its own highlights.** The note and its embeds share one root, so
  `HtmlFindTarget` removes its own ranges, never every highlight in the container.
- **Reveal hidden content.** `MergedFind` calls `revealContentEmbed(embed, true)` before a match in
  the embed becomes current, and `false` after. `ContentEmbed` follows it with
  `useContentEmbedFindReveal()`, which opens a collapsed Expandable box inside `flushSync()` so the
  box shows before the target scrolls. Around the embed, the host's `revealEmbed()` calls
  `FindReveal.show()` (`packages/ckeditor5/src/plugins/find_reveal.ts`), which collapsible blocks,
  collapsed list items and tabs follow. A reveal changes the view only, never the model, or
  searching would save the note.
- **Read-only content** answers `canReplace()` with `false`: _Replace_ is then disabled on its
  match, and _Replace all_ skips it.
- **Ctrl+F inside the content** does not reach the binding that opens the find bar, as the embed
  keeps its keys from the window. Content that takes the focus calls `useFindShortcut(rootRef)`
  (`react/hooks.tsx`), as `CanvasDrawing` does.

## Caret navigation

The arrow keys move the caret from the text into the editor of an embed and out again, as through
any other block. An editor takes part by opting in; without it, the caret steps over the embed.

- **The editor** implements `EmbeddedCaretEditor` (`text/editable_embed.tsx`): `focusAt(edge)`
  puts the caret at the start or end of its content; `getEdgeLeftBy(event)` returns the edge an
  arrow key leaves by, or `null` while the caret stays or a list of the editor (its completions)
  takes the key; `prepareToLeave?()` runs before it leaves. `CodeMirror` (`packages/codemirror`)
  and the `ContentEmbedCaret` plugin of a nested text editor implement it.
- **Wire it** with `useEmbedCaretNavigation(() => editor)` inside the content and
  `hasCaretNavigation` on its `EditableEmbedContent`. The hook handles the arrow keys in the
  capture phase and registers the content with `registerEmbedCaretTarget()`; the host's `enter()`
  reaches it through `enterContentEmbed()`.
- **The host** is the `ContentEmbedCaret` plugin (`content_embed_caret.ts`): `getEmbedAhead()`
  finds the embed beside or below the caret, and `leaveEmbed()` puts the caret back after it (in
  the next text, in the caption going forward, else on the widget's fake caret). The caret lands
  at the start or end of the content, never at a goal column; a collapsed Expandable embed is
  stepped over.
- **A host key handler** in the capture phase on the editable root also receives the keys typed in
  a nested editor. `addEditingKeydownCapture()` in
  `packages/ckeditor5/src/plugins/move_block_updown.ts` filters them with `isFromEditable()`; use
  it for any new one.

## Disposal, saves and several views

- **Dispose what you mount.** `mountInteractiveWidget(vnode, container)`
  (`services/content_renderer.ts`) mounts a component bridged to `appContext`, so its events and
  `[data-trigger-command]` work, and marks the container `data-interactive-mount`;
  `disposeInteractiveContent()` unmounts every such root. A caller that replaces or drops
  interactive content calls it, or the roots leak (subscriptions, maps, playing audio). A bare
  Preact `render()` is neither bridged nor disposed. `addContentDisposer(element, dispose)` adds
  cleanup of other kinds, and `snapshotAndDispose()` serves callers that keep only the HTML.
  `ContentEmbed` disposes and removes its `content` element as it unmounts, so the element is
  never reused.
- **A preview holds live boxes.** The content of a box renders before it joins the page, and
  the boxes in it mount there (`isNested`, which skips the left-the-page check of
  `mountEmbedBox()`), so `postProcessRichContent()` fills them after its other passes, which
  would otherwise reach into them. `EmbedPreview` disposes of the element it shows once it shows
  another or unmounts, `useEmbedPreview()` disposes of a render that is late, and
  `EditableEmbedContent` hides the preview while the editor shows rather than unmounting it, as
  a remount would show the disposed boxes. A key shown before renders again, as its preview
  is disposed.
- **Tiny never renders its target.** The box shows only the title (`TinyContentEmbed`), and
  `resolveContentEmbed()` (commons `content_embeds.ts`) makes it a link on print and share pages.
  A new render path checks `data-box-size="tiny"` before calling `getRenderedContent()`.
- **Box sizes cap the height only.** Content with no height of its own (an iframe, a view that
  scrolls itself, absolutely positioned children) needs a height per box size. A `height: 100%`
  chain below `.include-note-content` resolves to `auto` and collapses: give the wrapper a
  `min-height` instead.
- **A save of your own must not remount you.** Saves carry the `componentId` of their editor,
  uploads from the editor too, and readers skip their own:
  `loadResults.getAttachmentRows(componentId)`.
- **Content that follows its own saves** is in `SELF_UPDATING_TYPES`, and `showsAttachmentSave()`
  (`text/utils.ts`) lets the host skip its redraw on a save that changes only the content. A
  rename, a deletion or a static kind (image, PDF) still redraws.
- **Hidden views** (a background tab, a collapsed box) apply changes once shown, through
  `useWhenShown(ref)` (`react/hooks.tsx`). Only the last waiting callback runs, so check a request
  ID before queuing, not after.
- **Pace the saves** of content that changes continuously: `postponeSave()` on the
  `ContentEditor` holds the scheduled save while input goes on.

## An editor of another note in an embed

An included text note is edited in place by a real `EditableText` (`TextEmbed.tsx` and the lazy
`TextEmbedEditor.tsx`). What makes that work, and what any nested editor of a note needs:

- **A note context of its own**: `useEmbeddedNoteContext(note, prefix, { floatingToolbar,
  skipRecentNotes })` (`widgets/EmbeddedNotePane.tsx`), whose component hangs off the host's so
  that app events reach it.
- **Its own events.** CKEditor ignores events from inside `[data-cke-ignore-events]`, which the
  embed's wrapper carries, so a nested editor ignored its own typing. `nested_editor_events.ts`
  patches `Observer` so that only a marker inside the observer's own root counts.
- **The toolbar**: `useNestedEditor(ntxId)` hands the formatting toolbars to the nested editor
  while it has the focus, and `hasFixedToolbarAround()` makes it follow the host's toolbar mode.
- **The save status** goes into the embed's title row through `useEmbedBadgeSlot(rootRef)`.
- **The last save** of an editor that closes is tracked by `trackClosingSave()` (`TextEmbed.tsx`);
  the next editor of the note waits for it, then loads what it stored.
- **Note-level actions** (the note menu, recent notes) act on the host note only, never on the
  embedded one.
- **Context menus**: `getTextEditorAtSelection()` returns `null` inside embed content, where the
  host's model selection is the whole embed; `getTextEditorContaining()` returns the host's editor
  on purpose, for the link menu, table sections and block references. Both are in
  `menus/text_editor_context_menu.ts`.
- **One level only**: embeds inside the nested editor stay read-only (`NestedEmbedContext`).

## Recipe: a new source embed (a diagram language)

1. Add a `SourceEmbedType` to `SOURCE_EMBED_TYPES` in `apps/client/src/services/source_embeds.ts`:
   `language`, `mime` (a `*_ATTACHMENT_MIME` in `packages/commons/src/lib/notes.ts`), `contentType`,
   `load()` (lazy import of the component), `renderPreview()` (static rendering, used by the AI
   assistant's inline previews through `contentEmbed.renderInlinePreview`).
2. Map the MIME to the content type in `getFileContentType()` and give it an icon in the
   attachment icon map next to it; then work through _A new content type_ in
   [references/checklists.md](references/checklists.md), which reaches further than this step
   suggests (`CONTENT_RENDERER_GROUPS`, `PREVIEWED_TYPES`, the box sets, the CSS type lists).
3. Write the component on the note type's parts (see the rule above). For a split source/preview
   view, `SplitLayout` + `useMountedPanes()` + `EmbedSourcePane` (in `code/CodeEmbedEditor.tsx`)
   give the layout, the divider, the error card, the stale badge and a source pane that stays
   mounted behind the preview and shares the note's undo history. Delay re-rendering with `useDebouncedValue()`. Give the root
   the `include-note-box-height` class for the 10/20/50em heights per box size and full height in
   fullscreen, and round it with `--_include-note-content-*-radius` (edge to edge) or
   `--_include-note-framed-*-radius` (inside the 2px frame), all in `style.css`. Content that
   draws the frame as padding of the content box sets `--_include-note-frame-height` there
   (`MermaidDiagram.css`), which `.include-note-box-height` subtracts.
4. An insert command: `INSERT_INLINE_EMBED_COMMAND` with `{ language, source }` (see
   `mermaid_ui.ts` and `slash_commands.ts`). New embeds are editable, untitled and Medium.
5. The other three surfaces. `prepareSourceEmbeds()` in `text/embed_boxes.ts` picks up any language of
   `SOURCE_EMBED_TYPES`, but print, the Markdown preview, share pages and Markdown import match
   `language-mermaid` by name and show a new language as a plain code block: give each a branch
   (_A new source language_ in [references/checklists.md](references/checklists.md)).

## Recipe: a new attachment embed with its own editor (like canvas)

1. A MIME constant and content type (`getFileContentType()`), a `CONTENT_RENDERERS.file` entry and a
   `render…()` branch in `getRenderedContent()` that mounts the component when interactive and
   renders a static picture otherwise.
2. Insert by uploading an empty file as an embed (`insertDrawingCanvas()` in
   `file_upload/file_upload_ui.ts`: `fileUpload` with `asEmbed`, `boxSize`, `hideTitle`,
   `editable`, `focusEmbed`).
3. Persistence through the `ContentEditor` (`useAttachmentEditor()` in `text/attachment_saves.ts`
   and `bindAttachmentEditor()` in `services/content_renderer.ts` batch and retry the saves, and
   flush them before leaving). If other
   places need a picture without loading the editor (share pages, previews), save one as an image
   attachment beside the content, as `persistence.ts` does under `getDrawingPictureTitle()`.
4. An attachment detail view reusing the same editor (`CanvasDrawingDetail` in `Attachment.tsx`).
5. Share pages render on the server (`renderAttachmentEmbed()` in
   `packages/trilium-core/src/share/content_renderer.ts`): add a branch there. Without one the
   embed falls back to a download link, which meets the rule only for content no share page can
   draw.
6. The MIME type in core (`STRING_MIME_TYPES`, `EXTENSION_TO_MIME`) and the rest of _A new content
   type_ in [references/checklists.md](references/checklists.md).

## Read-only paths

| Where | Path | What an embed gets |
|---|---|---|
| Read-only note, AI chat replies, tool results | `ReadOnlyTextContent` (`text/ReadOnlyText.tsx`) → `prepareEmbedBoxes()` (`text/embed_boxes.ts`) | `loadEmbedded*()`, and `loadInlineEmbed()` (`text/utils.ts`) with a fixed read-only source. Same box and component as the editor. |
| The content of an embed box (an included text or Markdown note, a Markdown file) | `loadEmbedded*()` renders it with `embedBoxes` → `postProcessRichContent()` → `prepareEmbedBoxes(…, isNested)` | The same read-only boxes, at every depth. An embed of a note or attachment in `seenNoteIds` (the notes shown around it, and the host note) becomes a reference link, which ends a cycle. A Markdown preview passes `isChanging` and draws its diagrams in place. |
| Markdown note preview, a chat reply while streaming | `ReadOnlyTextContent` with `isChanging` | Diagrams drawn in place (`rewriteMermaidDiagramsInContainer()` + `applyInlineMermaid()`), which keep the last drawing while the next renders; a box would remount on every update. |
| Print (`glob.device === "print"`), included notes, previews | `postProcessRichContent()` in `services/content_renderer_text.ts` | Drawn in place; printing snapshots before a box would draw. |
| Share pages | core `share/content_renderer.ts`, share theme `content/mermaid.ts` | Static: an image attachment or the drawing's saved picture as `<img>`, any other attachment as a download link; included notes through the share page's renderer of their type; Mermaid drawn over its code block; media through `setMediaBox()`. No box. |

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
- **Toggling Editable keeps the size of the box**, at every box size but Full. Measure both
  modes in a browser (happy-dom has no layout), and sample every frame of the switch, not only
  the result: four causes were found so far.
  - An editor that loads its content after it mounts (`TextEmbedEditor`) collapses a box sized
    by its content until then. `EditableEmbedContent` keeps the preview in place and loads the
    editor out of sight until the editor calls `EmbedEditorShownContext` (`EditableText`'s
    `onContentShown`), the way `CanvasDrawing` keeps the picture until Excalidraw draws.
  - A frame drawn as padding adds to a root of the box height unless it sets
    `--_include-note-frame-height` (above); a resized content box also needs `height: auto`
    then, or it keeps the resized height and adds the frame.
  - Content whose preview fits its text and whose editor takes the box height (Markdown) gives
    the content box itself the box height while it can be edited, in both modes: the
    `fills-box` rules in `MarkdownEmbed.css`, the way a resized box behaves.
  - The editor themes give the last block of an editable root a bottom margin the preview does
    not have; `style.css` zeroes the last block of `.ck-content` in an embed for both. CKEditor
    still adds room above a leading widget for its selection handle, on purpose.
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
- **Content tools reach the editor only through `editor.ui#update`.** Tools change no model, so
  the plugin reads them on `ui#update` at `high` priority, before the toolbar is measured, and the
  client calls `editor.ui.update()` when a provider changes. An observable a toolbar item binds to
  is `set()` in the plugin's constructor.
- **After any `await` on the host, check again** that the editor is alive and the element is not
  in the `$graveyard` before writing to the model.
- **Never list `attributes` on the embed's `elementToElement` editing converter.** CKEditor then
  reconverts the whole embed on every child change, so each caption toggle reloaded the content
  twice. Attribute changes redraw the wrapper through `attribute:<name>:contentEmbed` listeners,
  and `shownContents` skips a redraw when nothing it shows changed.
- **Replacing a figure with a figure renders it twice.** CKEditor diffs a removed and an inserted
  element of the same tag as an update and renders the new one once just to compare, which runs
  the host's load (and mounts a component) for nothing. Insert the new figure in one
  `model.change()` and remove the old one in `model.enqueueChange(batch, …)`: two renders, one
  undo step (`image_to_drawing.ts`).
- **`t()` takes a literal string**, and its English entry goes under `text-editor.ck.<slug>`;
  `apps/client/src/services/i18n.spec.ts` fails otherwise.

## Testing

The command and specs for each layer, the coverage gates, the shared helpers and fakes, and the
setup specs need: [references/testing.md](references/testing.md). In short:

- Editor plugin: browser-mode specs beside the plugin, `pnpm --filter @triliumnext/ckeditor5 test
  content_embed`, at a 99.5% coverage gate; see the `ckeditor5-testing` skill.
- Client: happy-dom specs beside each component, with shared helpers in
  `apps/client/src/test/content_embed.ts`. Mount the component in a `figure.include-note` >
  `.include-note-content` to give it an embed; set `data-editable` / `data-display-mode` on the
  figure to drive it; dispatch `enterFullscreen` on the content box for fullscreen.
- Core (the share renderer, link scanning, import and export): run under both the server and the
  standalone runner. The share renderer has a 100% coverage gate.
- No end-to-end test covers embeds.

## Documentation

A user-facing change is documented in the same change. Where each part lives, under
`docs/User Guide/User Guide/`:
- `Note Types/Text/Include Note.md`: the box (sizes, resizing, positioning, caption, title),
  missing content, share pages, editing in place, included Markdown, drawing canvases.
- `Note Types/Text/Insert buttons.md`: _Extended code block_, _Drawing canvas_, _Mermaid diagram_,
  _Audio/video embed_.
- `Note Types/Text/Link Previews.md`: _Audio and video_.
- `Basic Concepts and Features/Notes/Attachments.md`: _Embedding an attachment_, drawing pictures.
- `Note Types/Text/Developer-specific formatting/Code blocks.md`: extended code blocks.
- `Basic Concepts and Features/Navigation/Search in note.md`: _Included notes_.
- Also `Mermaid Diagrams.md`, `Canvas.md`, `Block references.md`, `Advanced Usage/Sharing.md` and
  `Note Types/Markdown.md` (includes in Markdown notes).

`node .claude/skills/writing-documentation/docs.mjs impact --diff` lists the pages a change
touches; then `docs.mjs sync` and `check`.

## References

| File | Read it when |
|---|---|
| [references/checklists.md](references/checklists.md) | adding a content type, a source language, a MIME type, a model attribute, a command, a ⋮ menu item, a toolbar item, a host method, an embed kind or a link preview field |
| [references/testing.md](references/testing.md) | writing or running specs: the command per layer, coverage gates, helpers, fakes and setup |
| [references/hosting-an-editor.md](references/hosting-an-editor.md) | embedding a third-party editor (Excalidraw is the example), or deciding when to mount an editor at all |

## Related

- **ckeditor5-plugin-development** / **ckeditor5-testing**: editor plugin conventions and specs.
- **building-client-ui**: `OverlayControlGroup`, `ZoomControls` and the other overlay controls.
- **developing-mermaid-highlighting**: the CodeMirror Mermaid language the source pane uses.
- **developing-share-pages**: the share theme's own rendering of embeds and diagrams.
- **patching-excalidraw**: changes inside Excalidraw, which the drawing canvas relies on.
- **writing-documentation**: `docs.mjs` and the User Guide house style.
