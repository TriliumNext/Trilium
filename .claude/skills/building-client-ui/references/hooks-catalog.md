# Hooks catalog — `apps/client/src/widgets/react/hooks.tsx`

All **54** exported `use*` hooks (verified `grep -cE "^export function use"` = 54), grouped by purpose. Line numbers are into `hooks.tsx` at the time of writing; if they have drifted, `grep -n "export function <name>"`. The point of this file: **find the hook before writing `useState` + a manual `entitiesReloaded` listener.**

## Note fields / identity

| Hook | L | Does | Reacts to |
|---|---|---|---|
| `useNoteProperty(note, prop, componentId?)` | 616 | scalar `FNote` field (`title`, `isProtected`, `type`, `mime`) | `loadResults.isNoteReloaded(noteId, componentId)` |
| `useNote(noteId, silentNotFoundError?)` | 1411 | resolve an `FNote` by id | cache-first, then `froca.getNote`, with a `requestId` stale-guard |
| `useNoteTitle(noteId, parentNoteId?)` | 1448 | title via `tree.getNoteTitle` (handles protected/placeholder) | `isNoteReloaded` + branch match + `protectedSessionStarted` |
| `useNoteIcon(note)` | 1479 | `note.getIcon()` | the `iconClass` label (via `useNoteLabel`) |
| `useNoteColorClass(note)` | 1489 | `note.getColorClass()` | the `color` label |
| `useNoteSavedData(noteId)` | 294 | last-saved content via `useSyncExternalStore` over `noteSavedDataStore` | store subscription |

## Labels (read/write, inheritance-aware)

All iterate `loadResults.getAttributeRows()` and keep rows where `attributes.isAffecting(attr, note)` (attributes.ts:140) — which covers inherited and templated attributes. Don't replace that with `attr.noteId === note.noteId`.

| Hook | L | Notes |
|---|---|---|
| `useNoteLabel(note, name)` | 684 | `[value, setter]`. Setter: `undefined` → create valueless label (tag); `null` → remove. |
| `useNoteLabelWithDefault(note, name, default)` | 719 | as above, value falls back to `default`. |
| `useNoteLabelBoolean(note, name)` | 724 | `[bool, setter]`; setter uses `attributes.setBooleanWithInheritance`. |
| `useNoteLabelOptionalBool(note, name)` | 756 | `undefined` when label absent → distinguish "unset" from "false". |
| `useNoteLabelInt(note, name)` | 766 | parsed int, `undefined` when absent/non-finite. |

## Relations

| Hook | L | Does |
|---|---|---|
| `useNoteRelation(note, name)` | 634 | `[value, setter]`; same `getAttributeRows()` + `isAffecting` filter; setter calls `attributes.setAttribute`. |
| `useNoteRelationTarget(note, name)` | 665 | resolves the relation's target `FNote` (`note.getRelationTarget`). |

## Options (synced, read/write)

All react to `loadResults.getOptionNames()` (hooks.tsx:333) and persist via `options.save`.

| Hook | L | Value type |
|---|---|---|
| `useTriliumOption(name, needsRefresh?)` | 312 | `string` (optionally reloads the frontend on change) |
| `useTriliumOptionBool(name, needsRefresh?)` | 355 | `boolean` |
| `useTriliumOptionInt(name)` | 371 | `number` |
| `useTriliumOptionJson<T>(name, needsRefresh?)` | 387 | parsed `T` |
| `useTriliumOptions(...names)` | 402 | record of many at once; setter is `options.saveMany` |

## Note context

| Hook | L | Does |
|---|---|---|
| `useNoteContext()` | 429 | the split's context: `{ note, noteId, notePath, hoistedNoteId, ntxId, viewScope, componentId, noteContext, parentComponent, isReadOnlyTemporarilyDisabled }`; reacts to setNoteContext/activeContextChanged/noteSwitched/frocaReloaded/noteTypeMimeChanged/readOnlyTemporarilyDisabled/hoistedNoteChanged. |
| `useActiveNoteContext()` | 531 | same shape but for the *focused* context; additionally **re-resolves `notePath` when the active note is moved** (entitiesReloaded + `getBranchRows`, L583). |
| `useIsNoteReadOnly(note, noteContext)` | 1282 | `{ isReadOnly, enableEditing, temporarilyEditable }` — read-only with an editing mode available. |
| `useEffectiveReadOnly(note, noteContext)` | 1321 | synchronous effective read-only for widgets honoring `#readOnly` (mermaid/canvas/mind-map/spreadsheet). |

## Content & editor autosave

