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
import spaceUsageRoute from "./api/space_usage";
import AbstractBeccaEntity from "../becca/entities/abstract_becca_entity";
import cloningApiRoute from "./api/cloning";
import sqlRoute from "./api/sql";
import attributesRoute from "./api/attributes";
import revisionsApiRoute from "./api/revisions";
import relationMapApiRoute from "./api/relation-map";
import recentChangesApiRoute from "./api/recent_changes";
import deletedNotesApiRoute from "./api/deleted_notes";
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
import databaseInfoRoute from "./api/database_info";
import passwordApiRoute from "./api/password";
import loginApiRoute from "./api/login";
import fontsRoute from "./api/fonts";
import flashcardsRoute from "./api/flashcards";
import ocrRoute from "./api/ocr";
import linkEmbedRoute from "./api/link_embed";
import llmRoute from "./api/llm";

// TODO: Deduplicate with routes.ts
const GET = "get",
    PST = "post",
    PUT = "put",
    PATCH = "patch",
    DEL = "delete";

interface SharedApiRoutesContext {
    route: any;
    asyncRoute: any;
    /**
     * Like `asyncRoute`, minus the transaction, on every platform.
     *
     * `asyncRoute` is transactional in the browser and not on the server, which is fine for handlers
     * that only read or write rows. It is not fine for the handful that close the database and open
     * another one: the transaction they started belongs to a connection that is gone by the time it
     * would be committed, and SQLite says so.
     */
    asyncRouteWithoutTransaction: any;
    apiRoute: any;
    asyncApiRoute: any;
    checkApiAuth: any;
    apiResultHandler: any;
    checkApiAuthOrElectron: any;
    checkAppNotInitialized: any;
    /**
     * Refuses a setup route where the wizard has a knowledge base behind it and has not been
     * unlocked with that knowledge base's password.
     *
     * Supplied by the platform rather than shared, because what may skip it is: the desktop's own
     * renderer arrives over a custom protocol and is trusted, an instance configured for no
     * authentication has nothing to check against, and a browser-only build is served to no one.
     */
    checkSetupAuth: any;
    loginRateLimiter: any;
    checkCredentials: any;
    uploadMiddlewareWithErrorHandling: any;
    importMiddlewareWithErrorHandling: any;
    csrfMiddleware: any;
}

