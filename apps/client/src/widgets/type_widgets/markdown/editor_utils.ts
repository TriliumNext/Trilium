import type VanillaCodeMirror from "@triliumnext/codemirror";

import type FNote from "../../../entities/fnote";
import { t } from "../../../services/i18n";
import server from "../../../services/server";
import toast from "../../../services/toast";

/** Inserts text at the given position (or cursor) and moves the cursor to the end of the inserted text. */
export function insertText(view: VanillaCodeMirror, text: string, pos?: number) {
    const from = pos ?? view.state.selection.main.head;
    view.dispatch({
        changes: { from, insert: text },
        selection: { anchor: from + text.length }
    });
}

/** Replaces the selection range with text and moves the cursor to the end. */
export function replaceSelection(view: VanillaCodeMirror, text: string, from: number, to: number) {
    view.dispatch({
        changes: { from, to, insert: text },
        selection: { anchor: from + text.length }
    });
}

/**
 * Uploads the image as a note attachment and inserts a markdown image reference at `pos` (or the cursor).
 * Mirrors CKEditor's image upload adapter: on failure, surfaces the server's error message as a
 * toast, falling back to a generic "Cannot upload" message for network errors.
 */
export async function uploadImageAndInsert(view: VanillaCodeMirror, note: FNote, file: File, pos?: number) {
    let detail: string | undefined;
    try {
        const result = await server.upload(
            `notes/${note.noteId}/attachments/upload`,
            file, undefined, "POST"
        ) as { uploaded?: boolean; url?: string; message?: string };
        if (result?.uploaded && result.url) {
            insertText(view, `![${file.name}](${result.url})`, pos);
            return;
        }
        detail = result?.message;
    } catch (e) {
        detail = e instanceof Error ? e.message : undefined;
    }

    const base = t("markdown_editor.image_upload_failed", { name: file.name });
    toast.showError(detail ? `${base} ${detail}` : base);
}
