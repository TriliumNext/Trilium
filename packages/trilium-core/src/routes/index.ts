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
import relationMapApiRoute from "./api/relation-map";
import recentChangesApiRoute from "./api/recent_changes";
import bulkActionRoute from "./api/bulk_action";
import searchRoute from "./api/search";
import specialNotesRoute from "./api/special_notes";
import syncApiRoute from "./api/sync";
import autocompleteApiRoute from "./api/autocomplete";
import similarNotesRoute from "./api/similar_notes";
import imageRoute from "./api/image";
import setupApiRoute from "./api/setup";
import filesRoute from "./api/files";
import importRoute from "./api/import";
import exportRoute from "./api/export";
import scriptRoute from "./api/script";
import backendLogRoute from "./api/backend_log";
import backupRoute from "./api/backup";
import passwordApiRoute from "./api/password";
import loginApiRoute from "./api/login";

// TODO: Deduplicate with routes.ts
const GET = "get",
    PST = "post",
    PUT = "put",
    PATCH = "patch",
    DEL = "delete";

interface SharedApiRoutesContext {
    route: any;
    asyncRoute: any;
    apiRoute: any;
    asyncApiRoute: any;
    checkApiAuth: any;
    apiResultHandler: any;
    checkApiAuthOrElectron: any;
    checkAppNotInitialized: any;
    loginRateLimiter: any;
    checkCredentials: any;
    uploadMiddlewareWithErrorHandling: any;
    csrfMiddleware: any;
}

