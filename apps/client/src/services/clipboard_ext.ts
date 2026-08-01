import { t } from "./i18n.js";
import toast from "./toast.js";

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
 * Copies both an HTML and a plain-text representation to the clipboard, so pasting into
 * a rich-text editor (e.g. CKEditor) preserves formatting (links, images) while pasting
 * into a plain-text field falls back to readable text.
 *
 * Uses the `copy` event's `clipboardData.setData()` instead of the classic "select a hidden
 * DOM node, then execCommand('copy')" trick. The latter relies on each browser's own
 * selection-to-clipboard HTML serialization, which is inconsistent — in particular Firefox
 * does not reliably populate the `text/html` clipboard flavor that way, so pasted content
 * silently degrades to plain text. Writing the flavors directly during the `copy` event is
 * the documented cross-browser-reliable approach and does not require any selection at all.
 */
export function copyRichText(html: string, plainText: string): boolean {
    function listener(e: ClipboardEvent) {
        e.clipboardData?.setData("text/plain", plainText);
        e.clipboardData?.setData("text/html", html);
        e.preventDefault();
    }

    try {
        document.addEventListener("copy", listener);
        return document.execCommand("copy");
    } catch (e) {
        console.warn(e);
        return false;
    } finally {
        document.removeEventListener("copy", listener);
    }
}

export function copyRichTextWithToast(html: string, plainText: string) {
    if (copyRichText(html, plainText)) {
        toast.showMessage(t("clipboard.copy_success"));
    } else {
        toast.showError(t("clipboard.copy_failed"));
    }
}
