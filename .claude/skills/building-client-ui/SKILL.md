---
name: building-client-ui
description: Use when building or changing Trilium client UI in apps/client/src/widgets — a Preact component or dialog, reading/writing a note's title/label/relation/blob/option, reacting to entity changes, or embedding a legacy widget. Covers the froca-reactive hooks (useNoteProperty/useNoteLabel/useNoteBlob/useChildNotes/useTriliumOption/useNoteContext) and which loadResults filter each already wires, the reusable component + per-component-CSS rules, and the event-summoned Modal/LazyDialog dialog wiring (including the mandatory layout_commons.tsx registration). Read it instead of re-deriving useState+server.get+entitiesReloaded plumbing, hand-rolling HTML, or copying the dead jQuery widget lifecycle.
---

# Building client UI in Trilium

**Don't reinvent froca-reactive state.** The single most common mistake on this surface is writing `useState` + `server.get`/`froca` + a hand-rolled `entitiesReloaded` listener for something a **one-line hook already does** — and does correctly, with the right reload filter, the right echo-suppression, and the stale-request guard you forgot. `apps/client/src/widgets/react/hooks.tsx` exports **54** `use*` hooks (verified: `grep -cE "^export function use"`). Reach for the catalog *first*: [references/hooks-catalog.md](references/hooks-catalog.md).

The client migrated off the jQuery widget system to a Preact-hooks model. New UI is a `.tsx` component using those hooks plus the reusable components in `apps/client/src/widgets/react/` (49 `.tsx` there). The hooks are heavily used and battle-tested — invocations in `apps/client/src` (`grep -rhoE "\buseX\("`, minus the one definition): `useTriliumOption` ~70, `useNoteLabel` ~65, `useNoteProperty` ~48, `useNoteContext` ~36, `useNoteBlob` 9, `useChildNotes` 6. (A plain `grep -c useX` reports ~2× more — it also counts imports, doc-comments, and the `*Bool`/`*Int` family.)

> **CLAUDE.md still foregrounds the dead jQuery lifecycle** (`doRenderBody`/`refreshWithNote`/`this.$widget`). Ignore it for new code. Use `useLegacyWidget` *only* to embed an existing jQuery widget into a Preact tree.

## 1. Which hook for which job (don't re-derive)

| You need… | Use | It already wires |
|---|---|---|
| a scalar `FNote` field (title, isProtected, type, mime) | `useNoteProperty(note, "title", componentId)` | `loadResults.isNoteReloaded(noteId, componentId)` (hooks.tsx:624) |
| a label value (read/write) | `useNoteLabel` / `…Boolean` / `…Int` / `…WithDefault` / `…OptionalBool` | `getAttributeRows()` + `attributes.isAffecting(attr, note)` — handles inheritance/templates (hooks.tsx:688) |
| a relation (read/write / resolve target) | `useNoteRelation` / `useNoteRelationTarget` | same attribute filter (hooks.tsx:638) |
| note binary content / blob | `useNoteBlob(note, componentId, { reportLoadStateTo })` | `isNoteContentReloaded` + explicit delete check + requestId stale-guard (hooks.tsx:809) |
| child notes / subtree | `useChildNotes(parentNoteId)` | `getBranchRows()` parent match + `frocaReloaded` (hooks.tsx:1373) |
| an `FNote` by id | `useNote` / `useNoteTitle` / `useNoteIcon` / `useNoteColorClass` | cache-first + reload filter |
| a synced option (read/write) | `useTriliumOption` / `…Bool` / `…Int` / `…Json` / `useTriliumOptions` | `getOptionNames()` (hooks.tsx:333) |
| the split's note context | `useNoteContext()` | setNoteContext/noteSwitched/frocaReloaded/hoisted/readOnly |
| the *active* (focused) context | `useActiveNoteContext()` | same + re-resolves notePath when the note is moved (hooks.tsx:583) |
| read-only / temp-editable state | `useIsNoteReadOnly` / `useEffectiveReadOnly` | `readOnly` label + `readOnlyTemporarilyDisabled` |
| editor autosave plumbing | `useEditorSpacedUpdate` / `useBlobEditorSpacedUpdate` | spaced-update + provenance guard for #9614 (hooks.tsx:119) |
| publish/consume cross-widget data | `useSetContextData` / `useGetContextData` | `contextDataChanged` |
| a raw Trilium event | `useTriliumEvent` / `useTriliumEvents` | registerHandler/removeHandler on `ParentComponent` (hooks.tsx:33) |
| embed a legacy jQuery widget | `useLegacyWidget` | `child()`/`render()`/`activeContextChanged` bridge (hooks.tsx:829) |

