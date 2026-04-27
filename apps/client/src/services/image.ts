import { t } from "./i18n.js";
import toastService, { showError } from "./toast.js";
import utils from "./utils.js";

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

export async function copyImageElementToClipboard(imageElement: HTMLImageElement) {
    try {
        const canvas = document.createElement("canvas");
        const width = imageElement.naturalWidth || imageElement.width;
        const height = imageElement.naturalHeight || imageElement.height;

        if (!width || !height) {
            return false;
        }

        canvas.width = width;
        canvas.height = height;

        const context = canvas.getContext("2d");
        if (!context) {
            return false;
        }

        context.drawImage(imageElement, 0, 0, width, height);

        if (utils.isElectron()) {
            const { clipboard, nativeImage } = utils.dynamicRequire("electron");
            clipboard.writeImage(nativeImage.createFromDataURL(canvas.toDataURL("image/png")));
            return true;
        }

        if (!navigator.clipboard?.write || typeof ClipboardItem === "undefined") {
            return false;
        }

        const blob = await new Promise<Blob | null>(resolve => canvas.toBlob(resolve, "image/png"));
        if (!blob) {
            return false;
        }

        await navigator.clipboard.write([
            new ClipboardItem({
                [blob.type]: blob
            })
        ]);

        return true;
    } catch (error) {
        console.error("Failed to copy image to clipboard:", error);
        return false;
    }
}

export default {
    copyImageReferenceToClipboard,
    copyImageElementToClipboard
};
