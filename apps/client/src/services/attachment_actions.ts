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
    { copyReference, isReadOnly = false }: AttachmentActionOptions = {}
): AttachmentAction[][] {
    const viewActions = getViewActions(attachment, copyReference);
    return isReadOnly ? [ viewActions ] : [ viewActions, ...getEditActionGroups(attachment) ];
}

/** The actions that leave the attachment unchanged. */
function getViewActions(
    attachment: FAttachment,
    copyReference: AttachmentActionOptions["copyReference"]
): AttachmentAction[] {
    const { attachmentId, mime } = attachment;

    return [
        getOpenExternallyAction(attachment),
        {
            title: t("attachments_actions.open_custom"),
            tooltip: t("attachments_actions.open_custom_title"),
            icon: "bx bx-customize",
            disabledReason: utils.isElectron()
                ? undefined
                : t("attachments_actions.open_custom_client_only"),
            run: () => open.openAttachmentCustom(attachmentId, mime)
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

/** The actions that change, delete or convert the attachment, in their groups. */
function getEditActionGroups(attachment: FAttachment): AttachmentAction[][] {
    const { attachmentId, mime } = attachment;

    return [
        [
            {
                title: t("attachments_actions.upload_new_revision"),
                icon: "bx bx-upload",
                run: () => pickFile((file) => uploadNewRevision(attachment, file))
            },
            {
                title: t("attachments_actions.rename_attachment"),
                icon: "bx bx-rename",
                run: () => renameAttachment(attachment)
            },
            {
                title: t("attachments_actions.delete_attachment"),
                icon: "bx bx-trash destructive-action-icon",
                run: () => deleteAttachment(attachment)
            }
        ],
        [
            // A link preview's pictures are left out: the server already sized them.
            ...(attachment.role === "image" ? [ {
                title: t("compress-image"),
                icon: "bx bx-collapse-alt",
                run: () => void showImageCompressionDialog({
                    type: "attachment",
                    attachmentId,
                    mime
                })
            } ] : []),
            {
                title: t("attachments_actions.convert_attachment_into_note"),
                icon: "bx bx-note",
                run: () => convertAttachmentToNote(attachment)
            }
        ]
    ];
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
        title: t("attachments_actions.rename_attachment"),
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