export function buildSharedApiRoutes({ route, asyncRoute, apiRoute, asyncApiRoute, checkApiAuth, apiResultHandler, checkApiAuthOrElectron, checkAppNotInitialized, checkCredentials, loginRateLimiter, uploadMiddlewareWithErrorHandling, csrfMiddleware }: SharedApiRoutesContext) {
    apiRoute(GET, '/api/tree', treeApiRoute.getTree);
    apiRoute(PST, '/api/tree/load', treeApiRoute.load);

    apiRoute(GET, "/api/options", optionsApiRoute.getOptions);
    // FIXME: possibly change to sending value in the body to avoid host of HTTP server issues with slashes
    asyncApiRoute(PUT, "/api/options/:name/:value", optionsApiRoute.updateOption);
    asyncApiRoute(PUT, "/api/options", optionsApiRoute.updateOptions);
    apiRoute(GET, "/api/options/user-themes", optionsApiRoute.getUserThemes);

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
    apiRoute(PATCH, "/api/revisions/:revisionId", revisionsApiRoute.updateRevisionDescription);
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

    // :filename is not used by trilium, but instead used for "save as" to assign a human-readable filename
    route(GET, "/api/revisions/:revisionId/image/:filename", [checkApiAuthOrElectron], imageRoute.returnImageFromRevision);
    route(GET, "/api/attachments/:attachmentId/image/:filename", [checkApiAuthOrElectron], imageRoute.returnAttachedImage);
    route(GET, "/api/images/:noteId/:filename", [checkApiAuthOrElectron], imageRoute.returnImageFromNote);
    route(PUT, "/api/images/:noteId", [checkApiAuthOrElectron, uploadMiddlewareWithErrorHandling, csrfMiddleware], imageRoute.updateImage, apiResultHandler);
    route(PST, "/api/notes/:noteId/attachments/upload", [checkApiAuthOrElectron, uploadMiddlewareWithErrorHandling, csrfMiddleware], attachmentsApiRoute.uploadAttachment, apiResultHandler);

    // group of the services below are meant to be executed from the outside
    route(GET, "/api/setup/status", [], setupApiRoute.getStatus, apiResultHandler);
    asyncRoute(PST, "/api/setup/new-document", [checkAppNotInitialized], setupApiRoute.setupNewDocument, apiResultHandler);
    asyncRoute(PST, "/api/setup/sync-from-server", [checkAppNotInitialized], setupApiRoute.setupSyncFromServer, apiResultHandler);
    route(GET, "/api/setup/sync-seed", [loginRateLimiter, checkCredentials], setupApiRoute.getSyncSeed, apiResultHandler);
    asyncRoute(PST, "/api/setup/sync-seed", [checkAppNotInitialized], setupApiRoute.saveSyncSeed, apiResultHandler);

    asyncApiRoute(PST, "/api/sync/test", syncApiRoute.testSync);
    asyncApiRoute(PST, "/api/sync/now", syncApiRoute.syncNow);
    apiRoute(PST, "/api/sync/fill-entity-changes", syncApiRoute.fillEntityChanges);
    apiRoute(PST, "/api/sync/force-full-sync", syncApiRoute.forceFullSync);
    route(GET, "/api/sync/check", [checkApiAuth], syncApiRoute.checkSync, apiResultHandler);
    route(GET, "/api/sync/changed", [checkApiAuth], syncApiRoute.getChanged, apiResultHandler);
    route(PUT, "/api/sync/update", [checkApiAuth], syncApiRoute.update, apiResultHandler);
    route(PST, "/api/sync/finished", [checkApiAuth], syncApiRoute.syncFinished, apiResultHandler);
    route(PST, "/api/sync/check-entity-changes", [checkApiAuth], syncApiRoute.checkEntityChanges, apiResultHandler);
    route(PST, "/api/sync/queue-sector/:entityName/:sector", [checkApiAuth], syncApiRoute.queueSector, apiResultHandler);
    route(GET, "/api/sync/stats", [], syncApiRoute.getStats, apiResultHandler);

    //#region Import/export
    asyncRoute(PST, "/api/notes/:parentNoteId/notes-import", [checkApiAuthOrElectron, uploadMiddlewareWithErrorHandling, csrfMiddleware], importRoute.importNotesToBranch, apiResultHandler);
    route(PST, "/api/notes/:parentNoteId/attachments-import", [checkApiAuthOrElectron, uploadMiddlewareWithErrorHandling, csrfMiddleware], importRoute.importAttachmentsToNote, apiResultHandler);
    asyncRoute(GET, "/api/branches/:branchId/export/:type/:format/:version/:taskId", [checkApiAuthOrElectron], exportRoute.exportBranch);
    //#endregion

    apiRoute(GET, "/api/quick-search/:searchString", searchRoute.quickSearch);
    apiRoute(GET, "/api/search-note/:noteId", searchRoute.searchFromNote);
    apiRoute(PST, "/api/search-and-execute-note/:noteId", searchRoute.searchAndExecute);
    apiRoute(PST, "/api/search-related", searchRoute.getRelatedNotes);
    apiRoute(GET, "/api/search/:searchString", searchRoute.search);
    apiRoute(GET, "/api/search-templates", searchRoute.searchTemplates);

    apiRoute(GET, "/api/autocomplete", autocompleteApiRoute.getAutocomplete);
    apiRoute(GET, "/api/autocomplete/notesCount", autocompleteApiRoute.getNotesCount);

    apiRoute(PUT, "/api/notes/:noteId/clone-to-branch/:parentBranchId", cloningApiRoute.cloneNoteToBranch);
    apiRoute(PUT, "/api/notes/:noteId/toggle-in-parent/:parentNoteId/:present", cloningApiRoute.toggleNoteInParent);
    apiRoute(PUT, "/api/notes/:noteId/clone-to-note/:parentNoteId", cloningApiRoute.cloneNoteToParentNote);
    apiRoute(PUT, "/api/notes/:noteId/clone-after/:afterBranchId", cloningApiRoute.cloneNoteAfter);

    asyncApiRoute(GET, "/api/special-notes/inbox/:date", specialNotesRoute.getInboxNote);
    asyncApiRoute(GET, "/api/special-notes/days/:date", specialNotesRoute.getDayNote);
    asyncApiRoute(GET, "/api/special-notes/week-first-day/:date", specialNotesRoute.getWeekFirstDayNote);
    asyncApiRoute(GET, "/api/special-notes/weeks/:week", specialNotesRoute.getWeekNote);
    asyncApiRoute(GET, "/api/special-notes/months/:month", specialNotesRoute.getMonthNote);
    asyncApiRoute(GET, "/api/special-notes/quarters/:quarter", specialNotesRoute.getQuarterNote);
    apiRoute(GET, "/api/special-notes/years/:year", specialNotesRoute.getYearNote);
    apiRoute(GET, "/api/special-notes/notes-for-month/:month", specialNotesRoute.getDayNotesForMonth);
    apiRoute(PST, "/api/special-notes/sql-console", specialNotesRoute.createSqlConsole);
    asyncApiRoute(PST, "/api/special-notes/save-sql-console", specialNotesRoute.saveSqlConsole);
    apiRoute(PST, "/api/special-notes/search-note", specialNotesRoute.createSearchNote);
    apiRoute(PST, "/api/special-notes/save-search-note", specialNotesRoute.saveSearchNote);
    apiRoute(PST, "/api/special-notes/launchers/:noteId/reset", specialNotesRoute.resetLauncher);
    apiRoute(PST, "/api/special-notes/launchers/:parentNoteId/:launcherType", specialNotesRoute.createLauncher);
    apiRoute(PUT, "/api/special-notes/api-script-launcher", specialNotesRoute.createOrUpdateScriptLauncherFromApi);

    apiRoute(PST, "/api/note-map/:noteId/tree", noteMapRoute.getTreeMap);
    apiRoute(PST, "/api/note-map/:noteId/link", noteMapRoute.getLinkMap);
    apiRoute(GET, "/api/note-map/:noteId/backlinks", noteMapRoute.getBacklinks);
    apiRoute(GET, "/api/note-map/:noteId/backlink-count", noteMapRoute.getBacklinkCount);

    apiRoute(PST, "/api/recent-notes", recentNotesRoute.addRecentNote);

    apiRoute(GET, "/api/keyboard-actions", keysApiRoute.getKeyboardActions);
    apiRoute(GET, "/api/keyboard-shortcuts-for-notes", keysApiRoute.getShortcutsForNotes);

    apiRoute(GET, "/api/stats/note-size/:noteId", statsRoute.getNoteSize);
    apiRoute(GET, "/api/stats/subtree-size/:noteId", statsRoute.getSubtreeSize);

    apiRoute(GET, "/api/sql/schema", sqlRoute.getSchema);
    apiRoute(PST, "/api/sql/execute/:noteId", sqlRoute.execute);

    apiRoute(PST, "/api/bulk-action/execute", bulkActionRoute.execute);
    apiRoute(PST, "/api/bulk-action/affected-notes", bulkActionRoute.getAffectedNoteCount);

    apiRoute(GET, "/api/app-info", appInfoRoute.getAppInfo);
    asyncApiRoute(GET, "/api/backend-log", backendLogRoute.getBackendLog);

    // Backup routes
    asyncApiRoute(GET, "/api/database/backups", backupRoute.getExistingBackups);
    asyncApiRoute(PST, "/api/database/backup-database", backupRoute.backupDatabase);
    asyncRoute(GET, "/api/database/backup/download", [checkApiAuthOrElectron], backupRoute.downloadBackup);

    apiRoute(GET, "/api/other/icon-usage", otherRoute.getIconUsage);
    apiRoute(PST, "/api/other/render-markdown", otherRoute.renderMarkdown);
    apiRoute(PST, "/api/other/to-markdown", otherRoute.toMarkdown);

    asyncApiRoute(GET, "/api/similar-notes/:noteId", similarNotesRoute.getSimilarNotes);
    apiRoute(PST, "/api/relation-map", relationMapApiRoute.getRelationMap);
    apiRoute(GET, "/api/recent-changes/:ancestorNoteId", recentChangesApiRoute.getRecentChanges);

    //#region Files
    route(GET, "/api/notes/:noteId/open", [checkApiAuthOrElectron], filesRoute.openFile);
    route(GET, "/api/notes/:noteId/download", [checkApiAuthOrElectron], filesRoute.downloadFile);
    // this "hacky" path is used for easier referencing of CSS resources
    route(GET, "/api/notes/download/:noteId", [checkApiAuthOrElectron], filesRoute.downloadFile);
    route(GET, "/api/attachments/:attachmentId/open", [checkApiAuthOrElectron], filesRoute.openAttachment);
    route(GET, "/api/attachments/:attachmentId/download", [checkApiAuthOrElectron], filesRoute.downloadAttachment);
    // this "hacky" path is used for easier referencing of CSS resources
    route(GET, "/api/attachments/download/:attachmentId", [checkApiAuthOrElectron], filesRoute.downloadAttachment);
    //#endregion

    //#region Export
    asyncRoute(PST, "/api/script/exec", [checkApiAuth, csrfMiddleware], scriptRoute.exec, apiResultHandler);

    apiRoute(PST, "/api/script/run/:noteId", scriptRoute.run);
    apiRoute(GET, "/api/script/startup", scriptRoute.getStartupBundles);
    apiRoute(GET, "/api/script/widgets", scriptRoute.getWidgetBundles);
    apiRoute(PST, "/api/script/bundle/:noteId", scriptRoute.getBundle);
    apiRoute(GET, "/api/script/relation/:noteId/:relationName", scriptRoute.getRelationBundles);
    //#endregion

    //#region Password and protected session
    asyncApiRoute(PST, "/api/password/change", passwordApiRoute.changePassword);
    apiRoute(PST, "/api/password/reset", passwordApiRoute.resetPassword);

    asyncApiRoute(PST, "/api/login/protected", loginApiRoute.loginToProtectedSession);
    apiRoute(PST, "/api/login/protected/touch", loginApiRoute.touchProtectedSession);
    apiRoute(PST, "/api/logout/protected", loginApiRoute.logoutFromProtectedSession);
    //#endregion
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
