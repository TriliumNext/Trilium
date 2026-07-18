import { signal } from "@preact/signals";

import { t } from "./i18n.js";
import utils, { randomString } from "./utils.js";

/** A note rendered as a reference link in a toast body, with an optional annotation. */
export interface ToastNoteReference {
    noteId: string;
    /** Short muted text rendered next to the link — e.g. why this note is being surfaced. */
    description?: string;
}

export interface ToastOptions {
    id?: string;
    icon: string;
    title?: string;
    message: string;
    /** When `true`, the {@link message} is rendered in a monospace font — e.g. a raw error string. */
    messageMonospace?: boolean;
    timeout?: number;
    progress?: number;
    /**
     * When `false`, the toast renders without its close (×) button so the user can't dismiss it. Use for
     * persistent in-progress toasts whose underlying operation keeps running regardless of the toast — a
     * dismissable × there reads as "cancel", which it isn't. Defaults to dismissable.
     */
    dismissible?: boolean;
    /**
     * When `true`, the toast renders with a wider maximum width than the default. Use for toasts with
     * richer content — e.g. a {@link notes} reference-link list — that reads poorly cramped.
     */
    wide?: boolean;
    /**
     * Notes to render as reference links in the toast body — e.g. the notes an action affected or that
     * triggered the message. Each is shown with its icon and title and navigates to the note on click.
     * A plain string is shorthand for a {@link ToastNoteReference} without annotation.
     */
    notes?: (string | ToastNoteReference)[];
    /** Optional heading rendered above the {@link notes} reference-link list. */
    notesHeading?: string;
    /**
     * Invoked once when the toast is removed, whether it auto-hid after its timeout or was dismissed by the
     * user. Useful for resetting state that accumulated while the toast was live (see {@link notes}).
     */
    onRemove?: () => void;
    buttons?: {
        text: string;
        onClick: (api: { dismissToast: () => void }) => void;
    }[];
}

export type ToastOptionsWithRequiredId = Omit<ToastOptions, "id"> & Required<Pick<ToastOptions, "id">>;

function showPersistent(options: ToastOptionsWithRequiredId) {
    const existingToast = toasts.value.find(toast => toast.id === options.id);
    if (existingToast) {
        updateToast(options.id, options);
    } else {
        addToast(options);
    }
}

function closePersistent(id: string) {
    removeToastFromStore(id);
}

function showMessage(message: string, timeout = 2000, icon = "bx bx-check") {
    console.debug(utils.now(), "message:", message);

    addToast({
        icon,
        message,
        timeout
    });
}

export function showError(message: string, timeout = 10000) {
    console.log(utils.now(), "error: ", message);

    addToast({
        icon: "bx bx-error-circle",
        message,
        timeout
    });
}

function showErrorTitleAndMessage(title: string, message: string, timeout = 10000) {
    console.log(utils.now(), "error: ", message);

    addToast({
        title,
        icon: "bx bx-error-circle",
        message,
        timeout
    });
}

export function showErrorForScriptNote(noteId: string, message: string, opts?: { monospace?: boolean }) {
    showPersistent({
        id: `custom-widget-failure-${noteId}`,
        title: t("toast.scripting-error"),
        icon: "bx bx-error-circle",
        message,
        // Raw error strings are shown verbatim, so render them monospace.
        messageMonospace: opts?.monospace,
        // The script note is shown as a reference link (icon + title, click to navigate) rather
        // than a bespoke "open note" button; ctrl/middle-click still opens it in a new tab.
        notes: [ noteId ],
        timeout: 15_000
    });
}

//#region Toast store
export const toasts = signal<ToastOptionsWithRequiredId[]>([]);

function addToast(opts: ToastOptions) {
    const id = opts.id ?? randomString();
    const toast = { ...opts, id };
    toasts.value = [ ...toasts.value, toast ];
    return id;
}

function updateToast(id: string, partial: Partial<ToastOptions>) {
    toasts.value = toasts.value.map(toast => {
        if (toast.id === id) {
            return { ...toast, ...partial };
        }
        return toast;
    });
}

export function removeToastFromStore(id: string) {
    // Centralized removal point, so onRemove fires exactly once regardless of the removal path
    // (auto-hide timeout, close button, or closePersistent). find-then-filter guards against a
    // double fire when both the timeout and a manual dismiss race for the same id.
    const removed = toasts.value.find(toast => toast.id === id);
    if (!removed) {
        return;
    }
    removed.onRemove?.();
    toasts.value = toasts.value.filter(toast => toast.id !== id);
}
//#endregion

export default {
    showMessage,
    showError,
    showErrorTitleAndMessage,
    showPersistent,
    closePersistent
};
