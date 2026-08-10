import { Modal as BootstrapModal } from "bootstrap";

/** Bootstrap's private focus-trap, reachable via `Modal._focustrap` (see {@link suspendModalFocusTraps}). */
interface BootstrapFocusTrap {
    activate(): void;
    deactivate(): void;
    _isActive: boolean;
}

/**
 * Suspends the focus-traps of every currently-shown modal (optionally excluding {@link exceptElement}),
 * returning a function that reactivates exactly those that were suspended.
 *
 * Bootstrap activates a document-wide `focusin` focus-trap on each modal opened with `focus: true`, and
 * that trap yanks focus back to its own modal whenever focus lands elsewhere ({@link https://github.com/twbs/bootstrap/blob/main/js/src/util/focustrap.js focustrap.js}).
 * That fights UI a modal genuinely owns but which renders outside its DOM:
 *
 * - **Stacked modals** — Bootstrap has no stacked-modal support, so an underlying modal's trap fights the
 *   modal stacked on top of it (e.g. the custom-dictionary editor in the quick-edit popup that opens over
 *   the Options dialog gets no cursor). Each modal, on show, calls this with itself as `exceptElement` to
 *   suspend the traps of the modals below it, restoring them on close.
 * - **Portaled dropdowns** — a dropdown menu portaled to `document.body` (e.g. the note-icon picker) lives
 *   outside the modal that opened it, so its search input immediately loses focus. The dropdown suspends
 *   every shown modal's trap while open (no exception, since it floats above the whole stack).
 *
 * Because only currently-active traps are captured, restoring re-establishes the invariant at every stack
 * depth. Reaches into `Modal._focustrap` since Bootstrap exposes no public API for this.
 */
export function suspendModalFocusTraps(exceptElement?: HTMLElement | null): () => void {
    const suspended: BootstrapFocusTrap[] = [];
    for (const modalElement of document.querySelectorAll<HTMLElement>(".modal.show")) {
        if (modalElement === exceptElement) continue;

        const instance = BootstrapModal.getInstance(modalElement) as (BootstrapModal & { _focustrap?: BootstrapFocusTrap }) | null;
        const focustrap = instance?._focustrap;
        if (focustrap?._isActive) {
            focustrap.deactivate();
            suspended.push(focustrap);
        }
    }

    return () => {
        for (const focustrap of suspended) {
            focustrap.activate();
        }
    };
}
