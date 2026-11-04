import type { ConvertAttachmentToNoteResponse } from "@triliumnext/commons";

import appContext from "../components/app_context.js";
import type FAttachment from "../entities/fattachment.js";
import {
    showImageCompressionDialog
} from "../widgets/dialogs/image_compression/image_compression_dialog.js";
import dialog from "./dialog.js";
import { t } from "./i18n.js";
import link from "./link.js";
import open from "./open.js";
import server from "./server.js";
import toast from "./toast.js";
import utils from "./utils.js";
import ws from "./ws.js";

/** One action on an attachment, as the menus offering it list it. */
export interface AttachmentAction {
    title: string;
    icon: string;
    /** A longer explanation, shown where the menu supports a tooltip. */
    tooltip?: string;
    /** Why the action cannot run here. Unset when it can. */
    disabledReason?: string;
    run: () => void | Promise<void>;
}

export interface AttachmentActionOptions {
    /** Copies a reference to the attachment. Without it, the actions offer no copy. */
    copyReference?: () => void | Promise<void>;
    /** Leaves out the actions that change the attachment, for a note shown read-only. */
    isReadOnly?: boolean;
}

/**
 * The actions on `attachment`, in the groups a menu separates with a divider. The attachment page
 * and the context menu of an attachment link both list them.
 */
export function getAttachmentActionGroups(
    attachment: FAttachment,
    options: AttachmentActionOptions = {}
): AttachmentAction[][] {
    const { groups, conversion } = getLinkedAttachmentActions(attachment, options);
    if (!conversion) {
        return groups;
    }

    const [ viewActions, changeActions, imageActions ] = groups;
    return [ viewActions, changeActions, [ ...imageActions, conversion ] ];
}

/**
 * The actions on `attachment` for the menu of a link to it, which lists `conversion`, converting
 * the attachment into a note, beside the conversions of the link. `groups` holds the others, in
 * the groups a menu separates with a divider; the last group, compressing an image, is empty for
 * another attachment. A note shown read-only has only the actions that leave the attachment
 * unchanged, and no conversion.
 */
export function getLinkedAttachmentActions(
    attachment: FAttachment,
    options: AttachmentActionOptions = {}
): { groups: AttachmentAction[][]; conversion: AttachmentAction | null } {
    const { groups, deletion, conversion } = getEmbeddedAttachmentActions(attachment, options);
    if (!deletion) {
        return { groups, conversion };
    }

    const [ viewActions, changeActions, imageActions ] = groups;
    return { groups: [ viewActions, [ ...changeActions, deletion ], imageActions ], conversion };
}

/**
 * The actions on `attachment` for the menu of an embed of it, which lists `deletion` and
 * `conversion` under deleting the embed and converting it to a link. `groups` holds the others, as
 * {@link getLinkedAttachmentActions} lists them. A note shown read-only has only the actions that
 * leave the attachment unchanged, and neither `deletion` nor `conversion`.
 */
export function getEmbeddedAttachmentActions(
    attachment: FAttachment,
    { copyReference, isReadOnly = false }: AttachmentActionOptions = {}
): {
    groups: AttachmentAction[][];
    deletion: AttachmentAction | null;
    conversion: AttachmentAction | null;
} {
    const viewActions = getViewActions(attachment, copyReference);
    if (isReadOnly) {
        return { groups: [ viewActions ], deletion: null, conversion: null };
    }

    return {
        groups: [ viewActions, getChangeActions(attachment), getImageActions(attachment) ],
        deletion: {
            title: t("attachments_actions.delete_attachment"),
            icon: "bx bx-trash destructive-action-icon",
            run: () => deleteAttachment(attachment)
        },
        conversion: {
            title: t("attachments_actions.convert_attachment_into_note"),
            icon: "bx bx-note",
            run: () => convertAttachmentToNote(attachment)
        }
    };
}

/** The actions that leave the attachment unchanged. */
function getViewActions(
    attachment: FAttachment,
    copyReference: AttachmentActionOptions["copyReference"]
): AttachmentAction[] {
    const { attachmentId } = attachment;

    return [
        getOpenExternallyAction(attachment),
        {
            title: t("attachments_actions.open_custom"),
            tooltip: t("attachments_actions.open_custom_title"),
            icon: "bx bx-customize",
            disabledReason: utils.isElectron()
                ? undefined
                : t("attachments_actions.open_custom_client_only"),
            run: () => open.openAttachmentCustom(attachmentId)
        },
        getDownloadAction(attachment),
        ...(copyReference ? [ {
            title: t("attachments_actions.copy_link_to_clipboard"),
            icon: "bx bx-copy",
            run: copyReference
        } ] : []),
        ...(supportsOcr(attachment) ? [ {
            title: t("ocr.view_extracted_text"),
            icon: "bx bx-text",
            run: () => {
                appContext.triggerCommand("showOcrTextDialog", {
                    textUrl: `ocr/attachments/${attachmentId}/text`,
                    processUrl: `ocr/process-attachment/${attachmentId}`
                });
            }
        } ] : [])
    ];
}

