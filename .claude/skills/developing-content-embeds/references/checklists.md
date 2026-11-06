# Checklists

Every place a kind of change has to reach. The lists are where most of the time goes: adding a
content type touches about twenty-five places in four packages, and a missed one fails silently
(a Tiny box, a binary blob, a download link on share pages). No line numbers here, as these files
move fast: jump with `grep -n "<identifier>" <file>`.

Before calling any of it done, check the four surfaces of the main skill: editable text, read-only
content, print and share pages.

## A new content type

A content type is what `getRenderedContent()` dispatches on (`getRenderingType()`), and what the
box writes on its content as `type-<contentType>`. Every list below keys on it.

**Commons** (`packages/commons/src/lib/notes.ts`):
- `getFileContentType()`: the MIME type of an attachment or a file note → the content type.
- `FILE_MIME_MAPPINGS`: its icon.
- `getAttachedFileMime()`: the file extension → the MIME type on upload. Browsers send some files
  with no type (`.excalidraw`), which then store as binary.
- `CONTENT_RENDERER_GROUPS`: its lazy renderer group. It must match `CONTENT_RENDERERS`, which
  `content_renderer.spec.ts` checks; the static share export reads it too.

**Client renderer** (`apps/client/src/services/content_renderer.ts`):
- A `CONTENT_RENDERERS` entry. Keep the object a literal with inline `import()` calls:
  `apps/client/vite-plugins.mts` parses it to build the share-theme manifest. Mock the new module
  in `content_renderer.spec.ts`, which mocks every lazy component.
- A branch in `getRenderedContent()`, before the generic image and file branches, which would take
  the content first.
- `PREVIEWED_TYPES`: without it, `getEmbedBoxSize()` and `getUploadBoxSize()` fall back to Tiny, and
  the attachment detail shows a text preview.
- `getBoxSize()`: the default box size.
- `SELF_UPDATING_TYPES`: the content follows its own saves, so the host skips its redraw.
- `EDITABLE_NOTE_TYPES`: the note types that get a `NoteEditor`.
- `getContentType()` (the attachment role), and `ATTACHED_CODE_MIME_TYPES` /
  `MAX_ATTACHED_CODE_SIZE` for code files.

**The box** (`apps/client/src/widgets/type_widgets/text/ContentEmbed.tsx`):
- `SEARCHABLE_CONTENT_TYPES`: Search in note searches the preview with an `HtmlFindTarget`.
- `DIRECT_CONTENT_TYPES`: no backdrop; the first click goes to the content.
- `OWN_FULLSCREEN_CONTENT_TYPES`: no fullscreen button on the box.
- `MENU_CONTENT_TYPES`: a right click on the content opens the ⋮ menu.

**Stylesheet** (`apps/client/src/stylesheets/style.css`), the `.include-note-content.type-*` lists:
content-box sizing, edge to edge (`padding: 0`), and a height per box size for content with no
height of its own (`type-pdf`, `type-webView`).

**Elsewhere in the client:**
- Insert buttons: three lists in `text/toolbar.ts` (mobile, classic, floating).
- `rendersItself` in `type_widgets/Attachment.tsx` (the attachment detail).
- `insertsAsImage` in `widgets/dialogs/content_embed.tsx`.
- `openContentEmbedMenu()` in `text/utils.ts` routes `data-language` and `.media-embed` embeds to
  `openEmbedContextMenu()`; `MEDIA_TITLE_ICONS` beside it.

**Core**, for a new MIME type:
- `STRING_MIME_TYPES` (`packages/trilium-core/src/services/utils/index.ts`) for a MIME type that is
  not `text/*`. Without it the blob is stored as binary and the blob API returns `content: null`.
- `EXTENSION_TO_MIME` (`services/import/mime.ts`).
- Content that comes with other attachments, as a drawing comes with its `<id>.svg` picture and its
  images: `collectDrawingImageTitles()`, `copyDrawingImages()` and `getPortableContent()` (downloads
  and `convertToNote()`) in `services/notes.ts`; the picture invalidation of `updateAttachment` in
  `routes/api/files.ts`; `getAttachmentTitle()` in zip import; client `attachment_groups.ts`.
- Share pages: a branch in `renderAttachmentEmbed()` (`share/content_renderer.ts`). Without one the
  embed is a download link, which is right only for content a share page cannot render.

## A new source language (a diagram)

- `SOURCE_EMBED_TYPES` (`apps/client/src/services/source_embeds.ts`): `language`, `mime`,
  `contentType`, `load()`, `renderPreview()`. Any other inline language becomes an extended code
  block (`getInlineEmbedType()`).
- Derived from it: the editor's `inlineLanguages` and `renderInlinePreview` (`buildConfig()` in
  `text/config.ts`), `isSelfUpdatingType()`, and `applySourceEmbeds()` in `ReadOnlyText.tsx`.
- Not derived: the content type lists above, and the paths that match `language-mermaid` by name.
  A new language shows as a plain code block in each until it gets its own branch:
  - `rewriteMermaidDiagramsInContainer()` / `applyInlineMermaid()` (`content_renderer_text.ts`):
    print, the Markdown preview, chat replies while they stream, and `ReadOnlyText` without boxes.
  - The share renderer, which highlights every code block but Mermaid (`share/content_renderer.ts`).
  - The share theme, `packages/share-theme/src/content/mermaid.ts`, which draws only Mermaid.
  - Markdown import: `markdown_renderer.ts` keeps only `mermaid` as a fence language and turns
    another unknown one into auto-detect. Export maps languages through `rewriteLanguageTag()`
    (`services/export/markdown.ts`).
