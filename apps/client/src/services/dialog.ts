import type { NotePickerDialogOptions } from "../widgets/dialogs/note_picker.js";
import { Modal } from "bootstrap";

import appContext from "../components/app_context.js";
import type { ConfirmDeleteNoteBoxOptions, ConfirmDialogOptions, ConfirmDialogResult, ConfirmWithMessageOptions, MessageType } from "../widgets/dialogs/confirm.js";
import { InfoExtraProps } from "../widgets/dialogs/info.jsx";
import type { ItemPickerDialogOptions, PickerItem } from "../widgets/dialogs/item_picker.js";
import type { PromptDialogOptions } from "../widgets/dialogs/prompt.js";
import { focusSavedElement, saveFocusedElement } from "./focus.js";
import keyboardActionsService from "./keyboard_actions.js";
import type { NoteDeletionTarget } from "./note_deletion.js";

/**
 * @param declaredZIndex the z-index the dialog defines for itself, if any (see {@link raiseAboveStackedPopup}).
 */
export async function openDialog($dialog: JQuery<HTMLElement>, closeActDialog = true, config?: Partial<Modal.Options>, declaredZIndex?: number) {
    if (closeActDialog) {
        closeActiveDialog();
        glob.activeDialog = $dialog;
    }

    saveFocusedElement();

    // Lift this dialog above whatever is already open, if anything is (see raiseAboveWhatIsOpen).
    const bumpedZIndex = raiseAboveWhatIsOpen($dialog[0], declaredZIndex);

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

    // After that normalising, which is written for a backdrop hanging at the end of the page and
    // would undo the layer this gives it there.
    showAboveWhateverHasTheScreen($dialog[0]);

    $dialog.on("hidden.bs.modal", () => {
        sendDialogHome($dialog[0]);

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

/** Where a dialog stands while nothing has the screen, what came with it, and how to stop watching. */
const dialogHomes = new WeakMap<HTMLElement, {
    parent: Node;
    nextTo: Node | null;
    backdrop: HTMLElement | null;
    stopWatching: () => void;
}>();

/**
 * Puts a dialog where it can be seen and used over an element that has the screen to itself.
 *
 * A browser showing an element fullscreen draws that element and nothing else, and hands it every
 * press. A dialog lives in the shell rather than inside whatever was given the screen, so over a
 * fullscreen map or diagram (see `useFullscreen`) it was opened, focused and typed into while nothing
 * of it was ever painted — the quick editor reached for from a marker's preview simply swallowed the
 * click. Hosting it inside whatever is being shown puts it back on the screen and back in the way of
 * the pointer, exactly as the context menu is (see `hostInWhateverHasTheScreen`).
 *
 * Raising it into the top layer as a popover looks like the tidier answer and is not one: it is
 * painted there, above the fullscreen element, but every press still goes to the element underneath —
 * a dialog you can read and not use, which is worse than one you cannot see.
 *
 * The dialog is positioned against the viewport either way, so nothing about where it lands changes;
 * its backdrop goes with it, being at the end of the page too, and Bootstrap takes that away itself
 * whatever it is a child of.
 */
function showAboveWhateverHasTheScreen(dialogEl: HTMLElement) {
    const shownOver = document.fullscreenElement;
    const parent = dialogEl.parentNode;
    if (!shownOver || !parent || shownOver.contains(dialogEl)) {
        return;
    }

    // The screen may be given back while the dialog is still open — by pressing Escape, which the
    // browser answers itself — and the dialog belongs in the shell again the moment it is.
    const sendHomeOnScreenChange = () => sendDialogHome(dialogEl);
    document.addEventListener("fullscreenchange", sendHomeOnScreenChange);

    const backdrops = document.querySelectorAll<HTMLElement>(".modal-backdrop");
    const ownBackdrop = backdrops[backdrops.length - 1] ?? null;

    dialogHomes.set(dialogEl, {
        parent,
        nextTo: dialogEl.nextSibling,
        backdrop: ownBackdrop,
        stopWatching: () => document.removeEventListener("fullscreenchange", sendHomeOnScreenChange)
    });

    shownOver.appendChild(dialogEl);

    if (ownBackdrop) {
        // The dim comes along, ahead of the dialog rather than behind it, and on no layer of its
        // own. Bootstrap's 1050 would put it *over* a dialog the theme has lowered (a quick editor
        // sits at 999), which is a sheet of grey across the very thing that was opened; and reading
        // the dialog's own layer here is no answer either, since the rule that lowers it hangs on a
        // class the page has yet to be given. Standing first among equals settles it without a
        // number: the backdrop covers the map, being later in the page than the map is, and every
        // dialog worth the name is on a layer above zero.
        shownOver.insertBefore(ownBackdrop, dialogEl);
        ownBackdrop.style.zIndex = "0";
    }
}

/** Puts a dialog back where it was built. See {@link showAboveWhateverHasTheScreen}. */
function sendDialogHome(dialogEl: HTMLElement) {
    const home = dialogHomes.get(dialogEl);
    if (!home) return;

    dialogHomes.delete(dialogEl);
    home.stopWatching();
    home.parent.insertBefore(dialogEl, home.nextTo);

    if (home.backdrop) {
        // Back to the end of the page, where the rules that dress a backdrop can reach it again —
        // and without the layer it was lent, which the next open would otherwise inherit.
        home.backdrop.style.zIndex = "";
        document.body.appendChild(home.backdrop);
    }
}

export function closeActiveDialog() {
    if (glob.activeDialog) {
        Modal.getOrCreateInstance(glob.activeDialog[0]).hide();
        glob.activeDialog = null;
    }
}

/** Bootstrap's own modal layer, used by a dialog that declares no z-index. */
const STANDARD_MODAL_LAYER = 1055;

/** Self-managing popups (quick-edit, tree popup) set their own z-index via CSS; never lift them. */
const SELF_MANAGED_POPUP_SELECTOR = ".popup-editor-dialog, .tree-popup-editor-dialog";

/**
 * Raises a dialog above every modal already open, and returns the z-index it was given.
 *
 * Two cases need this. A quick-edit or tree popup stacked on a modal sits at 1100, above the
 * standard 1055, so a dialog opened from it renders behind. Two dialogs that declare the same
 * layer tie, and DOM order decides, which is not the dialog just opened.
 *
 * The z-index is rewritten on every open so a lift does not outlive it, and `declaredZIndex`
 * (`Modal`'s `zIndex` prop) is what an unlifted dialog falls back to. The caller matches the
 * backdrop to the result. Returns `null` when no lift is needed.
 */
function raiseAboveWhatIsOpen(dialogEl: HTMLElement, declaredZIndex?: number): number | null {
    const others = Array.from(document.querySelectorAll<HTMLElement>(".modal.show"))
        .filter((modal) => modal !== dialogEl);
    const maxZIndex = others.reduce((max, modal) => Math.max(max, parseInt(getComputedStyle(modal).zIndex, 10) || 0), 0);

    const hasStackedPopup = document.body.classList.contains("popup-editor-stacked")
        || document.body.classList.contains("tree-popup-stacked");
    // The layer this dialog uses on its own, which decides whether anything open covers it.
    const own = declaredZIndex ?? STANDARD_MODAL_LAYER;
    const isCovered = hasStackedPopup || maxZIndex >= own;

    if (!isCovered || dialogEl.matches(SELF_MANAGED_POPUP_SELECTOR)) {
        dialogEl.style.zIndex = declaredZIndex ? String(declaredZIndex) : "";
        return null;
    }

    // A dialog declaring a layer above everything open keeps it: the lift only raises.
    const zIndex = Math.max(maxZIndex + 10, own);
    dialogEl.style.zIndex = String(zIndex);
    return zIndex;
}

async function info(message: MessageType, extraProps?: InfoExtraProps) {
    return new Promise((res) => appContext.triggerCommand("showInfoDialog", { ...extraProps, message, callback: res }));
}

/**
 * Displays a confirmation dialog with the given message.
 *
 * @param message the message to display in the dialog. A string is rendered as HTML; pass an element
 *                where the wording needs structure the dialog should not have to parse — an
 *                admonition warning about what the action costs, say.
 * @returns A promise that resolves to true if the user confirmed, false otherwise.
 */
async function confirm(message: MessageType) {
    return new Promise<boolean>((res) =>
        appContext.triggerCommand("showConfirmDialog", <ConfirmWithMessageOptions>{
            message,
            callback: (x: false | ConfirmDialogOptions) => res(x && x.confirmed)
        })
    );
}

/**
 * Asks whether a note should be taken off whatever is showing it, offering to delete the note along
 * with it.
 *
 * Hand it the target and the dialog works out for itself what accepting that offer would cost — the
 * note deleted outright, or merely one of its places removed — and says so under the checkbox. What
 * comes back says only whether the reader agreed and whether they ticked the box; carrying it out is
 * the caller's, through `deleteNoteOrBranch` in note_deletion.ts with the same target.
 *
 * @param title the note's title, which the stock question names.
 * @param deletionTarget the note and the placement it is being removed from. See
 *                       {@link NoteDeletionTarget}.
 * @param options the question to ask in place of the stock one, and whether removing the note from
 *                here deletes it whether the reader likes it or not.
 */
async function confirmDeleteNoteBoxWithNote(title: string, deletionTarget?: NoteDeletionTarget, options?: ConfirmDeleteNoteBoxOptions) {
    return new Promise<ConfirmDialogResult | undefined>((res) => appContext.triggerCommand("showConfirmDeleteNoteBoxWithNoteDialog", { ...options, title, callback: res, deletionTarget }));
}

/** Asks for a note, resolving to its id or to null where the reader picked none. */
export async function chooseNote(props: Omit<NotePickerDialogOptions, "callback"> = {}) {
    return new Promise<string | null>((res) =>
        appContext.triggerCommand("showNotePickerDialog", { ...props, callback: res }));
}

/**
 * Picks one item out of many, grouped and searchable.
 *
 * Named for the one thing it does now: picking several at once is the same dialog with a different
 * answer, and will be a method of its own beside this.
 *
 * @returns what was picked, or nothing where the reader backed out.
 */
export async function pickSingleItem(props: Omit<ItemPickerDialogOptions, "callback">) {
    return new Promise<PickerItem | null>((res) =>
        appContext.triggerCommand("showItemPickerDialog", { ...props, callback: res }));
}

export async function prompt(props: PromptDialogOptions) {
    return new Promise<string | null>((res) => appContext.triggerCommand("showPromptDialog", { ...props, callback: res }));
}

export default {
    info,
    chooseNote,
    confirm,
    confirmDeleteNoteBoxWithNote,
    pickSingleItem,
    prompt
};
