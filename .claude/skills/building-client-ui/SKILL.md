---
name: building-client-ui
description: Use when building or changing any UI in the Trilium client (`apps/client`) — a dialog, a settings pane, a form, a toolbar, a badge, a link, a dropdown menu, a type widget, a control floating over a note's content (map, mind map, image, diagram, presentation), or any component that reads/writes a note's title, label, relation, blob or option. Catalogues the froca-reactive hooks (useNoteProperty / useNoteLabel / useNoteBlob / useChildNotes / useTriliumOption / useNoteContext) and which `loadResults` filter each already wires, the reusable Preact components under `apps/client/src/widgets/react/` (which one to reach for instead of a hand-rolled `<input>`/`<button>`/`<a>`/pill), when a dropdown is a `Dropdown` menu and when a `DropdownPanel`, the `OverlayControlGroup` / `OverlayToolbar` contract for controls over a canvas, the event-summoned Modal/LazyDialog wiring, and how to boot a login-free fixture instance to inspect real computed styles when a style, placement or stacking bug cannot be read off the stylesheets. The home for client UI guidance that outgrows CLAUDE.md.
---

# Building client UI

The client is a Preact app (legacy widgets are jQuery `BasicWidget`s; new UI is Preact). Shared components live in `apps/client/src/widgets/react/`. **Always reuse them instead of writing raw HTML elements or a custom implementation** — every hand-rolled `<input>`, `<select>`, `<button>`, `<a>`, pill or overlay button is a second copy of styling, focus handling and accessibility that drifts.

The general styling rules (no inline styles, one `.css` file per component imported at the top, scope by root class + native CSS nesting) are in the repo `CLAUDE.md`; this skill is about *which component* and *how to drive it*.

> **CLAUDE.md still foregrounds the jQuery widget lifecycle** (`doRenderBody` / `refreshWithNote` / `this.$widget`). That is for maintaining existing widgets. New UI is a `.tsx` component using the hooks below; reach for `useLegacyWidget` only to embed an existing jQuery widget into a Preact tree.

## Don't reinvent froca-reactive state

The most common mistake on this surface is writing `useState` + `server.get`/`froca` + a hand-rolled `entitiesReloaded` listener for something a **one-line hook already does** — with the right reload filter, the right echo-suppression, and the stale-request guard. `apps/client/src/widgets/react/hooks.tsx` exports 60 `use*` hooks. Check the catalogue first: [references/hooks-catalog.md](references/hooks-catalog.md).

| You need… | Use | It already wires |
|---|---|---|
| a scalar `FNote` field (title, isProtected, type, mime) | `useNoteProperty(note, "title", componentId)` | `loadResults.isNoteReloaded(noteId, componentId)` |
| a label value (read/write) | `useNoteLabel` / `…Boolean` / `…Int` / `…WithDefault` / `…OptionalBool` | `getAttributeRows()` + `attributes.isAffecting(attr, note)` — handles inheritance and templates |
| a label the user named themselves | `useNoteLabelByName` | same; `useNoteLabel` delegates to it but types the name to the declared vocabulary |
| a relation (read/write, or resolve the target) | `useNoteRelation` / `useNoteRelationTarget` | the same attribute filter |
| note binary content / blob | `useNoteBlob(note, componentId, { reportLoadStateTo })` | `isNoteContentReloaded` + an explicit delete check + a requestId stale-guard |
| child notes / subtree | `useChildNotes(parentNoteId)` | `getBranchRows()` parent match + `frocaReloaded` |
| an `FNote` by id | `useNote` / `useNoteTitle` / `useNoteIcon` / `useNoteColorClass` | cache-first + the matching reload filter |
| a synced option (read/write) | `useTriliumOption` / `…Bool` / `…Int` / `…Json` / `useTriliumOptions` | `getOptionNames()` |
| the split's note context | `useNoteContext()` | setNoteContext / noteSwitched / frocaReloaded / hoisted / readOnly |
| the *active* (focused) context | `useActiveNoteContext()` | same, plus re-resolving notePath when the note is moved |
| read-only / temporarily-editable state | `useIsNoteReadOnly` / `useEffectiveReadOnly` | the `readOnly` label + `readOnlyTemporarilyDisabled` |
| editor autosave plumbing | `useEditorSpacedUpdate` / `useBlobEditorSpacedUpdate` | spaced-update + the provenance guard for #9614 |
| fullscreen state for an overlay button | `useFullscreen(element)` | the Fullscreen API + `fullscreenchange` |
| publish/consume cross-widget data | `useSetContextData` / `useGetContextData` | `contextDataChanged` |
| a raw Trilium event | `useTriliumEvent` / `useTriliumEvents` | registerHandler/removeHandler on `ParentComponent` |
| embed a legacy jQuery widget | `useLegacyWidget` | the `child()` / `render()` / `activeContextChanged` bridge |

