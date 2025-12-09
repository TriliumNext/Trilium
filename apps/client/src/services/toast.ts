import { signal } from "@preact/signals";

import utils from "./utils.js";

export interface ToastOptions {
    id?: string;
    icon: string;
    title?: string;
    message: string;
    timeout?: number;
    progress?: number;
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

//#region Toast store
export const toasts = signal<ToastOptionsWithRequiredId[]>([]);

function addToast(opts: ToastOptions) {
    const id = opts.id ?? crypto.randomUUID();
    const toast = { ...opts, id };
    toasts.value = [ ...toasts.value, toast ];
    return id;
}

function updateToast(id: string, partial: Partial<ToastOptions>) {
    toasts.value = toasts.value.map(toast => {
        if (toast.id === id) {
            return { ...toast, ...partial }
        }
        return toast;
    });
}

export function removeToastFromStore(id: string) {
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
