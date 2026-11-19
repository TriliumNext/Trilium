import type VanillaCodeMirror from "@triliumnext/codemirror";
import { applyOutsideHistory } from "@triliumnext/codemirror/src/extensions/block_markers";
import type {
    HostedCompletionApply
} from "@triliumnext/codemirror/src/extensions/hosted_completion";
import type { NoteChip } from "@triliumnext/codemirror/src/extensions/trilium_note_chips";
import type { SourceChange } from "@triliumnext/commons/src/lib/markdown_references.js";

import appContext from "../../../components/app_context";
import type FNote from "../../../entities/fnote";
import { formatCustomDateTime } from "../../../services/dayjs";
import froca from "../../../services/froca";
import { t } from "../../../services/i18n";
import { LABELED_TARGET_PARAMS, loadLinkTargetLabel } from "../../../services/link";
import { createAnchorTargets, type LinkTarget } from "../../../services/link_targets";
import { parseNavigationStateFromUrl } from "../../../services/navigation_state";
import options from "../../../services/options";
import server from "../../../services/server";
import toast from "../../../services/toast";
import { resolveNoteChip } from "../../search_field_editor";

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

/**
 * Opens the edit link dialog, then puts the link picked in place of the selection of `view`. The
 * dialog lists the headings and anchors of `ownNote`, the note that `view` edits.
 */
export function showEditLinkDialog(
    view: VanillaCodeMirror,
    ownNote?: { noteId: string; notePath: string }
) {
    const { from, to } = view.state.selection.main;
    const selectedText = view.state.sliceDoc(from, to);
    const reader = ownTargetReaders.get(view);
    const own = ownNote && reader ? reader.read(ownNote.notePath, { from, to }) : null;
    const openedDoc = view.state.doc;

    void appContext.triggerCommand("showEditLinkDialog", {
        text: selectedText,
        hasSelection: from !== to,
        ...(ownNote && own && {
            noteId: ownNote.noteId, headings: own.headings, anchors: own.anchors
        }),
        async addLink(notePath: string, linkTitle: string | null, externalLink?: boolean) {
            const marker = reader?.takePendingMarker();
            const range = own?.getRange() ?? (view.state.doc === openedDoc ? { from, to } : null);
            if (marker === null) return;
            if (!range) {
                toast.showError(t("add_link.listing_changed"));
                return;
            }

            let md: string;
            if (externalLink) {
                const label = (from !== to) ? selectedText : (linkTitle || notePath);
                md = `[${label}](${notePath})`;
            } else if (linkTitle) {
                const label = (from !== to) ? selectedText : linkTitle;
                md = `[${label}](#${notePath})`;
            } else {
                md = toWikilink(notePath);
            }

            insertWithMarker(view, marker, { ...range, insert: md });
            view.focus();
        }
    });
}

/** The headings and anchors that a Markdown editor lists of its own document, for links to it. */
export interface OwnLinkTargets {
    headings: LinkTarget[];
    /** The names of the anchors, sorted. */
    anchors: string[];
    /** The range that the targets were read with, mapped through the changes since, or `null`. */
    getRange(): { from: number; to: number } | null;
}

/** Reads the targets of the document of a Markdown editor, as `useBlockMarkers()` registers. */
export interface OwnLinkTargetReader {
    /**
     * The targets of the document, which link to the note at `notePath`. A heading picked from
     * them leaves the marker that its link needs for {@link takePendingMarker}.
     */
    read(notePath: string, range?: { from: number; to: number }): OwnLinkTargets;
    /**
     * The marker that the last heading picked left for its link, while the document is unchanged
     * since: `undefined` for none, `null` when the pick was declined.
     */
    takePendingMarker(): SourceChange | null | undefined;
}

const ownTargetReaders = new WeakMap<object, OwnLinkTargetReader>();