Full 54-hook list grouped by purpose: [references/hooks-catalog.md](references/hooks-catalog.md).

## 2. The `entitiesReloaded` filter taxonomy (the subtle part)

If you genuinely must hand-write `useTriliumEvent("entitiesReloaded", ({ loadResults }) => …)`, pick the **right predicate** — the wrong one silently never fires:

| Changed | Predicate | Source |
|---|---|---|
| note row or its attributes | `loadResults.isNoteReloaded(noteId, componentId)` | load_results.ts:188 |
| blob / content (NOT the note row) | `loadResults.isNoteContentReloaded(noteId, componentId)` | load_results.ts:201 |
| a label/relation | iterate `loadResults.getAttributeRows()`, keep `attributes.isAffecting(attr, note)` | load_results.ts:162 / attributes.ts:140 |
| children added/removed/moved | `loadResults.getBranchRows()` (match `parentNoteId`) | load_results.ts:139 |
| options | `loadResults.getOptionNames()` | load_results.ts:217 |
| whole cache swapped (e.g. protected session) | separate `frocaReloaded` event — re-read FNote refs, old ones are orphaned | — |

Two things people get wrong:
- **`isNoteReloaded` ≠ `isNoteContentReloaded`.** Note row/attrs vs blob/content are tracked in *separate* maps. Using `isNoteReloaded` to refresh content (or vice-versa) compiles, runs, and never updates.
- **Attribute ownership is not `attr.noteId === note.noteId`.** `isAffecting` (attributes.ts:140) walks `getNotesToInheritAttributesFrom()` and, for inheritable attrs, `hasAncestor()` — so a naive id equality check misses inherited/templated attributes. Always use `isAffecting`.

Always pass **`componentId`** when the same component both saves and listens. `isNoteReloaded`/`isNoteContentReloaded` skip the originating component (load_results.ts:194, 206), so without it the widget gets its own save echoed back and clobbers fresher user-typed input.

## 3. Reusable components (don't hand-roll HTML)

Before writing an `<input>`/`<select>`/`<button>`, check the catalog: [references/components.md](references/components.md). High-use ones: `Button`/`ActionButton`/`LinkButton`, `FormTextBox`(+`WithUnit`)/`FormTextArea`/`FormSelect`/`FormCheckbox`/`FormRadioGroup`/`FormToggle`/`Slider`/`FormGroup`, `NoItems`, `Icon`, `Modal`, `Dropdown`, `Card`/`Badge`/`Admonition`/`Alert`/`InfoBar`, `NoteLink`/`NoteAutocomplete`/`NoteList`, `Collapsible`, `LoadingSpinner`.

Three rules, enforced (from CLAUDE.md):
1. **No Bootstrap utility classes** (`form-control-sm`, `form-select-sm`, `input-group`) on the `Form*` components — they render their own `form-control`/`form-select` and your override fights them.
2. **No inline `style` for static layout** — only a genuinely computed dynamic value belongs in `style`.
3. **Per-component CSS, scoped by root class.** Each component has a sibling `.css` imported at the top (`import "./NoItems.css"`, NoItems.tsx:1) and its rules nested under a root class (no CSS modules here).

## 4. Dialog recipe (Modal + LazyDialog)

Dialogs are **event-summoned** and **lazy-mounted**. Worked example: `apps/client/src/widgets/dialogs/sort_child_notes.tsx`.

