import optionsApiRoute from "./api/options";
import treeApiRoute from "./api/tree";
import keysApiRoute from "./api/keys";
import notesApiRoute from "./api/notes";
import attachmentsApiRoute from "./api/attachments";
import noteMapRoute from "./api/note_map";
import recentNotesRoute from "./api/recent_notes";
import otherRoute from "./api/others";
import branchesApiRoute from "./api/branches";
import appInfoRoute from "./api/app_info";
import statsRoute from "./api/stats";
import AbstractBeccaEntity from "../becca/entities/abstract_becca_entity";
import cloningApiRoute from "./api/cloning";
import sqlRoute from "./api/sql";
import attributesRoute from "./api/attributes";
import revisionsApiRoute from "./api/revisions";

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

    apiRoute(GET, "/api/notes/:noteId/attributes", attributesRoute.getEffectiveNoteAttributes);
    apiRoute(PST, "/api/notes/:noteId/attributes", attributesRoute.addNoteAttribute);
    apiRoute(PUT, "/api/notes/:noteId/attributes", attributesRoute.updateNoteAttributes);
    apiRoute(PUT, "/api/notes/:noteId/attribute", attributesRoute.updateNoteAttribute);
    apiRoute(PUT, "/api/notes/:noteId/set-attribute", attributesRoute.setNoteAttribute);
    apiRoute(PUT, "/api/notes/:noteId/relations/:name/to/:targetNoteId", attributesRoute.createRelation);
    apiRoute(DEL, "/api/notes/:noteId/relations/:name/to/:targetNoteId", attributesRoute.deleteRelation);
    apiRoute(DEL, "/api/notes/:noteId/attributes/:attributeId", attributesRoute.deleteNoteAttribute);
    apiRoute(GET, "/api/attribute-names/", attributesRoute.getAttributeNames);
    apiRoute(GET, "/api/attribute-values/:attributeName", attributesRoute.getValuesForAttribute);

    apiRoute(GET, "/api/notes/:noteId/revisions", revisionsApiRoute.getRevisions);
    apiRoute(DEL, "/api/notes/:noteId/revisions", revisionsApiRoute.eraseAllRevisions);
    apiRoute(PST, "/api/revisions/erase-all-excess-revisions", revisionsApiRoute.eraseAllExcessRevisions);
    apiRoute(GET, "/api/revisions/:revisionId", revisionsApiRoute.getRevision);
    apiRoute(GET, "/api/revisions/:revisionId/blob", revisionsApiRoute.getRevisionBlob);
    apiRoute(DEL, "/api/revisions/:revisionId", revisionsApiRoute.eraseRevision);
    apiRoute(PST, "/api/revisions/:revisionId/restore", revisionsApiRoute.restoreRevision);
    apiRoute(GET, "/api/edited-notes/:date", revisionsApiRoute.getEditedNotesOnDate);

    apiRoute(PUT, "/api/branches/:branchId/move-to/:parentBranchId", branchesApiRoute.moveBranchToParent);
    apiRoute(PUT, "/api/branches/:branchId/move-before/:beforeBranchId", branchesApiRoute.moveBranchBeforeNote);
    apiRoute(PUT, "/api/branches/:branchId/move-after/:afterBranchId", branchesApiRoute.moveBranchAfterNote);
    apiRoute(PUT, "/api/branches/:branchId/expanded/:expanded", branchesApiRoute.setExpanded);
    apiRoute(PUT, "/api/branches/:branchId/expanded-subtree/:expanded", branchesApiRoute.setExpandedForSubtree);
    apiRoute(DEL, "/api/branches/:branchId", branchesApiRoute.deleteBranch);
    apiRoute(PUT, "/api/branches/:branchId/set-prefix", branchesApiRoute.setPrefix);
    apiRoute(PUT, "/api/branches/set-prefix-batch", branchesApiRoute.setPrefixBatch);

    apiRoute(PUT, "/api/notes/:noteId/clone-to-branch/:parentBranchId", cloningApiRoute.cloneNoteToBranch);
    apiRoute(PUT, "/api/notes/:noteId/toggle-in-parent/:parentNoteId/:present", cloningApiRoute.toggleNoteInParent);
    apiRoute(PUT, "/api/notes/:noteId/clone-to-note/:parentNoteId", cloningApiRoute.cloneNoteToParentNote);
    apiRoute(PUT, "/api/notes/:noteId/clone-after/:afterBranchId", cloningApiRoute.cloneNoteAfter);

    apiRoute(GET, "/api/note-map/:noteId/backlink-count", noteMapRoute.getBacklinkCount);

    apiRoute(PST, "/api/recent-notes", recentNotesRoute.addRecentNote);

    apiRoute(GET, "/api/keyboard-actions", keysApiRoute.getKeyboardActions);
    apiRoute(GET, "/api/keyboard-shortcuts-for-notes", keysApiRoute.getShortcutsForNotes);

    apiRoute(GET, "/api/stats/note-size/:noteId", statsRoute.getNoteSize);
    apiRoute(GET, "/api/stats/subtree-size/:noteId", statsRoute.getSubtreeSize);

    apiRoute(GET, "/api/sql/schema", sqlRoute.getSchema);
    apiRoute(PST, "/api/sql/execute/:noteId", sqlRoute.execute);

    apiRoute(GET, "/api/app-info", appInfoRoute.getAppInfo);
    apiRoute(GET, "/api/other/icon-usage", otherRoute.getIconUsage);
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
