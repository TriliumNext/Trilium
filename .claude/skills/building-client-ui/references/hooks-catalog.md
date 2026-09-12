# Hooks catalog — `apps/client/src/widgets/react/hooks.tsx`

Every exported `use*` hook (60 at the time of writing: `grep -cE "^export function use" apps/client/src/widgets/react/hooks.tsx`), grouped by purpose. The point of this file: **find the hook before writing `useState` + `server.get` + a hand-rolled `entitiesReloaded` listener.**

No line numbers here — the file moves too fast for them to stay true. Jump with `grep -n "export function <name>" apps/client/src/widgets/react/hooks.tsx`.

## Note fields / identity

| Hook | Does | Reacts to |
|---|---|---|
| `useNoteProperty(note, prop, componentId?)` | scalar `FNote` field (`title`, `isProtected`, `type`, `mime`) | `loadResults.isNoteReloaded(noteId, componentId)` |
| `useNote(noteId, silentNotFoundError?)` | resolve an `FNote` by id | cache-first, then `froca.getNote`, with a `requestId` stale-guard |
| `useNoteTitle(noteId, parentNoteId?)` | title via `tree.getNoteTitle` (handles protected/placeholder) | `isNoteReloaded` + branch match + `protectedSessionStarted` |
| `useNoteIcon(note)` | `note.getIcon()` | the `iconClass` label |
| `useNoteColorClass(note)` | `note.getColorClass()` | the `color` label |
| `useNoteSavedData(noteId)` | last-saved content via `useSyncExternalStore` over `noteSavedDataStore` | store subscription |

## Labels (read/write, inheritance-aware)

All iterate `loadResults.getAttributeRows()` and keep rows where `attributes.isAffecting(attr, note)` — which covers inherited and templated attributes. Don't replace that with `attr.noteId === note.noteId`.

| Hook | Notes |
|---|---|
| `useNoteLabel(note, name)` | `[value, setter]`. Setter: `undefined` → create a valueless label (tag); `null` → remove. `name` is typed to the declared label vocabulary. |
| `useNoteLabelByName(note, name)` | The same, for a label the app does **not** know by name — one the user named themselves. `useNoteLabel` delegates to it; prefer `useNoteLabel` wherever the name is a builtin, so it stays held to the vocabulary. |
| `useNoteLabelWithDefault(note, name, default)` | as `useNoteLabel`, value falls back to `default`. |
| `useNoteLabelBoolean(note, name)` | `[bool, setter]`; setter uses `attributes.setBooleanWithInheritance`. |
| `useNoteLabelOptionalBool(note, name)` | `undefined` when the label is absent → distinguishes "unset" from "false". |
| `useNoteLabelInt(note, name)` | parsed int, `undefined` when absent/non-finite. |

## Relations

| Hook | Does |
|---|---|
| `useNoteRelation(note, name)` | `[value, setter]`; same `getAttributeRows()` + `isAffecting` filter; setter calls `attributes.setAttribute`. |
| `useNoteRelationTarget(note, name)` | resolves the relation's target `FNote` (`note.getRelationTarget`). |

## Options (synced, read/write)

All react to `loadResults.getOptionNames()` and persist via `options.save`.

| Hook | Value type |
|---|---|
| `useTriliumOption(name, needsRefresh?)` | `string` (optionally reloads the frontend on change) |
| `useTriliumOptionBool(name, needsRefresh?)` | `boolean` |
| `useTriliumOptionInt(name)` | `number` |
| `useTriliumOptionJson<T>(name, needsRefresh?)` | parsed `T` |
| `useTriliumOptions(...names)` | record of many at once; setter is `options.saveMany` |

## Note context

| Hook | Does |
|---|---|
| `useNoteContext()` | the split's context: `{ note, noteId, notePath, hoistedNoteId, ntxId, viewScope, componentId, noteContext, parentComponent, isReadOnlyTemporarilyDisabled }`; reacts to setNoteContext / activeContextChanged / noteSwitched / frocaReloaded / noteTypeMimeChanged / readOnlyTemporarilyDisabled / hoistedNoteChanged. |
| `useActiveNoteContext()` | same shape but for the *focused* context; additionally **re-resolves `notePath` when the active note is moved** (entitiesReloaded + `getBranchRows`). |
| `useIsNoteReadOnly(note, noteContext)` | `{ isReadOnly, enableEditing, temporarilyEditable }` — read-only with an editing mode available. |
| `useEffectiveReadOnly(note, noteContext)` | synchronous effective read-only for widgets honoring `#readOnly` (mermaid/canvas/mind-map/spreadsheet). |

## Content & editor autosave

| Hook | Does |
|---|---|
| `useNoteBlob(note, componentId?, opts?)` | binary/blob content; `isNoteContentReloaded` + an explicit `isDeleted` check + a `requestId` stale-guard; optionally publishes `contentLoad` state to a note context via `reportLoadStateTo`. |
| `useSpacedUpdate(callback, interval?, stateCallback?)` | generic `SpacedUpdate` wrapper (debounced commit). |
| `useEditorSpacedUpdate({...})` | note-data autosave with a **provenance guard** so content typed into one note is never saved under the next note's id (#9614). |
| `useBlobEditorSpacedUpdate({...})` | as above but uploads a `Blob`/`File` (attachments, images); optional `replaceWithoutRevision`. |
| `useTextEditor(noteContext)` | the live `CKTextEditor` instance for a context; reacts to `textEditorRefreshed`. |
| `useContentElement(noteContext)` | the content `HTMLElement` for a context; reacts to `contentElRefreshed`. |