- `applySourceEmbeds()` sets the default size (code Full, else Medium), allows only Small, Medium
  and Full, forces `hideTitle`, and copies only the `data-*` attributes it lists. A new attribute
  goes there, in `getEmbedCodeView()` (`content_renderer_text.ts`) and in `CODE_VIEW_ATTRIBUTES`
  (`apps/client/src/test/content_embed.ts`).

## Editor side

All in `packages/ckeditor5/src/plugins/content_embed/` unless named otherwise.

**A model attribute** of `contentEmbed`: the schema, the upcast, the data downcast and the editing
figure in `content_embed.ts`, plus the converters of the kinds that convert themselves
(`inline_source.ts`, `media_embed.ts`). An attribute in `markedAttributes` updates its `data-*`
value on the figure; any other redraws the content. `FLAG_ATTRIBUTES` exists twice, in
`content_embed.ts` and `inline_source.ts`. A media embed writes `hideTitle` itself and never saves
`editable`.

**A command:** the name constant at the top of `content_embed.ts`, `editor.commands.add()` in the
editing plugin, and the `CommandsMap` augmentation (which types only some of the commands). Every
command acts on `getSelectedContentEmbed()`. The ⋮ menu runs commands through `runEmbedCommand()`
(`apps/client/src/menus/link_context_menu.ts`), which selects the embed with `selectEmbedAt()`, a
change outside the undo stack, then executes. A command whose state depends on the content's tools
refreshes on `editor.ui#update` at `high` priority.

**A ⋮ menu item:** a field of `ContentEmbedState`, filled in `getEmbedStateAt()`, rendered in
`getEmbedItems()` (`link_context_menu.ts`). Media and source embeds have their own lists,
`getMediaItems()` and `getSourceItems()`, picked by `state.url`. The last group comes from
`getDeleteAndConvertGroup()`.

**A toolbar item:** a factory in `ContentEmbedUI`, and its name in the `contentEmbed` (or
`mediaEmbed`) toolbar in `content_embed_toolbar.ts`. A new plugin also goes in
`ContentEmbedToolbar.requires` and in `packages/ckeditor5/src/plugins.ts`. When content can hide
it, extend `ContentEmbedToolbarItem` in both `packages/ckeditor5/src/augmentation.ts` and the
client's `text/content_embed_tools.ts`, and bind its visibility with `isToolbarItemHidden()`.

**A host method** (`ContentEmbedHost` in `content_embed.ts`). The config is `Partial`, so the
plugin calls every member with `?.`. Then either:
- the hosting component implements it: `bindContentEmbedHandlers()` in `text/config.ts` forwards
  each member by name, so a member left out of it is never called, without an error; implement it
  in `contentEmbedHandlers` of `EditableText.tsx`, and in the fixture of `config.spec.ts`; or
- the config sets it: in `buildConfig()`, and in the `Omit` of `ContentEmbedHandlers`.

Export any new type from `packages/ckeditor5/src/index.ts`.

**An embed kind.** Every kind is the one `contentEmbed` element, told apart by an attribute:
`language` for inline source, `url` for media. Copy `media_embed.ts`:
- an upcast at `high` that consumes the element, `safeInsert()`s the embed and calls
  `updateConversionResult()`;
- a data downcast of `insert:contentEmbed` at `high` that consumes `insert` and calls
  `mapper.bindElements()`, which `ResizableWidgets` and the `low` captioned-figure wrapper need;
- registration in `ContentEmbed.requires`.

Then review the per-kind checks:
`grep -n "isInlineSourceEmbed(\|isMediaEmbed(\|isExtendedCodeBlock(" content_embed.ts content_embed_toolbar.ts`.
A kind saved in a form that older versions do not know follows the _Later kind_ contract of the
main skill.

## A new link preview field

Besides `LINK_PREVIEW_DATA_ATTRIBUTES`, `readLinkPreviewData()`, both `LinkEmbedMetadata` types and
`fetchMetadata()` (main skill):
- Search: `LINK_PREVIEW_ATTRIBUTES` (`search/expressions/note_content_fulltext_preprocessor.ts`)
  and the snippet pattern in `search/services/search.ts`.
- A picture URL field: the rewriters in `checkImageAttachments()` (`services/notes.ts`), zip export
  and import, single export and `image_download.ts`.
- Three producers write the markup by hand rather than from `LINK_PREVIEW_DATA_ATTRIBUTES`:
  `renderLinkPreview()` in `apps/server/src/routes/api/clipper.ts`, the Anytype importer
  (`import/anytype/content.ts`) and the Notion importer (`import/notion/converter.ts`).
- A new media `data-embed-type`: the share theme's `content/content.css` lists them.

## Files that change together

From the history of the embed code:
- A change to the host contract or the tool provider: `augmentation.ts` and `EditableText.tsx`
  almost always, then `content_embed.ts`, `packages/ckeditor5/src/index.ts`, the client's
  `text/content_embed_tools.ts`, `text/config.ts` and `link_context_menu.ts`.
- A user-facing change: `Include Note.md` most often, then `Attachments.md` and `Link Previews.md`,
  each followed by its generated help page (`docs.mjs sync`).
