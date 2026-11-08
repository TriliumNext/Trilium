# The hunks of the Excalidraw patch

One entry per change in `patches/@excalidraw__excalidraw@0.18.1.patch`, in the order of the dev
bundle. Each names where it sits in both bundles, which Trilium code depends on it, the spec that
fails without it, and what would let it go. Update the entry in the same commit as the hunk.

`node .claude/skills/patching-excalidraw/excalidraw_patch.mjs changes [file]` prints the hunks of a
file as word-level snippets, which is the readable form of the prod bundle.

## 1. Pen stroke width factor

- **Where:** dev `actionChangeStrokeWidth`: `perform` takes `app` as its fourth argument and writes
  `value * factor` to a freedraw element; `PanelComponent` takes `app` and shows
  `strokeWidth / factor` for one. `App.handleFreeDrawElementOnPointerDown` multiplies
  `currentItemStrokeWidth` by the factor for a new stroke. `UIOptions.freedrawStrokeWidthFactor`
  in `types.d.ts`. Prod: the same expressions with `app` and `this.props` kept, locals renamed.
- **Used by:** `CanvasEditor` (`Canvas.tsx`) passes `THIN_STROKE_WIDTH_FACTOR` (0.5) while the
  synced option `canvasThinStroke` is on (Options, Other), else 1. Old strokes keep their width.
- **Guarded by:** contract spec, "sizes a pen stroke by the width factor": `this.props…` once and
  `app.props…` twice in each bundle, and `getFreeDrawSvgPath()` drawing at
  `strokeWidth * 4.25, thinning: 0.6`.
- **Added in:** 84ebe7940e.
- **Can go when:** Excalidraw's master draws freedraw strokes at half width (seen 2026-10,
  unreleased). When a release does, the `4.25` assertion fails, upstream's default becomes
  Trilium's thin stroke, and the option needs new factors (1 and 2) or no hunk at all.

## 2. Canvas layers drawn in layout effects

- **Where:** dev `StaticCanvas` and `NewElementCanvas`: the imported `useEffect` becomes
  `useLayoutEffect` (dev renames the numbered import, `useEffect42` to `useLayoutEffect10`,
  `useEffect44` to `useLayoutEffect11`, and its call). Prod changes only the import,
  `useEffect as D5` and `useEffect as $5`, because each alias has exactly one use.
