# Testing content embeds

Which specs cover which layer, the command for each, and the setup and fakes they share. Run the
narrowest suite that covers the change; core specs run twice, under the server and the standalone
runner.

## Specs and commands

| Layer | Command | Specs |
|---|---|---|
| Editor plugin | `pnpm --filter @triliumnext/ckeditor5 test content_embed` | `content_embed*.spec.ts`, `inline_source`, `media_embed`, `unknown_embed`, `extended_code_block`, `embed_history`, `nested_editor_events` |
| Client box and content | `pnpm --filter @triliumnext/client test <pattern>` | `text/`: `ContentEmbed`, `utils`, `editable_embed`, `content_embed_tools`, `content_embed_menus`, `SourceEmbed`, `TextEmbed`, `ReadOnlyText`, `config`, `attachment_saves`, `embed_history`; `code/CodeEmbed`, `markdown/MarkdownEmbed`, `mermaid/MermaidDiagram`, `helpers/SvgSplitEditor`, `canvas/CanvasDrawing`, `CanvasEmbedTools`, `drawing_find`, `excalidraw_contract` |
| Client renderer, menus, find | same | `services/content_renderer`, `content_renderer_text`; `menus/link_context_menu`, `text_editor_context_menu`; `widgets/merged_find`, `find_in_html`, `find_in_text` |
| Commons | `pnpm --filter @triliumnext/commons test <pattern>` | `content_embeds`, `link_embed_markup`, `link_embed_dom`, `notes`, `markdown_renderer` |
| Core (both runners) | `pnpm --filter @triliumnext/server test <path>` and `pnpm --filter @triliumnext/standalone test <path>` | `share/content_renderer`, `share/handlers`, `services/notes`, `sanitizer`, `export/markdown`, `export/zip`, `import/zip`, `battachment`, `routes/api/{files,attachments,link_embed}`, `media_probe` |
| Server only | `pnpm --filter @triliumnext/server test <path>` | `services/notes` (`findIncludeNoteLinks`, `checkImageAttachments`), `routes/api/{files,media_proxy}`, `export/zip/share_theme` |
| Standalone only | `pnpm --filter @triliumnext/standalone test <path>` | `lightweight/zip_export_provider_factory` |
| Share theme | `pnpm --filter @triliumnext/share-theme test <pattern>` | `index`, `content/mermaid` |

`trilium-core` has no runner of its own; its `test` script only prints that. No end-to-end test
covers embeds.

**Coverage gates** fail a run that is otherwise green: `packages/ckeditor5` at 99.5% on every
metric, `packages/commons` and `packages/share-theme` at 100%, and the share renderers
(`packages/trilium-core/src/share/**`, `apps/server/src/share/**`) at 100%. A guard no test can
reach takes `/* v8 ignore next N -- reason */`.

## Editor plugin specs

Browser mode on Playwright's Chromium; the `ckeditor5-testing` skill has the setup.
- `createTestEditor(plugins, { contentEmbed: { ...fakes } })` in
  `packages/ckeditor5/test/editor-kit.ts` builds a `ClassicEditor`; `test/setup.ts` destroys it
  after each test. `createTestEditorOf()` takes another editor class.
- Kits beside it: `pressKey()`, `registerTestCleanup()` (`globals-test-kit.ts`), `getListRows()` and
  `pickListRow()` (`dropdown-kit.ts`), `link-embed-kit.ts`.
- `getEditorElement()` returns the editor's hidden source element. The editable is
  `editor.editing.view.getDomRoot()`.
- Fake content tools: `getTools: vi.fn(() => ({ hasEditableFlag: true }))`. To change them, call
  `mockReturnValue()` and then `editor.ui.update()`, the only signal the plugin listens to.
- Data with `data-trilium-embed` throws without a `sanitizeHtml` fake, and inline source needs
  `inlineLanguages: [ "mermaid" ]`.
- `FocusObserver` sets `isFocused` after a 50 ms timer.
- Playwright sends `"Control+Shift+z"` as a lowercase `z`, which CodeMirror reads as undo; write
  `"Control+Shift+Z"` to test redo.

## Client specs

happy-dom, set up by `apps/client/src/test/setup.ts`.

**Shared helpers:**
- `apps/client/src/test/content_embed.ts`: `buildCodeViewTextEditor()` (a fake editable root with
  `ckeditorInstance`), `getEmbedMenuItems()`, `summarizeMenuItem()`, `runEmbedMenuItem()`,
  `CODE_VIEW_ATTRIBUTES`.
- `test/render.ts` (`renderInto()`), `test/easy-froca.ts` (`buildNote()`), `test/dom_events.ts`.

**Fakes copied from spec to spec**, worth moving into `test/content_embed.ts` when the next spec
needs one: `buildEditor()` (`MermaidDiagram.spec.tsx`, and `MarkdownEmbed.spec.tsx`, whose copy
keeps the last save as the unsaved content), `buildSavingEditor()` over real `NoteSaves`
(`CodeEmbed.spec.tsx`), `placeInHostEditor()` (`ContentEmbed.spec.tsx`), `buildEditable()` /
`buildFakeEditor()` (`editable_embed.spec.tsx`), `createSource()` (`SourceEmbed.spec.tsx`).

**Mounting an embed:** put the component in `figure.include-note` > `.include-note-content`; set
`data-editable` / `data-display-mode` on the figure to drive it; dispatch `enterFullscreen` on the
content box for fullscreen. Content that shows a save status needs the badge slot too:
`.include-note-wrapper > .include-note-title-row > .include-note-badges`.

**Setup that specs need:**
- `options.set("codeNoteTheme", "")` (and `codeLineNumbersEnabled`) before any CodeMirror mounts.
- `<ParentComponent.Provider value={new Component()}>` around content that uses Trilium events.
- Find a CodeMirror view with `EditorView.findFromDOM()` inside `vi.waitFor()`.
- A hook driven by a `MutationObserver` reacts only after
  `await act(async () => { ...; await Promise.resolve(); })`.
- A preview renders over several `act` flushes (`settle()` in `TextEmbed.spec.tsx`); assert after
  it, or a pending render undoes the change under test.
- A fake `ContentEditor` keeps its last save as `getUnsavedContent()`. One that answers `undefined`
  lets `useSavedContent` revert the edit when the blob loads late.
- CKEditor's `scrollToTheSelection()` crashes under happy-dom: spy on it.
- Stub `Element.prototype.setPointerCapture` for resizing.
- Excalidraw does not import under Vitest: mock `restoreElements`.

**Mocks to keep in step:**
- `content_renderer.spec.ts` mocks every lazy component; its `CodeEmbed` mock must also export
  `useSavedContent`.
- `utils.spec.ts` mocks the default export of `content_renderer`, the only place
  `getRenderingType()` and `isSelfUpdatingType()` exist.

**Assertions:** translations do not resolve in client specs, so count buttons or use IDs rather
than `aria-label` text. `expect(x?.querySelector(…)).not.toBeNull()` passes when `x` is
`undefined`: assert `x` first.

`react-zoom-pan-pinch` measures layout that happy-dom lacks: mock `TransformWrapper` /
`TransformComponent` (the mock drops `wrapperClass`, so assert on `.svg-preview-root`).

## Testing in the running app

Open the note in one tab only: editors of one note in several tabs reload each other's saves, which
looks like an undo or Editable bug. Navigating to a note URL without `?ntxId=` opens another tab
each time.
