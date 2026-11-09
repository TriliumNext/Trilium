import {
    type AttachmentRole, CANVAS_ATTACHMENT_MIME, getDrawingPictureTitle,
    NOTE_TYPE_IMAGE_ATTACHMENTS, type NoteType
} from "@triliumnext/commons";

/**
 * Which half of the attachment list an attachment belongs in.
 *
 * `user` is what someone put on the note — the pictures and files they pasted, dropped or uploaded.
 * `system` is what the app made for itself while doing something else: the two pictures a link
 * preview fetches, the JSON a collection keeps its view state in, the original file an import was
 * read from. Both are attachments of the same note and both take up space, but only the first kind
 * is anything the reader chose, and a note with a handful of links can carry more of the second
 * kind than the first.
 */
export type AttachmentGroup = "user" | "system";

/**
 * Which half each role the app creates belongs in.
 *
 * A `Record` over the roles rather than a list of the system ones, so that a role added to
 * `ATTACHMENT_ROLES` does not compile until it has been placed here. Which half something belongs in
 * is not derivable from the traits that live with the roles themselves — `viewConfig` and `favicon`
 * agree on nothing else — and it is only this list that presents them, so the answer is kept here.
 */
export const ATTACHMENT_ROLE_GROUPS: Record<AttachmentRole, AttachmentGroup> = {
    // What the reader placed on the note.
    image: "user",
    file: "user",
    // The two pictures a link preview fetches: a site's icon and a page's thumbnail. Neither is
    // chosen, and a note that links a lot of pages accumulates a lot of them.
    favicon: "system",
    coverImage: "system",
    // How a collection remembers the way it is being looked at, and how the PDF viewer remembers
    // where the reader had got to.
    viewConfig: "system",
    // Shapes saved into an Excalidraw canvas's library. Kept by the canvas for the canvas, rather
    // than attached to the note by hand.
    canvasLibraryItem: "system",
    // The file an import was read from, kept so an import that went wrong can be looked at again.
    importSource: "system",
    // A meeting recording's transcript, which `PinnedAttachments` shows above the note's content.
    transcript: "system"
};

/**
 * Which half of the list an attachment of this role belongs in.
 *
 * A role nobody here has heard of — a script's own, or one from a newer version reached over sync —
 * counts as the user's and stays in the view that opens by default. Filing it under `system` instead
 * would quietly bury an attachment its owner is looking for; this way the worst it costs is one extra
 * row among the user's own.
 */
export function attachmentGroupForRole(role: string | undefined | null): AttachmentGroup {
    return (role && Object.hasOwn(ATTACHMENT_ROLE_GROUPS, role)
        ? ATTACHMENT_ROLE_GROUPS[role as AttachmentRole]
        : undefined) ?? "user";
}

/**
 * Splits the attachments of a note of type `noteType` into the two groups, each keeping the order
 * it arrived in.
 *
 * Both halves are always returned, empty ones included, so a caller can count what it is not showing
 * — which is how the list knows whether to offer the app's own attachments at all, and how the row
 * that offers them says how much is behind it without unfolding.
 *
 * The pictures that the canvas saves of a canvas note and of each canvas drawing go in `system`.
 * They have the `image` role, so their titles identify them.
 */
export function partitionAttachmentsByGroup<T extends GroupedAttachment>(
    attachments: readonly T[],
    noteType: NoteType
): Record<AttachmentGroup, T[]> {
    const groups: Record<AttachmentGroup, T[]> = { user: [], system: [] };
    const canvasPictureTitles = getCanvasPictureTitles(attachments, noteType);

    for (const attachment of attachments) {
        const isCanvasPicture = attachment.role === "image"
            && canvasPictureTitles.has(attachment.title);
        const group = isCanvasPicture ? "system" : attachmentGroupForRole(attachment.role);
        groups[group].push(attachment);
    }

    return groups;
}

/** The fields of an attachment that {@link partitionAttachmentsByGroup} reads. */
interface GroupedAttachment {
    attachmentId: string;
    role: string;
    mime: string;
    title: string;
}

/**
 * The titles of the canvas pictures among `attachments`: `canvas-export.svg` on a canvas note, and
 * the title from `getDrawingPictureTitle()` for each canvas drawing.
 */
function getCanvasPictureTitles(attachments: readonly GroupedAttachment[], noteType: NoteType) {
    const titles = new Set<string>();
    if (noteType === "canvas") {
        titles.add(NOTE_TYPE_IMAGE_ATTACHMENTS.canvas);
    }

    for (const { attachmentId, mime } of attachments) {
        if (mime === CANVAS_ATTACHMENT_MIME) {
            titles.add(getDrawingPictureTitle(attachmentId));
        }
    }

    return titles;
}
