import type VanillaCodeMirror from "@triliumnext/codemirror";

import appContext from "../../../components/app_context";
import type FNote from "../../../entities/fnote";
import froca from "../../../services/froca";
import { t } from "../../../services/i18n";
import options from "../../../services/options";
import server from "../../../services/server";
import toast from "../../../services/toast";
import tree from "../../../services/tree";
import utils from "../../../services/utils";

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

/** Opens the edit link dialog, then puts the link picked in place of the selection of `view`. */
export function showEditLinkDialog(view: VanillaCodeMirror) {
    const { from, to } = view.state.selection.main;
    const selectedText = view.state.sliceDoc(from, to);

    void appContext.triggerCommand("showEditLinkDialog", {
        text: selectedText,
        hasSelection: from !== to,
        async addLink(notePath: string, linkTitle: string | null, externalLink?: boolean) {
            let md: string;
            if (externalLink) {
                const label = (from !== to) ? selectedText : (linkTitle || notePath);
                md = `[${label}](${notePath})`;
            } else if (linkTitle) {
                const label = (from !== to) ? selectedText : linkTitle;
                md = `[${label}](#${notePath})`;
            } else {
                const noteId = tree.getNoteIdFromUrl(notePath);
                md = `[[${noteId}]]`;
            }

            replaceSelection(view, md, from, to);
            view.focus();
        }
    });
}

/** Inserts the current date and time at the cursor, in the `customDateTimeFormat` option. */
export function insertDateTime(view: VanillaCodeMirror) {
    insertText(view, utils.formatDateTime(new Date(), options.get("customDateTimeFormat")));
}

/** Opens the include note dialog, then inserts the embed or the image picked at the cursor. */
export function showIncludeNoteDialog(view: VanillaCodeMirror) {
    void appContext.triggerCommand("showContentEmbedDialog", {
        editorApi: {
            addContentEmbed(noteId: string, boxSize?: string) {
                const attributes = `data-note-id="${noteId}" data-box-size="${boxSize ?? "full"}"`;
                insertText(view, `<figure class="include-note" ${attributes}></figure>\n`);
                view.focus();
            },
            async addImage(noteId: string) {
                const note = await froca.getNote(noteId);
                if (!note) return;
                const encodedTitle = encodeURIComponent(note.title);
                insertText(view, `![${note.title}](api/images/${noteId}/${encodedTitle})\n`);
                view.focus();
            }
        }
    });
}
