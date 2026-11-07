# Hosting a third-party editor in an embed

What it took to run Excalidraw inside a text note, written so that the next editor (a spreadsheet,
a mind map, a whiteboard) starts from it. The canvas drawing is the worked example:
`apps/client/src/widgets/type_widgets/canvas/CanvasDrawing.tsx`, `CanvasDrawing.css`,
`CanvasEmbedTools.tsx`, `drawing_find.tsx`. Changes inside Excalidraw itself go through its patch:
load the `patching-excalidraw` skill.

## The text editor reaches into the embed

- **Styles leak in.** Rules for `.ck-content` (typography, `kbd`, `hr`, headings, links,
  first-child margins) match the editor's own markup. Exclude it at zero specificity, as
  `style.css`, `theme-next/dialogs.css` and `theme-next/forms.css` do with
  `:where(:not(.excalidraw *))`, and reset what remains in the embed's stylesheet.
- **Keys stop at the embed.** The embed element stops `keydown` from propagating
  (`stopEventPropagationAndHackRendererFocus` in `content_embed.ts`), in the bubble phase so that
  the editor's own shortcuts still run. Window shortcuts never see a key typed in the content:
  `ContentEmbed` binds them again on the content box (`useWindowShortcuts`), and content that wants
  Ctrl+F for Search in note calls `useFindShortcut(rootRef)`.
- **Nested CKEditor events.** An editor nested in the content handles its events only through
  `nested_editor_events.ts` (see _An editor of another note in an embed_ in the main skill).

## The embed moves with the note

- **Cached positions go stale.** Excalidraw caches its container's position and the note scrolls
  under it. With `isEmbedded`, `CanvasEditor` (`Canvas.tsx`) refreshes the position on
  `pointerover`, `pointermove` and `pointerdown` in the capture phase, only when the container
  moved, so pointer input lands where it is drawn.
- **The wheel scrolls the note.** `useNoteScrollingWheel()` stops the wheel before the editor's
  container listener, Ctrl/Cmd included, except in fullscreen. Zoom and pan come from the toolbar.
- **Touch scrolls the note too.** On mobile the drawing starts with a custom "No tool" whose canvas
  takes no pointer events (`data-no-tool`), as the editor's touch handler calls
  `preventDefault()` whatever `touch-action` says.
- **Popups get clipped.** `.scrolling-container` clips its descendants, `position: fixed` ones too.
  A panel or context menu that must leave the box goes into the top layer: `popover="manual"` and
  `showPopover()` (`setTopLayer()` in `CanvasDrawing.tsx`), with the UA popover styles reset.
- **The editor's UI hides while the embed is not active** (`.include-note-body.active`), at
  `opacity: 0`, since the editor's own rules beat `visibility`. Anything that must stay visible,
  such as Search in note highlights, needs an exception (`data-find-matches`).

## Loading, saving and showing

- **Focus after the editor draws.** `useFocusFromEmbedBox()` moves the focus into the editor once
  it rendered (after its language loaded), not when its API first exists.
- **A freshly loaded copy must not save.** Excalidraw's `restore()` changes elements as it loads,
  which saved the load back and remounted every other view of the drawing.
  `restoreLoadedElements()` (`canvas/persistence.ts`) baselines the scene version on the restored
  data.
- **Follow saves in place.** A drawing applies a save from elsewhere to the mounted editor, skipped
  while it has unsaved changes or the user is mid-stroke, rather than remounting.
- **Pace the saves.** A save per stroke blocks the main thread on large content:
  `postponeSave()` on the `ContentEditor` holds the save while the user keeps drawing, and the
  picture saved beside the drawing waits for a pause (`picture_schedule.ts`).
- **A picture while not edited.** A read-only drawing is a picture (`DrawingPicture`), not a
  read-only editor, which is far cheaper; the editor mounts only while Editable is on.
- **Undo** joins the note's undo stack: `DrawingHistory` in the main skill's _Undo history_.

## Pinning what the editor does not promise

Every class name, test ID, translation key and internal the integration relies on is checked
against the installed bundle by `canvas/excalidraw_contract.spec.ts`, so an upgrade that moves one
fails a spec instead of the UI. A new editor needs the same canary.

## CodeMirror per block

The same cost question applies to Trilium's own editors. Each CodeMirror view brings its DOM and
listeners, and a JSX or Trilium script language builds a TypeScript environment per view
(`createEnv()` in `packages/codemirror/src/type_completion/index.ts`). Content that can appear
many times in a note shows a static preview while it is not edited (`renderCodePreview()` from
`packages/codemirror/src/code_preview.ts`) and mounts the editor only while it is.