export function buildSharedApiRoutes({ route, asyncRoute, asyncRouteWithoutTransaction, apiRoute, asyncApiRoute, checkApiAuth, apiResultHandler, checkApiAuthOrElectron, checkAppNotInitialized, checkSetupAuth, checkCredentials, loginRateLimiter, uploadMiddlewareWithErrorHandling, importMiddlewareWithErrorHandling, csrfMiddleware }: SharedApiRoutesContext) {
    apiRoute(GET, '/api/tree', treeApiRoute.getTree);
    apiRoute(PST, '/api/tree/load', treeApiRoute.load);

    apiRoute(GET, "/api/options", optionsApiRoute.getOptions);
    // FIXME: possibly change to sending value in the body to avoid host of HTTP server issues with slashes
    asyncApiRoute(PUT, "/api/options/:name/:value", optionsApiRoute.updateOption);
    asyncApiRoute(PUT, "/api/options", optionsApiRoute.updateOptions);
    apiRoute(GET, "/api/options/user-themes", optionsApiRoute.getUserThemes);

    apiRoute(PST, "/api/notes/:noteId/convert-to-attachment", notesApiRoute.convertNoteToAttachment);
    apiRoute(PST, "/api/notes/:noteId/convert-format", notesApiRoute.convertNoteFormat);
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

    apiRoute(GET, "/api/flashcards/decks", flashcardsRoute.getDecks);
    apiRoute(GET, "/api/flashcards/due", flashcardsRoute.getDueCards);
    apiRoute(GET, "/api/flashcards/stats", flashcardsRoute.getStats);
    apiRoute(GET, "/api/flashcards/settings", flashcardsRoute.getSettings);
    apiRoute(PUT, "/api/flashcards/settings", flashcardsRoute.setSettings);
    apiRoute(PST, "/api/flashcards/cards", flashcardsRoute.createCard);
    apiRoute(DEL, "/api/flashcards/notes/:noteId/cards", flashcardsRoute.removeCardsForNote);
    apiRoute(GET, "/api/flashcards/notes/:noteId/card", flashcardsRoute.getCardForNote);
    apiRoute(GET, "/api/flashcards/cards/:cardId", flashcardsRoute.getCard);
    apiRoute(GET, "/api/flashcards/cards/:cardId/preview", flashcardsRoute.getPreview);
    apiRoute(PUT, "/api/flashcards/cards/:cardId/suspended", flashcardsRoute.setSuspended);
    apiRoute(PST, "/api/flashcards/cards/:cardId/reset", flashcardsRoute.resetCard);
    apiRoute(PST, "/api/flashcards/cards/:cardId/bury", flashcardsRoute.buryCard);
    apiRoute(PUT, "/api/flashcards/cards/:cardId/deck", flashcardsRoute.moveCardToDeck);
    apiRoute(PST, "/api/flashcards/reviews/undo", flashcardsRoute.undoReview);
    apiRoute(PST, "/api/flashcards/cards/:cardId/reviews", flashcardsRoute.reviewCard);

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
    asyncRoute(PUT, "/api/images/:noteId", [checkApiAuthOrElectron, uploadMiddlewareWithErrorHandling, csrfMiddleware], imageRoute.updateImage, apiResultHandler);
    // Readings rather than runs: headers only, so they are cheap enough to open a dialog with.
    apiRoute(GET, "/api/notes/:noteId/image-info", imageRoute.getNoteImageInfo);
    apiRoute(GET, "/api/attachments/:attachmentId/image-info", imageRoute.getAttachmentImageInfo);
    apiRoute(GET, "/api/notes/:noteId/image-inventory", imageRoute.getImageInventory);
    // Recompressing decodes and re-encodes each image, so these run outside a transaction and open
    // one per image written instead of holding a single one across the whole (asynchronous) run.
    asyncApiRoute(PST, "/api/notes/:noteId/compress-images", imageRoute.compressNoteImages);
    apiRoute(PST, "/api/image-compression/:taskId/cancel", imageRoute.cancelImageCompression);
    asyncApiRoute(PST, "/api/attachments/:attachmentId/compress-image", imageRoute.compressAttachmentImage);
    asyncRoute(PST, "/api/notes/:noteId/attachments/upload", [checkApiAuthOrElectron, uploadMiddlewareWithErrorHandling, csrfMiddleware], attachmentsApiRoute.uploadAttachment, apiResultHandler);

    // POSTed rather than taking the URL in a query string: a link can carry a one-time token or a
    // signature, and a query string ends up in every access log along the way.
    asyncApiRoute(PST, "/api/link-embed/metadata", linkEmbedRoute.getMetadata);

    // group of the services below are meant to be executed from the outside
    // Not transactional: a status read needs no transaction, and one is unopenable during the moment
    // a restore has the database detached — which is exactly when the wizard is polling hardest.
    asyncRoute(GET, "/api/setup/status", [], setupApiRoute.getStatus, apiResultHandler);
    // The password of the knowledge base the wizard is standing over, which is what unlocks every
    // route below that could replace it. Rate limited like the application's own login.
    asyncRoute(PST, "/api/setup/auth", [checkAppNotInitialized, loginRateLimiter], setupApiRoute.authenticate, apiResultHandler);
    // Both erase the knowledge base the wizard was booted away from before they create anything, so
    // neither may be wrapped in a transaction: erasing closes the connection such a transaction
    // would belong to, and the browser then has nothing left to commit it against. Each creates its
    // database inside transactions of its own, which is what the erasure has to stay outside of.
    asyncRouteWithoutTransaction(PST, "/api/setup/new-document", [checkAppNotInitialized, checkSetupAuth], setupApiRoute.setupNewDocument, apiResultHandler);
    asyncRouteWithoutTransaction(PST, "/api/setup/sync-from-server", [checkAppNotInitialized, checkSetupAuth], setupApiRoute.setupSyncFromServer, apiResultHandler);
    route(GET, "/api/setup/sync-seed", [loginRateLimiter, checkCredentials], setupApiRoute.getSyncSeed, apiResultHandler);
    // Pushed by the other device rather than asked for here, so it cannot carry a token of ours.
    // Refused from inside instead, while there is a knowledge base to lose: see `saveSyncSeed`.
    asyncRoute(PST, "/api/setup/sync-seed", [checkAppNotInitialized], setupApiRoute.saveSyncSeed, apiResultHandler);
    // The setup routes that belong to a running instance rather than to one without a database:
    // this is how the app asks the next start to be the wizard, and how it takes the request back.
    // Authenticated like the rest of the running app, which is what keeps a passer-by from sending
    // somebody else's instance to a screen that can erase it.
    //
    // `checkSetupAuth` as well, spelled out rather than taken from `asyncApiRoute`, because the
    // session check above stands down on an instance that reports itself uninitialized — which is
    // exactly what an instance sitting in the wizard does. Without it these three are the one part
    // of the wizard a passer-by could still reach, to re-arm a start-over or to call off one the
    // owner is waiting to act on.
    asyncRoute(PST, "/api/setup/boot", [checkApiAuth, checkSetupAuth, csrfMiddleware], setupApiRoute.bootToSetup, apiResultHandler);
    asyncRoute(GET, "/api/setup/boot", [checkApiAuth, checkSetupAuth, csrfMiddleware], setupApiRoute.isBootToSetupRequested, apiResultHandler);
    asyncRoute(DEL, "/api/setup/boot", [checkApiAuth, checkSetupAuth, csrfMiddleware], setupApiRoute.cancelBootToSetup, apiResultHandler);

    // What becomes of the database the wizard was booted away from. Guarded like the rest of setup,
    // and refused again inside on an instance that has no such database. Not transactional: the
    // backup runs for minutes, and keeping the database reopens it.
    // Without a transaction, on every platform: the backup runs for minutes with the database in
    // use, and erasing or keeping it closes the connection any transaction would belong to.
    asyncRouteWithoutTransaction(PST, "/api/setup/existing/backup", [checkAppNotInitialized, checkSetupAuth], setupApiRoute.backUpExisting, apiResultHandler);
    asyncRouteWithoutTransaction(GET, "/api/setup/existing/backup-defaults", [checkAppNotInitialized, checkSetupAuth], setupApiRoute.existingBackupDefaults, apiResultHandler);
    asyncRouteWithoutTransaction(GET, "/api/setup/existing/status", [checkAppNotInitialized, checkSetupAuth], setupApiRoute.existingBackupStatus, apiResultHandler);
    asyncRouteWithoutTransaction(PST, "/api/setup/existing/delete", [checkAppNotInitialized, checkSetupAuth], setupApiRoute.deleteExisting, apiResultHandler);
    asyncRouteWithoutTransaction(PST, "/api/setup/existing/keep", [checkAppNotInitialized, checkSetupAuth], setupApiRoute.keepExisting, apiResultHandler);

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
    asyncRoute(PST, "/api/notes/:parentNoteId/notes-import", [checkApiAuthOrElectron, importMiddlewareWithErrorHandling, csrfMiddleware], importRoute.importNotesToBranch, apiResultHandler);
    asyncRoute(PST, "/api/notes/:parentNoteId/attachments-import", [checkApiAuthOrElectron, importMiddlewareWithErrorHandling, csrfMiddleware], importRoute.importAttachmentsToNote, apiResultHandler);
    asyncRoute(GET, "/api/branches/:branchId/export/:type/:format/:taskId", [checkApiAuthOrElectron], exportRoute.exportBranch);
    //#endregion

    apiRoute(GET, "/api/quick-search/:searchString", searchRoute.quickSearch);
    apiRoute(GET, "/api/search-note/:noteId", searchRoute.searchFromNote);
    apiRoute(PST, "/api/search-and-execute-note/:noteId", searchRoute.searchAndExecute);
    apiRoute(PST, "/api/search-related", searchRoute.getRelatedNotes);
    apiRoute(GET, "/api/search/:searchString", searchRoute.search);
    apiRoute(GET, "/api/search-templates", searchRoute.searchTemplates);

    // Streaming a chat is not here — it has no single form every runtime can serve.
    // The server and the desktop app answer `/api/llm-chat/stream` with Server-Sent
    // Events; standalone, whose bridge cannot hold a response open, registers
    // `llmRoute.startChatStream` itself. See `apps/standalone`'s browser_routes.ts.
    asyncApiRoute(PST, "/api/llm-chat/provider-models", llmRoute.getProviderModels);

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
    apiRoute(PST, "/api/special-notes/llm-chat", specialNotesRoute.createLlmChat);
    apiRoute(GET, "/api/special-notes/most-recent-llm-chat", specialNotesRoute.getMostRecentLlmChat);
    apiRoute(GET, "/api/special-notes/get-or-create-llm-chat", specialNotesRoute.getOrCreateLlmChat);
    apiRoute(GET, "/api/special-notes/recent-llm-chats", specialNotesRoute.getRecentLlmChats);
    apiRoute(PST, "/api/special-notes/save-llm-chat", specialNotesRoute.saveLlmChat);

    apiRoute(PST, "/api/note-map/:noteId/tree", noteMapRoute.getTreeMap);
    apiRoute(PST, "/api/note-map/:noteId/link", noteMapRoute.getLinkMap);
    apiRoute(GET, "/api/note-map/:noteId/backlinks", noteMapRoute.getBacklinks);
    apiRoute(GET, "/api/note-map/:noteId/backlink-count", noteMapRoute.getBacklinkCount);

    apiRoute(PST, "/api/recent-notes", recentNotesRoute.addRecentNote);

    apiRoute(GET, "/api/keyboard-actions", keysApiRoute.getKeyboardActions);
    apiRoute(GET, "/api/keyboard-shortcuts-for-notes", keysApiRoute.getShortcutsForNotes);

    apiRoute(GET, "/api/stats/note-size/:noteId", statsRoute.getNoteSize);
    apiRoute(GET, "/api/stats/subtree-size/:noteId", statsRoute.getSubtreeSize);

    apiRoute(GET, "/api/space-usage/overview", spaceUsageRoute.getOverview);
    apiRoute(GET, "/api/space-usage/note/:noteId", spaceUsageRoute.getNoteUsage);
    apiRoute(PST, "/api/space-usage/cleanup-completed", spaceUsageRoute.logCleanupCompleted);

    apiRoute(GET, "/api/sql/schema", sqlRoute.getSchema);
    apiRoute(PST, "/api/sql/execute/:noteId", sqlRoute.execute);

    apiRoute(PST, "/api/bulk-action/execute", bulkActionRoute.execute);
    apiRoute(PST, "/api/bulk-action/affected-notes", bulkActionRoute.getAffectedNoteCount);

    apiRoute(GET, "/api/app-info", appInfoRoute.getAppInfo);
    asyncApiRoute(GET, "/api/backend-log", backendLogRoute.getBackendLog);

    apiRoute(GET, "/api/database/info", databaseInfoRoute.getDatabaseInfo);

    // Backup routes
    asyncApiRoute(GET, "/api/database/backups", backupRoute.getExistingBackups);
    asyncApiRoute(PST, "/api/database/backup-database", backupRoute.backupDatabase);
    asyncRoute(GET, "/api/database/backup/download", [checkApiAuthOrElectron], backupRoute.downloadBackup);

    apiRoute(GET, "/api/other/icon-usage", otherRoute.getIconUsage);
    apiRoute(PST, "/api/other/render-markdown", otherRoute.renderMarkdown);
    apiRoute(PST, "/api/other/to-markdown", otherRoute.toMarkdown);

    route(GET, "/api/fonts", [checkApiAuthOrElectron], fontsRoute.getFontCss);

    asyncApiRoute(GET, "/api/similar-notes/:noteId", similarNotesRoute.getSimilarNotes);
    apiRoute(PST, "/api/relation-map", relationMapApiRoute.getRelationMap);
    apiRoute(GET, "/api/recent-changes/:ancestorNoteId", recentChangesApiRoute.getRecentChanges);

    apiRoute(GET, "/api/deleted-notes/:noteId/metadata", deletedNotesApiRoute.getDeletedNoteMetadata);
    apiRoute(GET, "/api/deleted-notes/:noteId/blob", deletedNotesApiRoute.getDeletedNoteBlob);

    //#region Files
    route(GET, "/api/notes/:noteId/open", [checkApiAuthOrElectron], filesRoute.openFile);
    // What the media players stream from: same content as /open, but answering byte ranges so they can seek.
    route(GET, "/api/notes/:noteId/open-partial", [checkApiAuthOrElectron], filesRoute.openPartialFile);
    route(GET, "/api/attachments/:attachmentId/open-partial", [checkApiAuthOrElectron], filesRoute.openPartialAttachment);
    asyncApiRoute(GET, "/api/notes/:noteId/office-preview", filesRoute.getNoteOfficePreview);
    asyncApiRoute(GET, "/api/attachments/:attachmentId/office-preview", filesRoute.getAttachmentOfficePreview);
    route(GET, "/api/notes/:noteId/download", [checkApiAuthOrElectron], filesRoute.downloadFile);
    // this "hacky" path is used for easier referencing of CSS resources
    route(GET, "/api/notes/download/:noteId", [checkApiAuthOrElectron], filesRoute.downloadFile);
    route(GET, "/api/attachments/:attachmentId/open", [checkApiAuthOrElectron], filesRoute.openAttachment);
    route(GET, "/api/attachments/:attachmentId/download", [checkApiAuthOrElectron], filesRoute.downloadAttachment);
    // this "hacky" path is used for easier referencing of CSS resources
    route(GET, "/api/attachments/download/:attachmentId", [checkApiAuthOrElectron], filesRoute.downloadAttachment);
    route(GET, "/api/revisions/:revisionId/download", [checkApiAuthOrElectron], revisionsApiRoute.downloadRevision);
    route(PUT, "/api/notes/:noteId/file", [checkApiAuthOrElectron, uploadMiddlewareWithErrorHandling, csrfMiddleware], filesRoute.updateFile, apiResultHandler);
    route(PUT, "/api/attachments/:attachmentId/file", [checkApiAuthOrElectron, uploadMiddlewareWithErrorHandling, csrfMiddleware], filesRoute.updateAttachment, apiResultHandler);

    // Reading the OCR text only. Extracting it needs the engine, which stays in the server — but the
    // text is stored on the blob and syncs with it, so every client can show what was extracted.
    apiRoute(GET, "/api/ocr/notes/:noteId/text", ocrRoute.getNoteOCRText);
    apiRoute(GET, "/api/ocr/attachments/:attachmentId/text", ocrRoute.getAttachmentOCRText);
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
