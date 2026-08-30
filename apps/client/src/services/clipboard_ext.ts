import { t } from "./i18n.js";
import toast from "./toast.js";
import utils from "./utils.js";

export function copyText(text: string) {
    if (!text) {
        return;
    }
    try {
        if (navigator.clipboard) {
            navigator.clipboard.writeText(text);
            return true;
        } 
        // Fallback method: https://stackoverflow.com/a/72239825
        const textArea = document.createElement("textarea");
        textArea.value = text;
        try {
            document.body.appendChild(textArea);
            textArea.focus();
            textArea.select();
            return document.execCommand('copy');
        } finally {
            document.body.removeChild(textArea);
        }
        
    } catch (e) {
        console.warn(e);
        return false;
    }
}

export function copyTextWithToast(text: string) {
    if (copyText(text)) {
        toast.showMessage(t("clipboard.copy_success"));
    } else {
        toast.showError(t("clipboard.copy_failed"));
    }
}

/**
 * Copies rich HTML — so it pastes with formatting into a note or another rich editor — with
 * `plainText` as the plain-text alternative. Returns whether the clipboard was written.
 *
 * `navigator.clipboard.write()` is the richer path but browsers expose it only in secure contexts,
 * and Trilium is routinely served over plain HTTP on a LAN, where the API is simply undefined
 * (#10723). The copy event is the fallback there, and also when the write is denied.
 */
export async function copyHtml(html: string, plainText: string = html) {
    if (navigator.clipboard?.write && typeof ClipboardItem !== "undefined") {
        try {
            await navigator.clipboard.write([
                new ClipboardItem({
                    "text/html": new Blob([html], { type: "text/html" }),
                    "text/plain": new Blob([plainText], { type: "text/plain" })
                })
            ]);

            return true;
        } catch (e) {
            // A denied permission or an unfocused document still leaves the copy event to try.
            console.warn(e);
        }
    }

    try {
        return utils.copyHtmlToClipboard(html, plainText);
    } catch (e) {
        console.warn(e);
        return false;
    }
}

/**
 * Copies rich HTML as {@link copyHtml} does and reports the outcome as a toast.
 */
export async function copyHtmlWithToast(html: string, plainText: string = html) {
    if (await copyHtml(html, plainText)) {
        toast.showMessage(t("clipboard.copy_success"));
    } else {
        toast.showError(t("clipboard.copy_failed"));
    }
}
