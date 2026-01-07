import optionsApiRoute from "./api/options";
import treeApiRoute from "./api/tree";
import keysApiRoute from "./api/keys";
import notesApiRoute from "./api/notes";
import attachmentsApiRoute from "./api/attachments";
import noteMapRoute from "./api/note_map";
import AbstractBeccaEntity from "../becca/entities/abstract_becca_entity";

// TODO: Deduplicate with routes.ts
const GET = "get",
    PST = "post",
    PUT = "put",
    PATCH = "patch",
    DEL = "delete";

export function buildSharedApiRoutes(apiRoute: any) {
    apiRoute(GET, '/api/tree', treeApiRoute.getTree);
    apiRoute(PST, '/api/tree/load', treeApiRoute.load);

    apiRoute(GET, "/api/options", optionsApiRoute.getOptions);
    // FIXME: possibly change to sending value in the body to avoid host of HTTP server issues with slashes
    apiRoute(PUT, "/api/options/:name/:value", optionsApiRoute.updateOption);
    apiRoute(PUT, "/api/options", optionsApiRoute.updateOptions);
    apiRoute(GET, "/api/options/user-themes", optionsApiRoute.getUserThemes);
    apiRoute(GET, "/api/options/locales", optionsApiRoute.getSupportedLocales);

    apiRoute(PST, "/api/notes/:noteId/convert-to-attachment", notesApiRoute.convertNoteToAttachment);
    apiRoute(GET, "/api/notes/:noteId", notesApiRoute.getNote);
    apiRoute(GET, "/api/notes/:noteId/blob", notesApiRoute.getNoteBlob);
    apiRoute(GET, "/api/notes/:noteId/metadata", notesApiRoute.getNoteMetadata);
    apiRoute(PUT, "/api/notes/:noteId/data", notesApiRoute.updateNoteData);
    apiRoute(DEL, "/api/notes/:noteId", notesApiRoute.deleteNote);
    apiRoute(PUT, "/api/notes/:noteId/undelete", notesApiRoute.undeleteNote);
    apiRoute(PST, "/api/notes/:noteId/revision", notesApiRoute.forceSaveRevision);
    apiRoute(PST, "/api/notes/:parentNoteId/children", notesApiRoute.createNote);
    apiRoute(PUT, "/api/notes/:noteId/sort-children", notesApiRoute.sortChildNotes);
    apiRoute(PUT, "/api/notes/:noteId/protect/:isProtected", notesApiRoute.protectNote);
    apiRoute(PUT, "/api/notes/:noteId/type", notesApiRoute.setNoteTypeMime);
    apiRoute(PUT, "/api/notes/:noteId/title", notesApiRoute.changeTitle);
    apiRoute(PST, "/api/notes/:noteId/duplicate/:parentNoteId", notesApiRoute.duplicateSubtree);
    apiRoute(PST, "/api/notes/erase-deleted-notes-now", notesApiRoute.eraseDeletedNotesNow);
    apiRoute(PST, "/api/notes/erase-unused-attachments-now", notesApiRoute.eraseUnusedAttachmentsNow);
    apiRoute(PST, "/api/delete-notes-preview", notesApiRoute.getDeleteNotesPreview);

    apiRoute(GET, "/api/notes/:noteId/attachments", attachmentsApiRoute.getAttachments);
    apiRoute(PST, "/api/notes/:noteId/attachments", attachmentsApiRoute.saveAttachment);
    apiRoute(GET, "/api/attachments/:attachmentId", attachmentsApiRoute.getAttachment);
    apiRoute(GET, "/api/attachments/:attachmentId/all", attachmentsApiRoute.getAllAttachments);
    apiRoute(PST, "/api/attachments/:attachmentId/convert-to-note", attachmentsApiRoute.convertAttachmentToNote);
    apiRoute(DEL, "/api/attachments/:attachmentId", attachmentsApiRoute.deleteAttachment);
    apiRoute(PUT, "/api/attachments/:attachmentId/rename", attachmentsApiRoute.renameAttachment);
    apiRoute(GET, "/api/attachments/:attachmentId/blob", attachmentsApiRoute.getAttachmentBlob);

    apiRoute(GET, "/api/note-map/:noteId/backlink-count", noteMapRoute.getBacklinkCount);

    apiRoute(GET, "/api/keyboard-actions", keysApiRoute.getKeyboardActions);
    apiRoute(GET, "/api/keyboard-shortcuts-for-notes", keysApiRoute.getShortcutsForNotes);
}

/** Handling common patterns. If entity is not caught, serialization to JSON will fail */
export function convertEntitiesToPojo(result: unknown) {
    if (result instanceof AbstractBeccaEntity) {
        result = result.getPojo();
    } else if (Array.isArray(result)) {
        for (const idx in result) {
            if (result[idx] instanceof AbstractBeccaEntity) {
                result[idx] = result[idx].getPojo();
            }
        }
    } else if (result && typeof result === "object") {
        if ("note" in result && result.note instanceof AbstractBeccaEntity) {
            result.note = result.note.getPojo();
        }

        if ("branch" in result && result.branch instanceof AbstractBeccaEntity) {
            result.branch = result.branch.getPojo();
        }
    }

    if (result && typeof result === "object" && "executionResult" in result) {
        // from runOnBackend()
        result.executionResult = convertEntitiesToPojo(result.executionResult);
    }

    return result;
}
