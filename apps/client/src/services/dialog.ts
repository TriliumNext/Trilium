import { Modal } from "bootstrap";

import appContext from "../components/app_context.js";
import type { ConfirmDialogOptions, ConfirmDialogResult, ConfirmWithMessageOptions, MessageType } from "../widgets/dialogs/confirm.js";
import { InfoExtraProps } from "../widgets/dialogs/info.jsx";
import type { PromptDialogOptions } from "../widgets/dialogs/prompt.js";
import { focusSavedElement, saveFocusedElement } from "./focus.js";
import keyboardActionsService from "./keyboard_actions.js";

export async function openDialog($dialog: JQuery<HTMLElement>, closeActDialog = true, config?: Partial<Modal.Options>) {
    if (closeActDialog) {
        closeActiveDialog();
        glob.activeDialog = $dialog;
    }

    saveFocusedElement();

    // Lift this dialog above a stacked quick-edit / tree popup if one is open (see raiseAboveStackedPopup).
    const bumpedZIndex = raiseAboveStackedPopup($dialog[0]);

    Modal.getOrCreateInstance($dialog[0], config).show();

    // Normalise the just-shown dialog's backdrop z-index. Bootstrap appends the backdrop during
    // show(), and reuses the *same* element across shows of a kept-in-DOM modal — so a lift applied on
    // a previous open would otherwise persist as a stale inline z-index and leave the backdrop
    // floating above unrelated content on a later, non-lifted open. Always set it: raised alongside a
    // lifted dialog (so the popup behind is dimmed and click-blocked), or cleared back to the default
    // layer otherwise. Skipped when this dialog has no backdrop, so we never touch another modal's.
    if (config?.backdrop !== false) {
        const backdrops = document.querySelectorAll<HTMLElement>(".modal-backdrop");
        const ownBackdrop = backdrops[backdrops.length - 1];
        if (ownBackdrop) {
            ownBackdrop.style.zIndex = bumpedZIndex !== null ? String(bumpedZIndex - 1) : "";
        }
    }

    $dialog.on("hidden.bs.modal", () => {
        const $autocompleteEl = $(".aa-input");
        if ("autocomplete" in $autocompleteEl) {
            $autocompleteEl.autocomplete("close");
        }

        if (!glob.activeDialog || glob.activeDialog === $dialog) {
            focusSavedElement();
        }
    });

    keyboardActionsService.updateDisplayedShortcuts($dialog);

    return $dialog;
}

export function closeActiveDialog() {
    if (glob.activeDialog) {
        Modal.getOrCreateInstance(glob.activeDialog[0]).hide();
        glob.activeDialog = null;
    }
}

/** Self-managing popups (quick-edit, tree popup) set their own z-index via CSS; never lift them. */
const SELF_MANAGED_POPUP_SELECTOR = ".popup-editor-dialog, .tree-popup-editor-dialog";

/**
 * When a quick-edit / tree popup is stacked on top of another modal it sits at z-index 1100 — above
 * the standard dialog layer (1055). A dialog opened from within it (delete/confirm/prompt/…) would
 * then render *behind* the popup. Detect that case and give the incoming dialog an inline z-index
 * just above the current top-most modal so it clears the popup.
 *
 * Always clears any prior inline z-index first, so a dialog reused later in a non-stacked context
 * returns to the default layer. Returns the assigned z-index (for the caller to match the backdrop),
 * or `null` when no lift was applied.
 */
function raiseAboveStackedPopup(dialogEl: HTMLElement): number | null {
    // Reset any bump left over from a previous stacked open.
    dialogEl.style.zIndex = "";

    const hasStackedPopup = document.body.classList.contains("popup-editor-stacked")
        || document.body.classList.contains("tree-popup-stacked");
    if (!hasStackedPopup || dialogEl.matches(SELF_MANAGED_POPUP_SELECTOR)) {
        return null;
    }

    const others = Array.from(document.querySelectorAll<HTMLElement>(".modal.show"))
        .filter((modal) => modal !== dialogEl);
    const maxZIndex = others.reduce((max, modal) => Math.max(max, parseInt(getComputedStyle(modal).zIndex, 10) || 0), 0);

    const zIndex = maxZIndex + 10;
    dialogEl.style.zIndex = String(zIndex);
    return zIndex;
}

async function info(message: MessageType, extraProps?: InfoExtraProps) {
    return new Promise((res) => appContext.triggerCommand("showInfoDialog", { ...extraProps, message, callback: res }));
}

/**
 * Displays a confirmation dialog with the given message.
 *
 * @param message the message to display in the dialog.
 * @returns A promise that resolves to true if the user confirmed, false otherwise.
 */
async function confirm(message: string) {
    return new Promise<boolean>((res) =>
        appContext.triggerCommand("showConfirmDialog", <ConfirmWithMessageOptions>{
            message,
            callback: (x: false | ConfirmDialogOptions) => res(x && x.confirmed)
        })
    );
}

async function confirmDeleteNoteBoxWithNote(title: string) {
    return new Promise<ConfirmDialogResult | undefined>((res) => appContext.triggerCommand("showConfirmDeleteNoteBoxWithNoteDialog", { title, callback: res }));
}

export async function prompt(props: PromptDialogOptions) {
    return new Promise<string | null>((res) => appContext.triggerCommand("showPromptDialog", { ...props, callback: res }));
}

export default {
    info,
    confirm,
    confirmDeleteNoteBoxWithNote,
    prompt
};
