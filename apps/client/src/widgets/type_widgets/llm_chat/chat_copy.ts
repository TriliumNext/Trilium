import { t } from "../../../services/i18n.js";
import toast from "../../../services/toast.js";
import utils from "../../../services/utils.js";
import { renderMarkdown } from "./chat_markdown.js";

/**
 * Whether the "Copy message" command should be offered for a right-clicked message: only with no
 * active text selection (a selection means the selection commands apply) and only when the message
 * actually has text. Unlike saving to a sub-note, copying needs no parent note, so it works in both
 * the note chat and the right-pane sidebar chat.
 */
export function canCopyMessage(hasSelection: boolean, markdown: string): boolean {
    return !hasSelection && markdown.trim().length > 0;
}

/**
 * Copy a whole message to the clipboard: rich HTML (rendered from the markdown, so it pastes with
 * formatting into a note or other rich editor) plus the markdown source as the plain-text fallback.
 */
export function copyMessageToClipboard(markdown: string) {
    const ok = utils.copyHtmlToClipboard(renderMarkdown(markdown), markdown);
    if (ok) {
        toast.showMessage(t("clipboard.copy_success"));
    } else {
        toast.showError(t("clipboard.copy_failed"));
    }
}