/** The actions that replace or rename the attachment. */
function getChangeActions(attachment: FAttachment): AttachmentAction[] {
    return [
        {
            title: t("attachments_actions.upload_new_revision"),
            icon: "bx bx-upload",
            run: () => pickFile((file) => uploadNewRevision(attachment, file))
        },
        {
            title: t("attachments_actions.rename_attachment"),
            icon: "bx bx-rename",
            run: () => renameAttachment(attachment)
        }
    ];
}

/** Compressing the attachment, for an image. */
function getImageActions({ attachmentId, mime, role }: FAttachment): AttachmentAction[] {
    // A link preview's pictures are left out: the server already sized them.
    if (role !== "image") {
        return [];
    }

    return [ {
        title: t("compress-image-menu"),
        icon: "bx bx-collapse-alt",
        run: () => void showImageCompressionDialog({ type: "attachment", attachmentId, mime })
    } ];
}

export function getOpenExternallyAction({ attachmentId, mime }: FAttachment): AttachmentAction {
    return {
        title: t("attachments_actions.open_externally"),
        tooltip: t("attachments_actions.open_externally_title"),
        icon: "bx bx-file-find",
        run: () => open.openAttachmentExternally(attachmentId, mime)
    };
}

export function getDownloadAction({ attachmentId }: FAttachment): AttachmentAction {
    return {
        title: t("attachments_actions.download"),
        icon: "bx bx-download",
        run: () => open.downloadAttachment(attachmentId)
    };
}

/** Whether the attachment is an ordinary file, previewed and linked like one. */
export function isFileLikeAttachment(attachment: FAttachment) {
    return attachment.role === "file" || attachment.role === "importSource";
}

/** Puts a reference link to the attachment on the clipboard. */
export async function copyAttachmentReference(attachment: FAttachment) {
    const $link = await link.createLink(attachment.ownerId, {
        referenceLink: true,
        viewScope: {
            viewMode: "attachments",
            attachmentId: attachment.attachmentId
        }
    });

    utils.copyHtmlToClipboard($link[0].outerHTML);
    toast.showMessage(t("attachment_detail_2.link_copied"));
}

/** Link previews' pictures are left out: their text belongs to the preview, not to the note. */
function supportsOcr(attachment: FAttachment) {
    return attachment.role === "image" || isFileLikeAttachment(attachment);
}

/** Opens the browser's file picker and passes the picked file to `onPick`. */
function pickFile(onPick: (file: File) => void) {
    const input = document.createElement("input");
    input.type = "file";
    input.addEventListener("change", () => {
        const file = input.files?.item(0);
        if (file) {
            onPick(file);
        }
    });
    input.click();
}

async function uploadNewRevision(attachment: FAttachment, file: File) {
    const result = await server.upload(`attachments/${attachment.attachmentId}/file`, file);
    if (result.uploaded) {
        toast.showMessage(t("attachments_actions.upload_success"));
    } else {
        toast.showError(t("attachments_actions.upload_failed"));
    }
}

async function renameAttachment(attachment: FAttachment) {
    const title = await dialog.prompt({
        title: t("attachments_actions.rename_attachment_title"),
        message: t("attachments_actions.enter_new_name"),
        defaultValue: attachment.title
    });

    if (!title?.trim()) return;
    await server.put(`attachments/${attachment.attachmentId}/rename`, { title });
}

async function deleteAttachment(attachment: FAttachment) {
    const { title } = attachment;
    if (!(await dialog.confirm(t("attachments_actions.delete_confirm", { title })))) {
        return;
    }

    await server.remove(`attachments/${attachment.attachmentId}`);
    toast.showMessage(t("attachments_actions.delete_success", { title }));
}

async function convertAttachmentToNote(attachment: FAttachment) {
    const { title } = attachment;
    if (!(await dialog.confirm(t("attachments_actions.convert_confirm", { title })))) {
        return;
    }

    const { note: newNote } = await server.post<ConvertAttachmentToNoteResponse>(
        `attachments/${attachment.attachmentId}/convert-to-note`
    );
    toast.showMessage(t("attachments_actions.convert_success", { title }));
    await ws.waitForMaxKnownEntityChangeId();
    await appContext.tabManager.getActiveContext()?.setNote(newNote.noteId);
}