/** Registers the reader of the targets of `view`. Returns the function that removes it. */
export function registerOwnLinkTargets(view: object, reader: OwnLinkTargetReader) {
    ownTargetReaders.set(view, reader);
    return () => {
        ownTargetReaders.delete(view);
    };
}

/** The targets of the document of `view` for a link to its note at `notePath`, if it lists any. */
export function getOwnLinkTargets(view: object, notePath: string): LinkTarget[] | undefined {
    const own = ownTargetReaders.get(view)?.read(notePath);
    return own && [ ...own.headings, ...createAnchorTargets(own.anchors, notePath) ];
}

/** The marker that the last heading picked of `view` left for its link, as the reader says. */
export function takePendingMarker(view: object) {
    return ownTargetReaders.get(view)?.takePendingMarker();
}

/** The editor view of the CodeMirror package, which a client import of it would not match. */
type CodeMirrorView = Parameters<HostedCompletionApply>[0];

/**
 * Applies `change`, with the caret after it, and first `marker`, the block marker that its link
 * needs, outside the history. Both are on the current document. Declines with a toast when they
 * touch.
 */
export function insertWithMarker(
    view: CodeMirrorView,
    marker: SourceChange | undefined,
    change: SourceChange,
    userEvent?: string
) {
    if (marker && marker.from <= change.to && change.from <= marker.to) {
        toast.showError(t("add_link.heading_reference_failed"));
        return;
    }

    let { from, to } = change;
    if (marker) {
        const markerChanges = view.state.changes(marker);
        applyOutsideHistory(view, [ marker ]);
        from = markerChanges.mapPos(from, 1);
        to = markerChanges.mapPos(to, -1);
    }
    view.dispatch({
        changes: { from, to, insert: change.insert },
        selection: { anchor: from + change.insert.length },
        userEvent
    });
}

/**
 * The Wikilink to the note at `notePath`, which the preview renders as a reference link. It keeps
 * the parameters of `notePath`, such as the `block` of a heading.
 */
export function toWikilink(notePath: string) {
    const queryStart = notePath.indexOf("?");
    const path = queryStart < 0 ? notePath : notePath.slice(0, queryStart);
    const query = queryStart < 0 ? "" : notePath.slice(queryStart);
    return `[[${path.split("/").pop()}${query}]]`;
}

/**
 * The chip of a `[[noteId]]` link in the Markdown editor: the icon and title of the note, then the
 * blocks, heading, anchor or PDF page that `params`, the query of the link, point at.
 */
export function resolveWikilinkChip(
    noteId: string, params?: string
): NoteChip | Promise<NoteChip | null> | null {
    const { viewScope = {} } = parseNavigationStateFromUrl(`#root/${noteId}?${params ?? ""}`);
    if (!LABELED_TARGET_PARAMS.some((param) => viewScope[param])) return resolveNoteChip(noteId);

    return froca.getNote(noteId, true).then(async (note) => {
        if (!note) return null;
        // A broken reference names the note alone, as the text of a reference link does.
        const label = await loadLinkTargetLabel(note, viewScope);
        const title = label && !label.isBroken ? `${note.title} - ${label.text}` : note.title;
        return { title, icon: note.getIcon() };
    });
}

/** Inserts the current date and time at the cursor, in the `customDateTimeFormat` option. */
export function insertDateTime(view: VanillaCodeMirror) {
    insertText(view, formatCustomDateTime(new Date(), options.get("customDateTimeFormat")));
}

/** Opens the include note dialog, then inserts the embed or the image picked at the cursor. */
export function showIncludeNoteDialog(view: VanillaCodeMirror) {
    void appContext.triggerCommand("showContentEmbedDialog", {
        editorApi: {
            addContentEmbed(noteId: string, boxSize?: string, options?: { hideTitle?: boolean }) {
                const attributes = `data-note-id="${noteId}" data-box-size="${boxSize ?? "full"}"`
                    + (options?.hideTitle ? ' data-hide-title="true"' : "");
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