## Tree / children

| Hook | Does |
|---|---|
| `useChildNotes(parentNoteId)` | child `FNote[]`; `getBranchRows()` parent match + `frocaReloaded` (swaps to fresh refs after a cache wipe). |
| `useLauncherVisibility(launchNoteId)` | whether a launcher sits in a visible-launchers branch; reacts to branch changes. |

## Cross-widget context data

| Hook | Does |
|---|---|
| `useSetContextData(noteContext, key, value)` | publish data (TOC, PDF pages, save state) on a context; auto-clears on unmount/note switch. |
| `useGetContextData(key)` | consume context data from the **active** context. |
| `useGetContextDataFrom(noteContext, key)` | consume from a **specific** context; reacts to `contextDataChanged`. |

## Events / imperative interop

| Hook | Does |
|---|---|
| `useTriliumEvent(name, handler)` | register one event handler on the nearest `ParentComponent`; auto-unregisters. |
| `useTriliumEvents(names, handler)` | one handler for many events (handler gets `(data, eventName)`). |
| `useLegacyWidget(factory, opts)` | embed a jQuery `BasicWidget`/`NoteContextAwareWidget`; returns `[VNode, widget]`; bridges `child()`/`render()`/`activeContextChanged`. **The only sanctioned bridge to old widgets.** |
| `useLegacyImperativeHandlers(handlers)` | expose imperative methods on the host legacy component, so legacy callers can invoke them. |
| `useLegacyComponentElement(elRef)` | tag a DOM element with the owning component so jQuery's `.prop("component")` lookup finds it. |
| `useSyncedRef(externalRef?, initial?)` | merge an external ref with an internal one. |

## Keyboard & shortcuts

| Hook | Does |
|---|---|
| `useKeyboardShortcuts(scope, containerRef, parentComponent, ntxId)` | bind a note-type scope's actions (`code-detail`/`text-detail`) to a container; unbinds on cleanup. |
| `useGlobalShortcut(shortcut, handler)` | register a global shortcut under a random namespace. |
| `useContextualShortcutHints(hints)` | contribute shortcut hints for the current context to the hints panel. Registers once per host via a ref, so an inline array/function doesn't re-register every render. A standalone Preact root hosted by `appContext` itself is skipped — registering there would surface the hints in *every* context. |

## Tooltips

| Hook | Does |
|---|---|
| `useTooltip(elRef, config)` | Bootstrap tooltip with an imperative `{ showTooltip, hideTooltip }`. |
| `useStaticTooltip(elRef, config?)` | tooltip with no imperative API; auto-hides siblings. |
| `useStaticTooltipWithKeyboardShortcut(elRef, title, actionName, opts?)` | static tooltip whose title appends the action's effective shortcut. |

## DOM / observers / sizing / navigation

| Hook | Does |
|---|---|
| `useElementSize(ref)` | element `DOMRect` via `ResizeObserver`. |
| `useWindowSize()` | `{ windowWidth, windowHeight }`, reacts to resize. |
| `useResizeObserver(ref, callback)` | run a callback on element resize. |
| `useFullscreen(element, onChange?)` | `[isFullscreen, toggle]` over the Fullscreen API. Reads `onChange` from a ref so a listener bound once follows a handler passed anew each render. Feed it to `OverlayFullscreenButton`. |
| `useNoteTreeDrag(containerRef, opts)` | drag-drop of notes onto a container (parses `DragData[]`). |
| `useCollectionTreeDrag(containerRef, opts)` | `useNoteTreeDrag` for a collection view; adds `dragEnabled`/`includeArchived` and warns when dropped notes are archived-and-hidden. |
| `useLongPressContextMenu(handler, holdMs?)` | right-click + touch long-press → context-menu props to spread. |
| `useContainedLinkNavigation(containerRef, onNavigate)` | keep internal note-link clicks inside a popup/dialog instead of the global handler (capture-phase). |
| `useImperativeSearchHighlighlighting(tokens)` | returns a fn that `mark.js`-highlights search tokens in an element. |
| `useMathRendering(containerRef, deps)` | lazily KaTeX-render `.math-tex` elements (TOC/highlights sidebars). |

## Misc utilities

| Hook | Does |
|---|---|
| `useUniqueName(prefix?)` | stable random name for inputs (unique across tabbed widgets). |
| `useColorScheme()` | `"dark"` / `"light"`, reacting to theme + `prefers-color-scheme`. |
| `useDelayedVisibility(active, opts?)` | flicker-free loading phase `"hidden"` / `"visible"` / `"stalled"` (grace + min-visible + stall escalation). |
| `useDebouncedValue(value, delay)` | the value, settled after `delay` ms without a change. |

---

**Testing these hooks:** see the **writing-unit-tests** skill — render via raw `preact` `render()` into happy-dom, drive entity changes with the easy-froca fixtures, and prefer extracting pure decision logic out of a component into a top-level `export function` you can test directly.