## The `entitiesReloaded` filter taxonomy

If you genuinely must hand-write `useTriliumEvent("entitiesReloaded", ({ loadResults }) => …)`, pick the **right predicate** — the wrong one silently never fires:

| Changed | Predicate |
|---|---|
| note row or its attributes | `loadResults.isNoteReloaded(noteId, componentId)` |
| blob / content (**not** the note row) | `loadResults.isNoteContentReloaded(noteId, componentId)` |
| a label or relation | iterate `loadResults.getAttributeRows()`, keep `attributes.isAffecting(attr, note)` |
| children added/removed/moved | `loadResults.getBranchRows()` (match `parentNoteId`) |
| options | `loadResults.getOptionNames()` |
| the whole cache was swapped (e.g. protected session) | the separate `frocaReloaded` event — re-read `FNote` refs, the old ones are orphaned |

Three things people get wrong:

- **`isNoteReloaded` ≠ `isNoteContentReloaded`.** The note row/attributes and the blob are tracked in *separate* maps. Using one to refresh the other compiles, runs, and never updates.
- **Attribute ownership is not `attr.noteId === note.noteId`.** `attributes.isAffecting()` walks `getNotesToInheritAttributesFrom()` and, for inheritable attributes, `hasAncestor()` — so a naive id check misses inherited and templated attributes.
- **Pass `componentId`** when the same component both saves and listens. `isNoteReloaded`/`isNoteContentReloaded` skip the originating component, so without it the widget gets its own save echoed back and clobbers fresher user-typed input.

## Reusable component catalogue

Form controls:

- `FormTextBox` — text input with validation and controlled input handling; `FormTextBoxWithUnit` for a unit suffix (`mm`, `px`). `FormTextArea`, `PasswordField`, `FormPasswordWithConfirmation` for their cases.
- `FormSelect` — dropdown/combobox taking an object array as data. `FormDropdownList` for a list of items with icons; `FormAutocomplete` / `NoteAutocomplete` for typeahead (the latter searches notes).
- `FormCheckbox`, `FormToggle`, `FormRadioGroup` / `FormInlineRadioGroup` — boolean and exclusive choices. `SegmentedChoice` is a row of buttons acting as one exclusive choice (use where a dropdown would hide the alternatives).
- `Slider` — range slider with label.
- `ColorPicker` — preset swatches plus the browser's native `<input type="color">`; value is a CSS color string, `onChange(null)` clears. It is a controlled, flat swatch row: wrap it in a `DropdownPanel` for a popover or use it inline; don't hand-roll a palette. `NoteColorPicker` is the note-bound variant that reads/writes the note's `color` label.
- `IconPicker` — boxicons picker.
- `FormGroup` — label + control + hint row for settings panes; `PropertySheet` for a whole sheet of them.
- `FormFileUpload`, `FileDropZone` — file input and drag-and-drop target.

Buttons and links:

- `Button` — the general button (also carries the tooltip for a *disabled* control via a wrapper, since a disabled `<button>` emits no pointer events). `ActionButton` — icon button with consistent styling. `SplitButton` — a button with its related actions in a `Dropdown` menu on a toggle beside it; its rows are `FormListItem`s.
- `HelpButton`, `HelpTooltipButton`, `HelpDropdown` — open in-app help pages; don't invent a new "?" affordance.
- A menu row's shortcut is `FormListItem`'s `keyboardShortcut` (an action's configured keys) or `shortcut` (literal text); never put keycaps into its label by hand.

**Never hand-roll `<a className="tn-link">`.** Which link component to reach for depends on what the link *is*:

| What the link does | Component |
| --- | --- |
| Runs an action, worded as a link rather than a button | `LinkButton` (`href="#"`, `onClick` or `triggerCommand`; already `role="button"` and Space-activated) |
| Goes to a note path with wording of your own — a summary sentence, "see the backup page" | `PageLink` (in `LinkButton.tsx`; suppresses the note preview, since text that already says what is there gains nothing from one) |
| Goes to a note, named by the note's own title | `NoteLink` (icon, color class, note path, hover preview) or `NewNoteLink` for the Preact-native variant |
| Opens a filesystem location in the OS file manager | `DirectoryLink` / `FileLink` (degrade to plain selectable text off Electron) |

A raw `<a>` is right only for an **external** URL, which no component covers: write it as `<a className="tn-link external" target="_blank" rel="noopener noreferrer">` (the theme appends the ↗ arrow from the `external` class or an `http(s)` href; `no-arrow` opts out). For a block of prose whose links come from elsewhere — rendered note content, a help page — put `use-tn-links` on the container instead of classing each anchor.

`no-tooltip-preview` is the class that keeps the note-hover preview away from a link into the note tree; `PageLink` and `NoteLink`'s `noPreview` set it for you, so it should rarely be written by hand.

Display and layout:

- `NoItems` — empty state placeholder with icon and message ("no results", "too many items", error states).
- `Badge` — colored pill/label with optional icon, tooltip and `onClick` (counts, status flags). Set its color through the `--color` CSS variable on a wrapper class, not inline styles; pass `outline` for a colored-border/transparent-fill variant. `BadgeWithDropdown` pairs a badge with a dropdown menu. Don't hand-roll pill/badge markup.
- `Chip` — one entry of a set, with a remove button.
- `Alert`, `InfoBar`, `Admonition`, `ContentErrorMessage`, `RenderErrorCard` — inline notices and error surfaces of increasing weight.
- `Card` — a titled group of sections (filter-aware under `FilterProvider`). `Collapsible` — animated, theme-styled expandable section with self-managed `initiallyExpanded`; `ExternallyControlledCollapsible` is the controlled variant (caller owns `expanded`/`setExpanded`).
- `TabStrip` — a row of icon-only tabs named by tooltips, heading a panel divided into groups.
- `Modal`, `WizardModal` — dialogs; `Popover` — a card anchored beside something, with an arrow pointing at it, as the calendar's event card (portaled to the body and placed by `placeFloating()`, so no scroll container clips it).
- `LoadingSpinner`, `LazyComponent`, `Icon`, `MaskedIcon`, `NoteList`, `SiblingNavigator`, `ImageViewer`, `CodeBlock`, `charts/DonutChart`, `charts/Treemap`.

Data grids and calendars (outside `widgets/react/`, but equally generic):

- `Table` — `apps/client/src/widgets/collections/table/tabulator.tsx`, a [Tabulator](https://tabulator.info/) wrapper (`columns`, `data`, `events`, `modules`, `tabulatorRef`; typed via `TableProps<T>`). Decoupled from the note/collection model — use it for any grid (SQL console results, the collection table view). Never instantiate `tabulator-tables` directly.
- `Calendar` — `apps/client/src/widgets/collections/calendar/calendar.tsx`, a [FullCalendar](https://fullcalendar.io/) wrapper (any `CalendarOptions` plus `calendarRef`; typed via `CalendarProps`). Use it for any calendar rather than `@fullcalendar/core` directly.

Overlays over a note's content — `OverlayControlGroup`, `OverlayToolbar`, `OverlayPanel` — see the dedicated section below.

Two rules that apply to all of them:

- **Do not use Bootstrap utility classes** (`form-control-sm`, `form-select-sm`, `input-group`, …) on these components — they manage their own styling. Adjust sizing or layout through the component's props or its CSS custom properties, not Bootstrap overrides.
- Before adding a prop or a variant, read the component's own doc comment; most already have the variant (outline badge, controlled collapsible, popover-wrapped picker).

## Dropdowns: menus and panels

Both kinds of dropdown share a toggle and open in a `Popup` portaled onto `<body>`, placed by Floating UI, so an ancestor's `overflow`, `transform` or `filter` never clips, displaces or flattens them. Which one to use depends on what opens:

- **`Dropdown`** opens a **menu** (`Menu`). Its rows are `FormListItem`, `FormDropdownSubmenu`, `FormListHeader`, `FormDropdownDivider` and `FormListCustomItem`; the menu takes focus and moves between them with the arrow keys, Home/End and typeahead, and tells assistive technology it is a menu. It caps its height to the viewport and scrolls in `.tn-menu-scroll`, while its backdrop blur stays on the frame's `::before`, so it is frosted everywhere.
- **`DropdownPanel`** opens anything else: a picker, a form, a list of links, help text. Its fields keep their keys; Up and Down only move between `.dropdown-item`s. Its blur, like a menu's, is on its `::before`, so its own frame must never scroll: for content that can outgrow the screen, pass **`scrollable`**, which caps the panel to the room it has and scrolls the content inside it.

A wrong pick fails quietly: a form in a `Dropdown` loses Up, Down, Tab and Escape to the menu, and a list of rows in a `DropdownPanel` gets none of the menu's keys. On a phone, pass `mobileBottomSheet` to open either as a sheet from the bottom of the screen over a dimmed page.

Rules for both:

- **Placement and closing are props of their own**: `placement` takes Floating UI's names (`"top"`, `"bottom-end"`, …) and flips near the viewport's edge; `autoClose` is `true`, `"inside"`, `"outside"` or `false`. There is no Bootstrap or Popper config to pass.
- **A bottom sheet is only ever `mobileBottomSheet`.** Never put `mobile-bottom-menu` in `dropdownContainerClassName`: the stylesheet then pins the popup to the bottom while Floating UI still places it beside its toggle, and Floating UI's inline `max-height` caps the sheet to the room the toggle had. `mobileBottomSheet` also dims the page, so it needs no `mobileBackdrop`.
- **`dropdownRef` holds a `DropdownHandle`** (`show`, `hide`, `toggle`), exported from `Dropdown.tsx`. Type the ref with it, never with Bootstrap's `Dropdown`, which compiles but promises methods the handle doesn't have.
- **Submenus**: `FormDropdownSubmenu` opens a submenu only inside a `Dropdown` menu (elsewhere, its title is rendered as a header above its rows). Which side a submenu opens on, and which way its row's arrow points, is detected from the room around the menu; there is no prop for it.
- **Style a popup by its own classes.** It lives in `<body>`, inside a `.tn-dropdown-portal` wrapper that carries the dropdown's `className`, so a rule scoped under the toggle's ancestors (`.status-bar .dropdown-menu`) never matches it. Use `dropdownContainerClassName` with top-level rules. Its z-index (1200, over dialogs) is set in `Popup.css`; `--bs-dropdown-zindex` doesn't reach it.

Other floating surfaces:

- **Position with `placeFloating()`** from `Popup.tsx`, under Floating UI's `autoUpdate()`, as `Popup`, submenu layers and `Popover` do. Its `arrow` option places a pointer element. Don't bring back Popper (`createPopper`): the client no longer uses it directly, and it stays installed only as Bootstrap's peer dependency.
- **A cover or backdrop that disappears with its popup lets the dismissing tap's click through.** The press closes the popup and hides the cover before the browser sends the click, which then lands on whatever was under the cover. `Popup` drops that click (`swallowStrayClick`); a custom surface with a cover needs the same.
- **Any element with `.dropdown-menu` that isn't a Bootstrap dropdown must capture Up, Down and Escape on `window`.** Bootstrap's handler captures them on `document` for every `.dropdown-menu` and throws when no `data-bs-toggle` is next to it. `Popup`, `Menu` and `FormList` do this; a new surface that reuses the class for its styling needs it too.
- **`FormList`**, the always-open list in the note type chooser, revisions and font pickers, moves focus with Up and Down through `focusListItem()`, as `DropdownPanel` does, not with the menu's keyboard model.

## Controls floating over a note's content

Any control laid **over** a note's own content — a geo map, a mind map, an image, a video, a diagram, a presentation, and whatever comes next — goes on one of two shared components. **Never hand-roll a `<button>` with `tn-overlay-*` classes**: those classes are the components' business, and a site that writes them itself also has to write the ref, the tooltip, the `aria-label` and the `type="button"` that the component already owns.

- **`OverlayControlGroup`** (`OverlayControlGroup.tsx`) — a run of buttons joined edge to edge into one segmented chip. **This is the default**, and specifically what zoom steps, a zoom/scale readout, next/previous navigation, fullscreen and "add a thing to this view" buttons are built from. Its buttons are `OverlayControlButton`; `OverlayFullscreenButton` is the ready-made fullscreen toggle (pass it `isFullscreen` + `onToggle` from `useFullscreen` in `hooks.tsx`).
- **`OverlayToolbar`** (`OverlayToolbar.tsx`) — separate buttons spaced out on their own pane of frosted glass. Use it only where the controls are *not* one run of related steps (e.g. the mind map's four layout-direction choices).
- **`OverlayPanel`** (`OverlayPanel.tsx`) — a panel over a dragged/zoomed canvas holding what can be done with the current selection (header row + dismiss button included).

Rules for `OverlayControlButton`, which cover every case seen so far:

- **`title` is the tooltip.** A button wearing no words is also named by it; one that wears words is named by them. Do not add an `aria-label` — the component decides, and a title that says more at length would otherwise speak over the visible words. The one exception is a face that is neither words nor a mark (a keycap, a glyph standing for itself), which passes a plain `aria-label` of its own.
- **`icon` is a boxicons name** (`bx-plus-circle`), **`text` is what stands inside**. Given both, the component renders the mark as a child span itself — never put a `bx` class on a button that also wears words, since the icon font would fall on the words too.
- **`active`/`disabled` are props**, not classes concatenated into `className`.
- **Pass `overCanvas`** when the group stands over something that is dragged (a map), so a press on a button is not taken for the start of a drag.
- **Where the group stands is the group's own**, via `placement` (`top`/`bottom` × `start`/`center`/`end`): it pins itself over the nearest positioned ancestor, and its tooltips open away from that edge. **Never write `position: absolute` plus insets at the call site.** What the caller does hand over, in that widget's CSS, is the room to keep from the edges (`--overlay-group-inset`, or the per-edge `--overlay-group-inset-top`/`-bottom`/`-start`/`-end` where one edge differs — a fullscreen map clearing a notch, which spells that inset `var(--safe-area-inset-top, env(safe-area-inset-top))`, never a bare `env()`, since Android leaves `env()` at `0`) and the `z-index`. `titlePosition` overrides the tooltip direction and is rarely right; only add a class to a *button* if a rule actually uses it.
- **Overlay controls exist in every layout.** Never gate a group on `isExperimentalFeatureEnabled("new-layout")`, and when an action moves onto a group, **delete its twin in `FloatingButtonsDefinitions.tsx`** rather than keeping both: that bar only renders in the old layout (`desktop_layout.tsx` mounts it with `!isNewLayout`), so a layout-gated group plus a floating fallback means two implementations of one button that drift. Keep the underlying app commands (e.g. `relationMapResetZoomIn`) even once the group is their only caller — note scripts can fire them via `api.triggerCommand`.
- Reuse shared labels from the `common` translation namespace (e.g. `common.fullscreen`) rather than adding a per-widget copy of a string the app already has.

Worked examples to read before adding a new one: `apps/client/src/widgets/type_widgets/mind_map/MapToolbar.tsx` (group + toolbar + fullscreen), `type_widgets/relation_map/MapToolbar.tsx`, `collections/geomap/MapToolbar.tsx`, `type_widgets/helpers/SvgSplitEditor.tsx`.

## Dialogs

Dialogs are **event-summoned** and **lazy-mounted**. Worked example: `apps/client/src/widgets/dialogs/sort_child_notes.tsx`.

1. **State:** `const [ shown, setShown ] = useState(false);`
2. **Summon:** `useTriliumEvent("yourEvent", (data) => { …; setShown(true); });`
3. **Render** a controlled `<Modal>`:
   ```tsx
   <Modal
       className="your-dialog"          // static literal — Bootstrap mutates classList (fade/show)
       show={shown}
       onHidden={() => setShown(false)} // MANDATORY — see below
       onSubmit={onSubmit}              // optional: wraps the body in a form, Enter submits
       title={t("…")} size="lg"
   >…</Modal>
   ```
4. **Register it** in `applyModals()` in `apps/client/src/layouts/layout_commons.tsx`:
   ```tsx
   .child(<LazyDialog triggerEvents={["yourEvent"]} loader={() => import("../widgets/dialogs/your.js")} />)
   ```
   Skip this and **nothing summons the dialog** — the event has no listener and the modal never mounts.
5. **Eager (un-lazy) registration is only for the four documented exceptions** at the end of `applyModals()` — see the reference.

Two `Modal` footguns:

- **`onHidden` is required and must `setShown(false)`.** Bootstrap closing the modal (backdrop, close button, submit) does **not** touch React state; if `show` stays `true`, the next `show=true` is a no-op and the dialog can't reopen.
- **Keep `className` a static string.** It is rendered as `` `modal fade mx-auto ${className}` `` and Bootstrap toggles `fade`/`show` on that same element, so a dynamic className fights it.

Full prop reference, `LazyDialog` mechanics and the eager exceptions: [references/dialogs.md](references/dialogs.md).

## Preact 11 conventions

**Where a name comes from.** Components, `createPortal`, `Fragment` and every type come from
`preact`; hooks come from `preact/hooks`. Import from `preact/compat` only what nothing else
provides: `memo`, `lazy`, `Suspense`, `flushSync`, `useSyncExternalStore`.

- The DOM helper types are top-level exports of `preact`: `CSSProperties`, `HTMLAttributes`,
  `ButtonHTMLAttributes`, `TargetedMouseEvent` (and the pointer, focus, keyboard, wheel and drag
  twins), `MouseEventHandler`. The `JSX` namespace keeps only `JSX.Element` and
  `JSX.IntrinsicElements`.
- `MutableRef` is gone; its shape is `RefObject<T>`. `HTMLProps` exists only in compat; use
  `HTMLAttributes`.
- In an ambient `.d.ts` (`types-lib.d.ts`), import the Preact types an augmentation uses
  explicitly: inside `declare module "preact"`, a name Preact only re-exports does not resolve.
  `skipLibCheck` keeps `.d.ts` errors silent, so the broken augmentation shows up only where the
  element is used.

**Refs.** `useRef<T>(null)` returns `RefObject<T | null>`, so a hook or prop taking an element ref
declares `RefObject<T | null>`. The argument-less `useRef<T>()` is gone: a value ref is
`useRef<T | undefined>(undefined)`, and a callback type needs parentheses,
`useRef<(() => void) | undefined>(undefined)`, or the union lands on its return type. Passing a
nullable ref to `useImperativeHandle` infers `T` without its `null`; give both type arguments.

**Unmount cleanups.** A removed component's `useEffect` cleanups run after the next paint, not during
the unmount. A cleanup that must happen while the tree is torn down goes in `useLayoutEffect`
instead:

- it reports to a host that lets go of its state right after `render(null)` (`useForwardedKeys()`
  clearing the editor's `aria-activedescendant` for `createHostedList()`);
- it reads a child or library instance, which a class component's `componentWillUnmount()` tears
  down synchronously (the canvas attachment editor's `release()` reading Excalidraw's scene).

Clearing a timer, aborting a request or setting a flag can stay a passive cleanup: a frame late does
no harm, and Preact runs all pending cleanups before any new effect.

**`preact/compat` is always loaded**, and its `options.vnode` hook changes every element: `onChange`
on a text-like `<input>`/`<textarea>` (including `range` and `color`) fires on `input`, `onFocus`/
`onBlur` are the bubbling `focusin`/`focusout`, and numeric style values get `px`. Still write the
unit (`` `${width}px` ``): core no longer adds it. `defaultProps` also works only through compat;
use parameter defaults.

**Per-element attribute types.** `role` is typed by element, following ARIA in HTML:

- `<menu>` requires a `role`. Our menus use `role="none"`, as their rows carry their own roles.
- Props spread onto a `<button>` are `ButtonHTMLAttributes`, not the generic `HTMLAttributes`.
- `<input>` and `<img>` are discriminated unions keyed on `type` and on the accessible name. A
  wrapper forwarding its caller's props cannot prove which branch it hits, so it casts once where
  it spreads them (`AccessibleInputHTMLAttributes`, `AccessibleImgHTMLAttributes`), as `FormTextBox`
  and `SafeImage` do. Narrowing the wrapper's props does not satisfy the union.

## Footgun checklist

- **Reinventing a hook** — `useState` + `server.get` + a manual `entitiesReloaded` listener that a hook already provides. Check the catalogue.
- **Wrong reload predicate** — `isNoteReloaded` (row/attrs) vs `isNoteContentReloaded` (blob) vs `getAttributeRows()` + `isAffecting` (labels/relations, including inherited) vs `getBranchRows()` (children) vs `getOptionNames()`.
- **Omitting `componentId`** — the saving widget echoes its own change back and overwrites fresher input.
- **Dialog registered but not wired** — no `<LazyDialog triggerEvents={…}>` in `applyModals()`, so the summon event has no listener and nothing happens.
- **Modal can't reopen** — a missing/empty `onHidden`, or a dynamic `className` fighting Bootstrap's `fade`/`show`.
- **Bootstrap utility classes or inline static styles on `Form*` components** — use the sibling per-component `.css` scoped under a root class.
- **Hand-rolled overlay buttons** — `tn-overlay-*` classes at a call site instead of `OverlayControlGroup` / `OverlayControlButton`.
- **Copying the jQuery lifecycle** (`doRenderBody` / `refreshWithNote` / `this.$widget`) into new `.tsx` — use `useLegacyWidget` only to embed an existing widget.
- **A `useEffect` cleanup that must run during the unmount** — it runs after paint; reporting to a host or reading a child instance belongs in a `useLayoutEffect` cleanup (see "Preact 11 conventions").
- **Importing core names through `preact/compat`** — `createPortal`, hooks and types come from `preact` / `preact/hooks`; compat is for `memo`, `lazy`, `Suspense`, `flushSync`, `useSyncExternalStore`.
- **Diagnosing a style or placement bug from the stylesheets** — the load order in a hand-built test page does not match the app's, so the bug can fail to reproduce and send you after the wrong cause. Measure computed styles in a running instance: [references/inspecting-the-running-app.md](references/inspecting-the-running-app.md).

> Not a footgun here: `isElectron()` / `isMac()` from `apps/client/src/services/utils.ts` are runtime checks safe at module load. The "call only after init" trap is a **trilium-core** concern (`utils/index.ts` → `getPlatform()`), not client UI.

## Reference map

| File | Read it for |
|---|---|
| [references/hooks-catalog.md](references/hooks-catalog.md) | All 60 `use*` hooks grouped by purpose, one line each with the `loadResults` filter it wires — the anti-re-derivation asset. |
| [references/dialogs.md](references/dialogs.md) | Full `Modal` prop reference, the 5-step summon→register recipe, `LazyDialog` mechanics, the four eager exceptions, the `sort_child_notes.tsx` walkthrough. |
| [references/inspecting-the-running-app.md](references/inspecting-the-running-app.md) | Booting a login-free instance on the e2e fixture document (in memory, no build, no password) to measure real computed styles, plus how to read a cascade or stacking problem in the running app. Reach for it whenever the answer depends on what actually won, not on what the stylesheets say. |

Related skills: **writing-unit-tests** (rendering these components and testing hooks with the easy-froca fixtures), **analyzing-coverage** (measuring client coverage), **working-with-translations** (adding the English strings these components display).
