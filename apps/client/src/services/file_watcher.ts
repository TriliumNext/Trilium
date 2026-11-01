import { dayjs, type WebSocketMessage } from "@triliumnext/commons";

import froca from "./froca.js";
import { t } from "./i18n.js";
import server from "./server.js";
import toast, { type ToastNoteReference } from "./toast.js";
import ws from "./ws.js";

type OpenedFileUpdate = Extract<WebSocketMessage, { type: "openedFileUpdated" }>;

/** The temp files this window opened; the server reports changes to every window. */
const openedFiles = new Set<string>();

ws.subscribeToMessages(async message => {
    if (message.type !== "openedFileUpdated") {
        return;
    }

    checkType(message.entityType);
    if (openedFiles.has(message.filePath)) {
        await showUploadToast(message);
    }
});

/** Marks a temp file as opened from this window, so its changes are offered for upload here. */
export function watchOpenedFile(filePath: string) {
    openedFiles.add(filePath);
}

/**
 * Offers to upload a file edited outside Trilium. Each note or attachment has one toast, which a
 * later save of the same file updates in place.
 */
async function showUploadToast({ entityType, entityId, filePath, lastModifiedMs }: OpenedFileUpdate) {
    const noteReference = await getNoteReference(entityType, entityId);

    toast.showPersistent({
        id: `opened-file-updated-${entityType}-${entityId}`,
        icon: "bx bx-upload",
        title: t("watched_file_update_status.title"),
        message: t("watched_file_update_status.message", { time: dayjs(lastModifiedMs).format("HH:mm:ss") }),
        notes: noteReference ? [ noteReference ] : undefined,
        buttons: [
            {
                text: t("watched_file_update_status.upload_modified_file"),
                onClick: async ({ dismissToast }) => {
                    await server.post(`${entityType}/${entityId}/upload-modified-file`, { filePath });
                    dismissToast();
                }
            }
        ]
    });
}

async function getNoteReference(entityType: string, entityId: string): Promise<string | ToastNoteReference | undefined> {
    if (entityType === "notes") {
        return entityId;
    }

    const attachment = await froca.getAttachment(entityId, true);
    return attachment ? { noteId: attachment.ownerId, description: attachment.title } : undefined;
}

function checkType(type: string) {
    if (type !== "notes" && type !== "attachments") {
        throw new Error(`Unrecognized type '${type}', should be 'notes' or 'attachments'`);
    }
}
