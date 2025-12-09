import { t } from "./i18n.js";
import toastService, { showError } from "./toast.js";

export function copyImageReferenceToClipboard($imageWrapper: JQuery<HTMLElement>) {
    try {
        $imageWrapper.attr("contenteditable", "true");
        selectImage($imageWrapper.get(0));

        const success = document.execCommand("copy");

        if (success) {
            toastService.showMessage(t("image.copied-to-clipboard"));
        } else {
            const message = t("image.cannot-copy");
            showError(message);
            logError(message);
        }
    } finally {
        window.getSelection()?.removeAllRanges();
        $imageWrapper.removeAttr("contenteditable");
    }
}

function selectImage(element: HTMLElement | undefined) {
    if (!element) {
        return;
    }

    const selection = window.getSelection();
    const range = document.createRange();
    range.selectNodeContents(element);
    selection?.removeAllRanges();
    selection?.addRange(range);
}

export default {
    copyImageReferenceToClipboard
};
