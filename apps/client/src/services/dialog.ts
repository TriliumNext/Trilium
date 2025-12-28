import { Modal } from "bootstrap";
import appContext from "../components/app_context.js";
import type { ConfirmDialogOptions, ConfirmDialogResult, ConfirmWithMessageOptions, MessageType } from "../widgets/dialogs/confirm.js";
import type { PromptDialogOptions } from "../widgets/dialogs/prompt.js";
import { focusSavedElement, saveFocusedElement } from "./focus.js";
import { InfoExtraProps } from "../widgets/dialogs/info.jsx";

export async function openDialog($dialog: JQuery<HTMLElement>, closeActDialog = true, config?: Partial<Modal.Options>) {
    if (closeActDialog) {
        closeActiveDialog();
        glob.activeDialog = $dialog;
    }

    saveFocusedElement();
    Modal.getOrCreateInstance($dialog[0], config).show();

    $dialog.on("hidden.bs.modal", () => {
        const $autocompleteEl = $(".aa-input");
        if ("autocomplete" in $autocompleteEl) {
            $autocompleteEl.autocomplete("close");
        }

        if (!glob.activeDialog || glob.activeDialog === $dialog) {
            focusSavedElement();
        }
    });

    const keyboardActionsService = (await import("./keyboard_actions.js")).default;
    keyboardActionsService.updateDisplayedShortcuts($dialog);

    return $dialog;
}

export function closeActiveDialog() {
    if (glob.activeDialog) {
        Modal.getOrCreateInstance(glob.activeDialog[0]).hide();
        glob.activeDialog = null;
    }
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
