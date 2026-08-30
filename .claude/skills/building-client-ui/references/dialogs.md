# Dialogs — `Modal` + `LazyDialog`

Dialogs in the main window are **event-summoned** and **lazy-mounted**. You write a self-contained `.tsx` component that renders a controlled `<Modal>`, then register it once in `applyModals()`. Until its summon event first fires, neither the component nor its module graph is loaded.

Files: `apps/client/src/widgets/react/Modal.tsx`, `apps/client/src/layouts/layout_commons.tsx`, worked example `apps/client/src/widgets/dialogs/sort_child_notes.tsx`.

## The 5-step recipe

1. **Local `shown` state.** `const [ shown, setShown ] = useState(false);`
2. **Summon handler.** `useTriliumEvent("yourEvent", (data) => { /* stash data */ setShown(true); });` — the event carries any inputs and callbacks.
3. **Render a controlled `<Modal>`** with `show={shown}`, `onHidden={() => setShown(false)}`, and a **static** `className`.
4. **Register in `applyModals()`** (`layout_commons.tsx`) as `<LazyDialog triggerEvents={["yourEvent"]} loader={() => import("../widgets/dialogs/your.js")} />`. **Without this the dialog never mounts** — nothing listens for the summon event.
5. **Trigger it** from anywhere via `appContext.triggerCommand("yourEvent", …)` / `triggerEvent`.

### Worked example (`sort_child_notes.tsx`, abridged)

```tsx
export default function SortChildNotesDialog() {
    const [ parentNoteId, setParentNoteId ] = useState<string>();
    const [ shown, setShown ] = useState(false);

    useTriliumEvent("sortChildNotes", ({ node, noteId }) => {
        const targetNoteId = noteId ?? node?.data.noteId;
        if (!targetNoteId) return;
        setParentNoteId(targetNoteId);
        setShown(true);                        // step 2
    });

    async function onSubmit() {
        await server.put(`notes/${parentNoteId}/sort-children`, { /* … */ });
        setShown(false);                       // close on success
    }

    return (
        <Modal
            className="sort-child-notes-dialog"   // static literal
            title={t("sort_child_notes.sort_children_by")}
            size="lg" maxWidth={500}
            onSubmit={onSubmit}                   // form + Enter-to-submit
            onHidden={() => setShown(false)}      // MANDATORY
            show={shown}
            footer={<Button text={t("sort_child_notes.sort")} keyboardShortcut="Enter" />}
        >
            {/* FormRadioGroup / FormCheckbox / FormTextBox … */}
        </Modal>
    );
}
```

Registration, one line in `applyModals()`:
```tsx
.child(<LazyDialog triggerEvents={["sortChildNotes"]} loader={() => import("../widgets/dialogs/sort_child_notes.js")} />)
```

## Two Modal footguns

- **`onHidden` is required and must `setShown(false)`.** Its doc comment says so explicitly. When Bootstrap closes the modal (close button, backdrop click, or submit) it fires `hidden.bs.modal` → `onHidden`, but does **not** touch your React state. If `show` stays `true`, the next `show=true` render is a no-op and the dialog cannot reopen.
- **Keep `className` a static string literal.** Modal renders the outer element as `` `modal fade mx-auto ${className}` `` and Bootstrap toggles `fade`/`show` on that **same** element. A dynamic className overwrites those classes on the next render and fights the transition.

## `Modal` prop reference

The full set is the `ModalProps` interface at the top of `Modal.tsx` (~28 props, each doc-commented). The ones that come up:

| Prop | Type | Notes |
|---|---|---|
| `className` | `string` (required) | static literal; appended to `modal fade mx-auto`. |
| `show` | `boolean` (required) | controlled visibility. |
| `onHidden` | `() => void` (required) | fired on any close; **must set `show` false**. |
| `title` | `string \| ComponentChildren` | string → `<h5 class="modal-title">`; node → rendered as-is. |
| `size` | `"xl" \| "lg" \| "md" \| "sm"` | maps to `modal-{size}`. |
| `onSubmit` | `() => void` | wraps body+footer in a `<form>`; Enter submits. |
| `onShown` | `() => void` | fired on `shown.bs.modal`. |
| `footer` | `ComponentChildren` | rendered in `.modal-footer`; the usual place for the submit `Button`. |
| `footerStyle` / `footerAlignment` | `CSSProperties` / `"right" \| "between"` | `"between"` sets `justify-content: space-between`. |
| `header` | `ComponentChildren` | extra header items beside the title. |
| `sidebar` / `hideSidebarHeader` | `ComponentChildren` / `boolean` | full-height left sidebar; switches to a horizontal split layout. |
| `helpPageId` | `string` | renders a `?` button opening in-app help. |
| `customTitleBarButtons` | `(CustomTitleBarButton \| null)[]` | extra header buttons. |
| `minWidth` / `maxWidth` / `zIndex` | `string` / `number` / `number` | sizing / stacking. |
| `scrollable` | `boolean` | scroll the body, keep header/footer fixed. |
| `stackable` | `boolean` | keep existing modals open instead of closing them (confirm dialogs). |
| `keepInDom` | `boolean` | stay mounted in the DOM when hidden (transitions / hover-preview latency). |
| `noFocus` | `boolean` | don't focus the modal after it shows. |
| `isFullPageOnMobile` | `boolean` | full-page presentation on mobile. |
| `modalRef` / `formRef` | `RefObject` | the underlying `<div>` / `<form>` (`formRef` only set with `onSubmit`). |
| `bodyStyle` | `CSSProperties` | style on `.modal-body`. |
| `ariaLabel` | `string` | accessible name for the dialog. |

## `LazyDialog` mechanics

`LazyDialog` is defined at the bottom of `layout_commons.tsx`; its doc comment is the authority. In short:

- `loader: () => Promise<{ default: ComponentType }>` — dynamic import of the dialog module; `triggerEvents: EventNames[]` — the events that summon it.
- The **first** matching event starts the import, guarded by a `loadStarted` ref so a second summons mid-load doesn't double-load (the `Component` state is still `undefined` then, so it can't short-circuit the load itself). Once loaded, the dialog stays mounted and handles further events directly.
- The buffered first event is **re-delivered through the subtree's host component in an effect**, because parent effects run *after* the children's — that ordering guarantees the dialog's own handlers are registered by the time the event arrives. Delivery also waits on the host component being available, since clearing `pendingEvent` early would drop the summons.
- **Limitation:** a second summons arriving while the module is still being fetched *replaces* the buffered event rather than queueing behind it.

## The eager (non-lazy) exceptions

Registered directly at the end of `applyModals()`, not wrapped in `LazyDialog`. Don't add another without an equally concrete reason:

| Component | Why eager |
|---|---|
| `PopupEditorDialog` | uses `keepInDom` for fast hover-preview latency; deferring its module defeats the purpose. |
| `CallToActionDialog` | has **no summon event** — it decides on startup whether to show itself, so there is nothing to lazily mount against. |
| `ToastContainer` | needed immediately and continuously to surface messages and errors, including those raised during startup. |
| `ShortcutHintsPanel` | a persistent panel fed by `useContextualShortcutHints`, not an event-summoned dialog. |
