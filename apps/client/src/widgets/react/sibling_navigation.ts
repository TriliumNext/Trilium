/** Splits a note path into the parent path and parent note id (clone-aware: uses the in-tab path). */
export function getParentFromNotePath(notePath: string | null | undefined): { parentPath: string; parentNoteId: string } | null {
    if (!notePath) return null;
    const parts = notePath.split("/");
    if (parts.length < 2) return null;
    return { parentPath: parts.slice(0, -1).join("/"), parentNoteId: parts[parts.length - 2] };
}

/**
 * From the ordered note ids of the matching siblings (including the current note) and the current
 * note id, returns the previous/next sibling — wrapping around infinitely — plus the first/last
 * sibling, the 1-based index and total. Returns null when the current note isn't among them or there
 * are fewer than two.
 */
export function getSiblingNavigation(siblingNoteIds: string[], currentNoteId: string): { previous: string; next: string; first: string; last: string; index: number; total: number } | null {
    const index = siblingNoteIds.indexOf(currentNoteId);
    const total = siblingNoteIds.length;
    if (index === -1 || total < 2) return null;
    return {
        previous: siblingNoteIds[(index - 1 + total) % total],
        next: siblingNoteIds[(index + 1) % total],
        first: siblingNoteIds[0],
        last: siblingNoteIds[total - 1],
        index: index + 1,
        total
    };
}

export type SiblingDirection = "previous" | "next" | "first" | "last";

/**
 * Maps a `KeyboardEvent.code` to a navigation direction. PageUp/PageDown (prev/next) are built in, as are
 * Home/End (first/last) unless `includeEdges` is false (e.g. media players reserve Home/End for seeking); a
 * renderer can supply extra codes for prev/next (e.g. the image viewer adds `Backspace`/`Space`). Using
 * `code` keeps it keyboard-layout independent. The Previous/Next Track media keys are deliberately not
 * handled here — OS media-key integration is wired only for video/audio (via `navigator.mediaSession`),
 * where the hardware keys actually route reliably; for images it mostly never fired.
 */
export function codeToSiblingDirection(code: string, extraPrevious: readonly string[], extraNext: readonly string[], includeEdges = true): SiblingDirection | null {
    if (code === "PageUp" || extraPrevious.includes(code)) return "previous";
    if (code === "PageDown" || extraNext.includes(code)) return "next";
    if (includeEdges && code === "Home") return "first";
    if (includeEdges && code === "End") return "last";
    return null;
}

/** Whether the event originated in a text-entry field, where navigation keys must not be hijacked. */
export function isTextEntryTarget(target: { tagName?: string; isContentEditable?: boolean } | null | undefined): boolean {
    if (!target?.tagName) return false;
    const tag = target.tagName.toUpperCase();
    return tag === "INPUT" || tag === "TEXTAREA" || tag === "SELECT" || target.isContentEditable === true;
}

/** Whether the target is an interactive control that uses Space/Enter for activation (so we must not hijack Space from it). */
export function isInteractiveTarget(target: { tagName?: string; getAttribute?(name: string): string | null } | null | undefined): boolean {
    if (!target?.tagName) return false;
    const tag = target.tagName.toUpperCase();
    return tag === "BUTTON" || tag === "A" || tag === "SUMMARY" || target.getAttribute?.("role") === "button";
}

/**
 * From a note's ordered attachments and the currently-shown one, keeps those sharing its role (so the
 * viewer cycles e.g. image-with-image), optionally narrowed to a mime prefix — a media player only
 * advances between playable attachments, where the `file` role alone would also hand it a PDF or a ZIP.
 * Mapped to `{ id, title }`. Empty when the current one is absent.
 */
export function sameRoleAttachments(attachments: readonly { attachmentId: string; role: string; title: string; mime?: string }[], currentAttachmentId: string | undefined, mimePrefix?: string): { id: string; title: string }[] {
    const role = attachments.find((attachment) => attachment.attachmentId === currentAttachmentId)?.role;
    if (!role) return [];
    const matches = (attachment: { role: string; mime?: string }) => attachment.role === role && (!mimePrefix || !!attachment.mime?.startsWith(mimePrefix));
    return attachments.filter(matches).map((attachment) => ({ id: attachment.attachmentId, title: attachment.title }));
}