- **Used by:** every Excalidraw in Trilium. Preact runs `useEffect` after the next frame, so on
  pointer up one frame showed the scene without the new element, and ink trailed the pen by two
  frames (#9484). `InteractiveCanvas` keeps `useEffect` on purpose.
- **Guarded by:** contract spec, "draws the scene and the new element in the layout effects": the
  hook that wraps each layer's drawing must be imported as `useLayoutEffect`, in both bundles.
- **Added in:** 4b4f3fd319 (closes #9484).
- **Can go when:** Excalidraw stops running on `preact/compat` (the `react` alias in the client and
  standalone Vite configs). React itself flushes these effects before the paint.
- **Trap:** in prod, rename an import alias only after checking it has no other use.

## 3. Desktop layout at any size (`getFormFactor`)

- **Where:** dev `App.refreshEditorBreakpoints`: `isMobile` comes from
  `UIOptions.getFormFactor?.(width, height) === "phone"` when the option is set, else from
  `isMobileBreakpoint()`. Declared in `types.d.ts`. Prod: `isMobile:this.isMobileBreakpoint(r,n)`
  occurs twice; the patched one follows `dockedSidebarBreakpoint`.
- **Used by:** `CanvasEditor` passes the module-level `getDesktopFormFactor` when `isDesktopLayout`
  is set: by `CanvasDrawing` (`isDesktop()`) and by the presentation's `SlideCanvasEditor`. Canvas
  notes keep Excalidraw's own breakpoints. Excalidraw memoizes on `UIOptions`, comparing
  functions by identity, so the function must stay the same object.
- **Why:** 0.18.1 turns mobile below 730 px wide, or below 500 px tall and 1000 px wide, measured
  on its container; an embed in a text note is often that small.
- **Guarded by:** contract spec, "takes the layout and the view limits": the hook
  `this.props.UIOptions.getFormFactor?.(` in both bundles.
- **Added in:** 409121e58d.
- **Can go when:** a release ships upstream's `UIOptions.getFormFactor` (on master after 0.18.1;
  this hunk is a backport). Drop the hunk and the declaration, then check that upstream's
  signature and its `"phone" | "tablet" | "desktop"` values still fit `getDesktopFormFactor`.

## 4. View limits (`constrainView`)

- **Where:** dev `App.translateCanvas`: with `UIOptions.constrainView` set, the state update goes
  through `constrainView(nonDeletedElements, nextAppState)`, whose `zoom`/`scrollX`/`scrollY`
  replace the requested ones (`null` keeps them). Wheel, trackpad, hand and space drag, pinch,
  PageUp/PageDown and the scrollbars all pan through `translateCanvas`. Declared in `types.d.ts`.
- **Used by:** `CanvasDrawing` passes `getBoundedView` (`drawing_view.ts`) to `CanvasEditor`: on
  an image canvas (a locked image at the bottom), zoom stays at or above the fit and the view
  stays on the image. A clamp in `onChange` jittered, since the overshot frame painted first.
- **Guarded by:** contract spec, "takes the layout and the view limits" (the hook in both
  bundles) and "pans and zooms with the wheel through `translateCanvas()`" (`handleWheel` calls it
  three times and never `setState`).
- **Added in:** fa35cf2e7e.
- **Can go when:** Excalidraw offers scroll or zoom limits of its own; 0.18.1 has none.

## 5. Zoom-to-fit offsets (`getEditorUIOffsets`)

- **Where:** dev `App.getEditorUIOffsets`: each floating panel (`.App-menu__left`, `.sidebar`)
  counts as a left or right inset by which half of the container its center is in, measured
  relative to the container (`offsetLeft`, `offsetTop`). Replaces upstream's two branches, LTR
  and RTL, that assume fixed sides.
- **Used by:** zoom to fit (Shift+1), zoom to selection and flowchart creation (Ctrl+Arrow) in every
  Trilium Excalidraw. `theme-next/notes/canvas.css` moves `.App-menu__left` to the right edge,
  where the stock code read it as a left inset and collapsed the zoom to 10% (#10493).
- **Guarded by:** `excalidraw_offsets.spec.ts` only, not the contract spec. It reads the single
  bundle that `require.resolve` returns, and its negative check names 0.18.1's minified
  variables (`left:Math.max(n?.right??0,0)+i`), so after an upgrade it passes whatever happens.
  Rewrite that check at the upgrade, or move the hunk into the contract spec for both bundles.
- **Added in:** ce121a06f6 (closes #10493). Extends upstream excalidraw/excalidraw#8562 (the
  container offset, issue #8561).
- **Can go when:** never entirely while `canvas.css` relocates the panel; #8562 covers only the
  offset part.

## 6. Bounds check before a freedraw hit test

- **Where:** dev `App.hitElement`: an unselected freedraw element that
  `hitElementBoundingBox(x, y, element, elementsMap, threshold)` rules out returns `false` before
  `getElementShape()` transforms every point. Prod calls the helper by its import alias, `ax` in
  0.18.1.
- **Used by:** pen up on touch devices and every eraser move test every element: 100 ms per
  eraser move on a 12-page handwritten canvas before, about a tenth of that after.
- **Guarded by:** contract spec, "rules out a pen stroke by its bounds": finds the helper's alias
  through its other call, in `shouldHideLinkPopup()` (`.zoom.value;if(<alias>(`).
- **Added in:** 454f6b5a98.
- **Can go when:** upstream bounds its freedraw hit test itself.

## 7. No element copies for the pen and the eraser

- **Where:** dev `App.initialPointerDownState`: `originalElements` is an empty `Map` while the
  active tool is `freedraw` or `eraser`, instead of a deep copy of every element. Prod: the same
  expression before `this.scene.getNonDeletedElements().reduce`.
- **Used by:** the same handwriting path: 49 ms per pen down at 12 pages before. Only crop, resize
  and drag of a selection read the copies.
- **Guarded by:** contract spec, the same test as 6.
- **Added in:** 454f6b5a98.
- **At an upgrade:** search the new dev bundle for readers of `originalElements`; a reader on the
  pen or eraser path gets an empty map.

## 8. `getMatchedLines` export

- **Where:** both bundles add Excalidraw's internal `getMatchedLines(textElement, searchQuery,
  index)` to their export list (prod: `LA as getMatchedLines`, `LA` being the function's minified
  name in 0.18.1). `dist/types/excalidraw/index.d.ts` declares it.
- **Used by:** `drawing_find.tsx`, find in text over drawings: `DrawingMatches` draws the
  rectangles as Excalidraw's own search does.
- **Guarded by:** contract spec, "measures matches with the `getMatchedLines()` that the Trilium
  patch exports" (the export in both bundles, called by `handleSearch()` with `.index`) and "draws
  the matches of its search as `DrawingMatches` draws them".
- **Added in:** 815cd0bcd1.
- **Can go when:** upstream exports it, or offers a search API.

## What the contract spec checks besides the patch

Half of `excalidraw_contract.spec.ts` pins Excalidraw internals that Trilium relies on without
patching them. After an upgrade, a failure there names Trilium code to review, not a hunk:

| Test | Trilium code it protects |
|---|---|
| renders every class and test id that the drawing selects | `CanvasDrawing.css` (classes extracted automatically; Trilium's own go in `TRILIUM_CLASSES`), `CODE_CLASSES` looked up in `CanvasDrawing.tsx`/`CanvasEmbedTools.tsx` |
| names every button of the toolbar with Excalidraw's own translations | `MAIN_TOOLS`, `EXTRA_TOOLS`, `LOCK`, `ZOOMS`, `HISTORY_ACTIONS`, `MENU_COMMANDS` in `CanvasEmbedTools.tsx` |
| zooms with the step, the limits and the math that the toolbar copies | `ZOOM_STEP` and `getZoomState()` in `CanvasEmbedTools.tsx`, `MIN_ZOOM`/`MAX_ZOOM` in `drawing_view.ts` |
| exports in dark colors with the filters that a saved picture applies | `DRAWING_DARK_FILTER`, `IMAGE_DARK_FILTER` and `saveDrawingPicture()` in `persistence.ts` |
| opens the library and the search in the sidebar that the menus name | `DEFAULT_SIDEBAR`, `SEARCH_TAB` |
| shows the keystrokes that Excalidraw binds to the commands of the menu | `MENU_COMMANDS` keystrokes |
| draws the matches of its search as `DrawingMatches` draws them | `MATCH_COLORS` in `drawing_find.tsx`, `.canvas-drawing-find` in `CanvasDrawing.css` |
| lets Ctrl+F reach the note once the drawing replaces the `searchMenu` action | `attachExcalidraw()` in `drawing_find.tsx` |
| fits the context menu in its container with the styles that the top layer replaces | `FITTED_MENU_STYLES` and `useTopLayerContextMenu()` in `CanvasDrawing.tsx` |
| lets the undo history of the note replace Excalidraw's undo and redo | `drawing_history.tsx` (`HISTORY_ICON_PATHS`, `isInteracting()`) |
| takes the wheel on its container | `useNoteScrollingWheel()` in `CanvasDrawing.tsx` |
| creates nothing with `NO_TOOL`, whose touch the canvases alone take | `NO_TOOL` in `CanvasEmbedTools.tsx`, the `[data-no-tool]` rule in `CanvasDrawing.css`. Master's `interaction` prop (unreleased after 0.18.1) can replace the CSS rule |