1. **State:** `const [ shown, setShown ] = useState(false);`
2. **Summon:** `useTriliumEvent("yourEvent", (data) => { …; setShown(true); });` (sort_child_notes.tsx:21)
3. **Render** a controlled `<Modal>`:
   ```tsx
   <Modal
       className="your-dialog"          // static literal — Bootstrap mutates classList (fade/show)
       show={shown}
       onHidden={() => setShown(false)} // MANDATORY — see below
       onSubmit={onSubmit}              // optional: wraps body in a form, Enter submits
       title={t("…")} size="lg"
   >…</Modal>
   ```
4. **Register it** in `applyModals()` in `apps/client/src/layouts/layout_commons.tsx`:
   ```tsx
   .child(<LazyDialog triggerEvents={["yourEvent"]} loader={() => import("../widgets/dialogs/your.js")} />)
   ```
   Skip this and **nothing summons the dialog** — the event has no listener and the modal never mounts.
5. **Eager (un-lazy) only for the 3 documented exceptions** (layout_commons.tsx:41-47): `PopupEditor` (`keepInDom`), `CallToAction` (no summon event), `Toast` (needed at startup).

Two Modal footguns (Modal.tsx):
- **`onHidden` is required and must `setShown(false)`** (doc comment Modal.tsx:48-53). Bootstrap closing the modal (backdrop/close/submit) does **not** touch React state; if `show` stays `true`, the next `show=true` is a no-op and the dialog can't reopen.
- **Keep `className` a static string.** It's rendered as `` `modal fade mx-auto ${className}` `` (Modal.tsx:157) and Bootstrap toggles `fade`/`show` on that same element, so a dynamic className fights it.

Full prop reference, LazyDialog mechanics, and the eager-exception rationale: [references/dialogs.md](references/dialogs.md).

## 5. Footgun checklist

- **Reinventing a hook.** `useState` + `server.get` + manual `entitiesReloaded` listener that a hook in hooks.tsx already provides. Check the catalog.
- **Wrong reload predicate.** `isNoteReloaded` (row/attrs) vs `isNoteContentReloaded` (blob) vs `getAttributeRows()+isAffecting` (labels/relations, incl. inherited) vs `getBranchRows()` (children) vs `getOptionNames()`.
- **Omitting `componentId`.** The saving widget echoes its own change back and overwrites fresher input.
- **Dialog registered but not wired.** No `<LazyDialog triggerEvents={…}>` in `applyModals()` → the summon event has no listener → silent no-op.
- **Modal can't reopen.** Missing/empty `onHidden`, or a dynamic `className` fighting Bootstrap's `fade`/`show`.
- **Bootstrap utility classes / inline static styles on `Form*` components.** Use the sibling per-component `.css` scoped under a root class.
- **Copying the dead jQuery lifecycle** (`doRenderBody`/`refreshWithNote`/`this.$widget`) into new `.tsx`. Use `useLegacyWidget` only to embed an existing widget.
- **Stale closures.** An inline event handler closing over state with a wrong/empty dep array. Follow the hooks' `useCallback`-refresh pattern, or just use the hook.

> Not a footgun here: `isElectron()` / `isMac()` from `apps/client/src/services/utils.ts` are runtime checks (`"electronApi" in window` at utils.ts:123, `navigator.platform` at utils.ts:149) and are safe at module load. The "call only after init" trap is a **trilium-core** concern (`utils/index.ts` → `getPlatform()`), not client UI.

## Reference map

| File | Read it for |
|---|---|
| [references/hooks-catalog.md](references/hooks-catalog.md) | All 54 `use*` hooks grouped by purpose, one line each with the `loadResults` filter it wires — the anti-re-derivation asset. |
| [references/dialogs.md](references/dialogs.md) | Full `Modal` prop reference, the 5-step summon→register recipe, `LazyDialog` mechanics, the 3 eager exceptions, the `sort_child_notes.tsx` walkthrough. |
| [references/components.md](references/components.md) | Reusable component catalog with when-to-use, plus the no-Bootstrap-utility / no-inline-style / per-component-CSS rules and a good/bad example. |

Related skills: **writing-unit-tests** (how to render these components and test the hooks with the easy-froca fixtures; the `CoreApiTester` pattern lives there too), **analyzing-coverage** (measuring client coverage). For CKEditor-backed note types see the **trilium-ckeditor5-integration** skill.