| Hook | L | Does |
|---|---|---|
| `useNoteBlob(note, componentId?, { reportLoadStateTo? })` | 777 | binary/blob content; `isNoteContentReloaded` + explicit `isDeleted` check + `requestId` stale-guard; optionally publishes `contentLoad` state to a note context. |
| `useSpacedUpdate(callback, interval?, stateCallback?)` | 65 | generic `SpacedUpdate` wrapper (debounced commit). |
| `useEditorSpacedUpdate({...})` | 104 | note-data autosave with a **provenance guard** so content typed into one note is never saved under the next note's id (#9614, L116-124). |
| `useBlobEditorSpacedUpdate({...})` | 201 | same as above but uploads a `Blob`/`File` (attachments, images), optional `replaceWithoutRevision`. |
| `useTextEditor(noteContext)` | 1498 | the live `CKTextEditor` instance for a context; reacts to `textEditorRefreshed`. |
| `useContentElement(noteContext)` | 1526 | the content `HTMLElement` for a context; reacts to `contentElRefreshed`. |

## Tree / children

| Hook | L | Does |
|---|---|---|
| `useChildNotes(parentNoteId)` | 1355 | child `FNote[]`; `getBranchRows()` parent match + `frocaReloaded` (swaps to fresh refs after a cache wipe). |
| `useLauncherVisibility(launchNoteId)` | 1387 | whether a launcher is in a visible-launchers branch; reacts to branch changes. |

## Cross-widget context data

| Hook | L | Does |
|---|---|---|
| `useSetContextData(noteContext, key, value)` | 1566 | publish data (TOC, PDF pages, save state) on a context; auto-clears on unmount/note switch. |
| `useGetContextData(key)` | 1604 | consume context data from the **active** context. |
| `useGetContextDataFrom(noteContext, key)` | 1616 | consume from a **specific** context; reacts to `contextDataChanged`. |

## Events / imperative interop

| Hook | L | Does |
|---|---|---|
| `useTriliumEvent(name, handler)` | 33 | register one event handler on the nearest `ParentComponent`; auto-unregisters. |
| `useTriliumEvents(names, handler)` | 42 | register one handler for many events (handler gets `(data, eventName)`). |
| `useLegacyImperativeHandlers(handlers)` | 1062 | expose imperative methods on the host legacy component (so legacy callers can invoke them). |
| `useLegacyWidget(factory, opts)` | 829 | embed a jQuery `BasicWidget`/`NoteContextAwareWidget`; returns `[VNode, widget]`; bridges `child()`/`render()`/`activeContextChanged`. **The only sanctioned bridge to old widgets.** |
| `useSyncedRef(externalRef?, initial?)` | 1069 | merge an external ref with an internal one. |

## Keyboard & shortcuts

| Hook | L | Does |
|---|---|---|
| `useKeyboardShortcuts(scope, containerRef, parentComponent, ntxId)` | 1249 | bind a note-type scope's actions (`code-detail`/`text-detail`) to a container; unbinds on cleanup. |
| `useGlobalShortcut(shortcut, handler)` | 1269 | register a global shortcut under a random namespace. |

## Tooltips

| Hook | L | Does |
|---|---|---|
| `useTooltip(elRef, config)` | 964 | Bootstrap tooltip with imperative `{ showTooltip, hideTooltip }`. |
| `useStaticTooltip(elRef, config?)` | 1012 | tooltip with no imperative API; auto-hides siblings. |
| `useStaticTooltipWithKeyboardShortcut(elRef, title, actionName, opts?)` | 1047 | static tooltip whose title appends the action's effective shortcut. |

## DOM / observers / sizing / navigation

| Hook | L | Does |
|---|---|---|
| `useElementSize(ref)` | 896 | element `DOMRect` via `ResizeObserver`. |
| `useWindowSize()` | 925 | `{ windowWidth, windowHeight }`, reacts to resize. |
| `useResizeObserver(ref, callback)` | 1234 | run a callback on element resize. |
| `useNoteTreeDrag(containerRef, opts)` | 1106 | drag-drop of notes onto a container (parses `DragData[]`). |
| `useLongPressContextMenu(handler, holdMs?)` | 1175 | right-click + touch long-press → context menu props to spread. |
| `useContainedLinkNavigation(containerRef, onNavigate)` | 1714 | keep internal note-link clicks inside a popup/dialog instead of the global handler (capture-phase). |
| `useImperativeSearchHighlighlighting(tokens)` | 1083 | returns a fn that `mark.js`-highlights search tokens in an element. |
| `useMathRendering(containerRef, deps)` | 1663 | lazily KaTeX-render `.math-tex` elements (used by TOC/highlights sidebars). |

## Misc utilities

| Hook | L | Does |
|---|---|---|
| `useUniqueName(prefix?)` | 425 | stable random name for inputs (unique across tabbed widgets). |
| `useColorScheme()` | 1639 | `"dark" | "light"`, reacting to theme + `prefers-color-scheme`. |
| `useDelayedVisibility(active, opts?)` | 1766 | flicker-free loading phase `"hidden" | "visible" | "stalled"` (grace + min-visible + stall escalation). |

---

**Testing these hooks:** see the **writing-unit-tests** skill — render via raw `preact` `render()` into happy-dom, drive entity changes with the easy-froca fixtures, and prefer extracting pure decision logic out of a component into a top-level `export function` to test directly.
