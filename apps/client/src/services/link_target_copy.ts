import type FNote from "../entities/fnote.js";
import contextMenu from "../menus/context_menu.js";
import { copyWhenReady, toReferenceLinkHtml } from "./clipboard_ext.js";
import { t } from "./i18n.js";
import type { LinkTarget } from "./link_targets.js";
import { getNoteShareLink, getSharedPageLink } from "./share_link.js";
import toast from "./toast.js";

/** A place inside a note that `showTargetReferenceMenu()` copies a link to. */
export interface TargetReferenceSource {
    /** The note of the target, which names the link and gives the shared page. */
    note: FNote;
    /** The target, or `null` when it cannot be linked. Called when a row is picked. */
    getTarget(): Promise<LinkTarget | null>;
    /** Whether the shared page of the note lands on the target, which it reaches by `block`. */
    hasPublicLinks: boolean;
    /** The title that the link starts with, such as an attachment's: the note's when absent. */
    title?: string;
}

/**
 * Opens a menu at the pointer of `e` that copies a reference link to the target of `source`, and
 * for a shared note, the link to the target on its shared page.
 */
export function showTargetReferenceMenu(e: MouseEvent, source: TargetReferenceSource) {
    const shareLink = source.hasPublicLinks ? getNoteShareLink(source.note) : null;
    void contextMenu.show({
        x: e.pageX,
        y: e.pageY,
        items: [
            {
                title: t("block_reference.copy_reference"),
                uiIcon: "bx bx-link",
                handler: () => copyTargetReference(source)
            },
            ...(shareLink ? [ {
                title: t("block_reference.copy_share_link"),
                uiIcon: "bx bx-world",
                handler: () => copyTargetShareLink(source, shareLink)
            } ] : [])
        ],
        // Each item's `handler` runs synchronously in the pick, where a clipboard write can start.
        selectMenuItemHandler: () => {}
    });
}

/**
 * Gives the target a reference where it needs one, and copies a reference link to it. Call it
 * synchronously from the user's action, which allows the clipboard write.
 */
export function copyTargetReference(source: TargetReferenceSource) {
    const content = linkToTarget(source).then((target) => {
        if (!target) {
            return null;
        }
        const href = `#${target.createLinkPath()}`;
        const title = source.title ?? source.note.title;
        const text = target.title ? `${title} - ${target.title}` : title;
        return { html: toReferenceLinkHtml(href, text), text: href };
    });
    void copyWhenReady(content, { isHtml: true });
}

/** Gives the target a reference where it needs one, and copies its link on the shared page. */
function copyTargetShareLink(source: TargetReferenceSource, shareLink: string) {
    const content = linkToTarget(source).then((target) => {
        const block = target?.params?.block;
        if (target && !block) {
            toast.showError(t("block_reference.copy_failed"));
        }
        return block ? { text: getSharedPageLink(shareLink, block) } : null;
    });
    void copyWhenReady(content, { isHtml: false });
}

/**
 * The target of `source` with link parameters that are in the saved note, or `null` after a toast
 * that reports the failure.
 */
async function linkToTarget({ note, getTarget }: TargetReferenceSource) {
    try {
        const target = await getTarget();
        await target?.createReference?.();
        if (!target?.params || Object.keys(target.params).length === 0) {
            throw new Error(`No reference for a heading of note '${note.noteId}'.`);
        }
        return target;
    } catch (e) {
        console.warn(e);
        toast.showError(t("block_reference.copy_failed"));
        return null;
    }
}
