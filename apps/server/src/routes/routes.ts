import { isElectron } from "../services/utils.js";
import express from "express";

import auth from "../services/auth.js";
import openID from '../services/open_id.js';
import totp from './api/totp.js';
import recoveryCodes from './api/recovery_codes.js';
import { doubleCsrfProtection as csrfMiddleware } from "./csrf_protection.js";
import { createPartialContentHandler } from "@triliumnext/express-partial-content";
import rateLimit from "express-rate-limit";

// page routes
import setupRoute from "./setup.js";
import loginRoute from "./login.js";
import indexRoute from "./index.js";

// API routes
import treeApiRoute from "./api/tree.js";
import notesApiRoute from "./api/notes.js";
import branchesApiRoute from "./api/branches.js";
import attachmentsApiRoute from "./api/attachments.js";
import autocompleteApiRoute from "./api/autocomplete.js";
import cloningApiRoute from "./api/cloning.js";
import revisionsApiRoute from "./api/revisions.js";
import recentChangesApiRoute from "./api/recent_changes.js";
import optionsApiRoute from "./api/options.js";
import passwordApiRoute from "./api/password.js";
import syncApiRoute from "./api/sync.js";
import loginApiRoute from "./api/login.js";
import recentNotesRoute from "./api/recent_notes.js";
import appInfoRoute from "./api/app_info.js";
import exportRoute from "./api/export.js";
import importRoute from "./api/import.js";
import setupApiRoute from "./api/setup.js";
import sqlRoute from "./api/sql.js";
import databaseRoute from "./api/database.js";
import imageRoute from "./api/image.js";
import attributesRoute from "./api/attributes.js";
import scriptRoute from "./api/script.js";
import senderRoute from "./api/sender.js";
import filesRoute from "./api/files.js";
import searchRoute from "./api/search.js";
import bulkActionRoute from "./api/bulk_action.js";
import specialNotesRoute from "./api/special_notes.js";
import noteMapRoute from "./api/note_map.js";
import clipperRoute from "./api/clipper.js";
import similarNotesRoute from "./api/similar_notes.js";
import keysRoute from "./api/keys.js";
import backendLogRoute from "./api/backend_log.js";
import statsRoute from "./api/stats.js";
import fontsRoute from "./api/fonts.js";
import etapiTokensApiRoutes from "./api/etapi_tokens.js";
import relationMapApiRoute from "./api/relation-map.js";
import otherRoute from "./api/other.js";
import metricsRoute from "./api/metrics.js";
import shareRoutes from "../share/routes.js";
import ollamaRoute from "./api/ollama.js";
import openaiRoute from "./api/openai.js";
import anthropicRoute from "./api/anthropic.js";
import llmRoute from "./api/llm.js";
import systemInfoRoute from "./api/system_info.js";

import etapiAuthRoutes from "../etapi/auth.js";
import etapiAppInfoRoutes from "../etapi/app_info.js";
import etapiAttachmentRoutes from "../etapi/attachments.js";
import etapiAttributeRoutes from "../etapi/attributes.js";
import etapiBranchRoutes from "../etapi/branches.js";
import etapiNoteRoutes from "../etapi/notes.js";
import etapiSpecialNoteRoutes from "../etapi/special_notes.js";
import etapiSpecRoute from "../etapi/spec.js";
import etapiBackupRoute from "../etapi/backup.js";
import etapiMetricsRoute from "../etapi/metrics.js";
import { apiResultHandler, apiRoute, asyncApiRoute, asyncRoute, route, router, uploadMiddlewareWithErrorHandling } from "./route_api.js";

const GET = "get",
    PST = "post",
    PUT = "put",
    PATCH = "patch",
    DEL = "delete";

function register(app: express.Application) {
    route(GET, "/", [auth.checkAuth, csrfMiddleware], indexRoute.index);
    route(GET, "/login", [auth.checkAppInitialized, auth.checkPasswordSet], loginRoute.loginPage);
    route(GET, "/set-password", [auth.checkAppInitialized, auth.checkPasswordNotSet], loginRoute.setPasswordPage);

    const loginRateLimiter = rateLimit({
        windowMs: 15 * 60 * 1000, // 15 minutes
        max: 10, // limit each IP to 10 requests per windowMs
        skipSuccessfulRequests: true // successful auth to rate-limited ETAPI routes isn't counted. However, successful auth to /login is still counted!
    });

    route(PST, "/login", [loginRateLimiter], loginRoute.login);
    route(PST, "/logout", [csrfMiddleware, auth.checkAuth], loginRoute.logout);
    route(PST, "/set-password", [auth.checkAppInitialized, auth.checkPasswordNotSet], loginRoute.setPassword);
    route(GET, "/setup", [], setupRoute.setupPage);


    apiRoute(GET, '/api/totp/generate', totp.generateSecret);
    apiRoute(GET, '/api/totp/status', totp.getTOTPStatus);
    apiRoute(GET, '/api/totp/get', totp.getSecret);

    apiRoute(GET, '/api/oauth/status', openID.getOAuthStatus);
    asyncApiRoute(GET, '/api/oauth/validate', openID.isTokenValid);

    apiRoute(PST, '/api/totp_recovery/set', recoveryCodes.setRecoveryCodes);
    apiRoute(PST, '/api/totp_recovery/verify', recoveryCodes.verifyRecoveryCode);
    apiRoute(GET, '/api/totp_recovery/generate', recoveryCodes.generateRecoveryCodes);
    apiRoute(GET, '/api/totp_recovery/enabled', recoveryCodes.checkForRecoveryKeys);
    apiRoute(GET, '/api/totp_recovery/used', recoveryCodes.getUsedRecoveryCodes);

    apiRoute(GET, '/api/tree', treeApiRoute.getTree);
    apiRoute(PST, '/api/tree/load', treeApiRoute.load);

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
    apiRoute(PUT, "/api/notes/:noteId/clone-to-branch/:parentBranchId", cloningApiRoute.cloneNoteToBranch);
    apiRoute(PUT, "/api/notes/:noteId/toggle-in-parent/:parentNoteId/:present", cloningApiRoute.toggleNoteInParent);
    apiRoute(PUT, "/api/notes/:noteId/clone-to-note/:parentNoteId", cloningApiRoute.cloneNoteToParentNote);
    apiRoute(PUT, "/api/notes/:noteId/clone-after/:afterBranchId", cloningApiRoute.cloneNoteAfter);
    route(PUT, "/api/notes/:noteId/file", [auth.checkApiAuthOrElectron, uploadMiddlewareWithErrorHandling, csrfMiddleware], filesRoute.updateFile, apiResultHandler);
    route(GET, "/api/notes/:noteId/open", [auth.checkApiAuthOrElectron], filesRoute.openFile);
    asyncRoute(
        GET,
        "/api/notes/:noteId/open-partial",
        [auth.checkApiAuthOrElectron],
        createPartialContentHandler(filesRoute.fileContentProvider, {
            debug: (string, extra) => {
                console.log(string, extra);
            }
        })
    );
    route(GET, "/api/notes/:noteId/download", [auth.checkApiAuthOrElectron], filesRoute.downloadFile);
    // this "hacky" path is used for easier referencing of CSS resources
    route(GET, "/api/notes/download/:noteId", [auth.checkApiAuthOrElectron], filesRoute.downloadFile);
    apiRoute(PST, "/api/notes/:noteId/save-to-tmp-dir", filesRoute.saveNoteToTmpDir);
    apiRoute(PST, "/api/notes/:noteId/upload-modified-file", filesRoute.uploadModifiedFileToNote);
    apiRoute(PST, "/api/notes/:noteId/convert-to-attachment", notesApiRoute.convertNoteToAttachment);

    apiRoute(PUT, "/api/branches/:branchId/move-to/:parentBranchId", branchesApiRoute.moveBranchToParent);
    apiRoute(PUT, "/api/branches/:branchId/move-before/:beforeBranchId", branchesApiRoute.moveBranchBeforeNote);
    apiRoute(PUT, "/api/branches/:branchId/move-after/:afterBranchId", branchesApiRoute.moveBranchAfterNote);
    apiRoute(PUT, "/api/branches/:branchId/expanded/:expanded", branchesApiRoute.setExpanded);
    apiRoute(PUT, "/api/branches/:branchId/expanded-subtree/:expanded", branchesApiRoute.setExpandedForSubtree);
    apiRoute(DEL, "/api/branches/:branchId", branchesApiRoute.deleteBranch);
    apiRoute(PUT, "/api/branches/:branchId/set-prefix", branchesApiRoute.setPrefix);
    apiRoute(PUT, "/api/branches/set-prefix-batch", branchesApiRoute.setPrefixBatch);

    apiRoute(GET, "/api/notes/:noteId/attachments", attachmentsApiRoute.getAttachments);
    apiRoute(PST, "/api/notes/:noteId/attachments", attachmentsApiRoute.saveAttachment);
    route(PST, "/api/notes/:noteId/attachments/upload", [auth.checkApiAuthOrElectron, uploadMiddlewareWithErrorHandling, csrfMiddleware], attachmentsApiRoute.uploadAttachment, apiResultHandler);
    apiRoute(GET, "/api/attachments/:attachmentId", attachmentsApiRoute.getAttachment);
    apiRoute(GET, "/api/attachments/:attachmentId/all", attachmentsApiRoute.getAllAttachments);
    apiRoute(PST, "/api/attachments/:attachmentId/convert-to-note", attachmentsApiRoute.convertAttachmentToNote);
    apiRoute(DEL, "/api/attachments/:attachmentId", attachmentsApiRoute.deleteAttachment);
    apiRoute(PUT, "/api/attachments/:attachmentId/rename", attachmentsApiRoute.renameAttachment);
    apiRoute(GET, "/api/attachments/:attachmentId/blob", attachmentsApiRoute.getAttachmentBlob);
    route(GET, "/api/attachments/:attachmentId/image/:filename", [auth.checkApiAuthOrElectron], imageRoute.returnAttachedImage);
    route(GET, "/api/attachments/:attachmentId/open", [auth.checkApiAuthOrElectron], filesRoute.openAttachment);
    asyncRoute(
        GET,
        "/api/attachments/:attachmentId/open-partial",
        [auth.checkApiAuthOrElectron],
        createPartialContentHandler(filesRoute.attachmentContentProvider, {
            debug: (string, extra) => {
                console.log(string, extra);
            }
        })
    );
    route(GET, "/api/attachments/:attachmentId/download", [auth.checkApiAuthOrElectron], filesRoute.downloadAttachment);
    // this "hacky" path is used for easier referencing of CSS resources
    route(GET, "/api/attachments/download/:attachmentId", [auth.checkApiAuthOrElectron], filesRoute.downloadAttachment);
    apiRoute(PST, "/api/attachments/:attachmentId/save-to-tmp-dir", filesRoute.saveAttachmentToTmpDir);
    apiRoute(PST, "/api/attachments/:attachmentId/upload-modified-file", filesRoute.uploadModifiedFileToAttachment);
    route(PUT, "/api/attachments/:attachmentId/file", [auth.checkApiAuthOrElectron, uploadMiddlewareWithErrorHandling, csrfMiddleware], filesRoute.updateAttachment, apiResultHandler);

    apiRoute(GET, "/api/notes/:noteId/revisions", revisionsApiRoute.getRevisions);
    apiRoute(DEL, "/api/notes/:noteId/revisions", revisionsApiRoute.eraseAllRevisions);
    apiRoute(PST, "/api/revisions/erase-all-excess-revisions", revisionsApiRoute.eraseAllExcessRevisions);
    apiRoute(GET, "/api/revisions/:revisionId", revisionsApiRoute.getRevision);
    apiRoute(GET, "/api/revisions/:revisionId/blob", revisionsApiRoute.getRevisionBlob);
    apiRoute(DEL, "/api/revisions/:revisionId", revisionsApiRoute.eraseRevision);
    apiRoute(PST, "/api/revisions/:revisionId/restore", revisionsApiRoute.restoreRevision);
    route(GET, "/api/revisions/:revisionId/image/:filename", [auth.checkApiAuthOrElectron], imageRoute.returnImageFromRevision);

    route(GET, "/api/revisions/:revisionId/download", [auth.checkApiAuthOrElectron], revisionsApiRoute.downloadRevision);

    route(GET, "/api/branches/:branchId/export/:type/:format/:version/:taskId", [auth.checkApiAuthOrElectron], exportRoute.exportBranch);
    asyncRoute(PST, "/api/notes/:parentNoteId/notes-import", [auth.checkApiAuthOrElectron, uploadMiddlewareWithErrorHandling, csrfMiddleware], importRoute.importNotesToBranch, apiResultHandler);
    route(PST, "/api/notes/:parentNoteId/attachments-import", [auth.checkApiAuthOrElectron, uploadMiddlewareWithErrorHandling, csrfMiddleware], importRoute.importAttachmentsToNote, apiResultHandler);

    apiRoute(GET, "/api/notes/:noteId/attributes", attributesRoute.getEffectiveNoteAttributes);
    apiRoute(PST, "/api/notes/:noteId/attributes", attributesRoute.addNoteAttribute);
    apiRoute(PUT, "/api/notes/:noteId/attributes", attributesRoute.updateNoteAttributes);
    apiRoute(PUT, "/api/notes/:noteId/attribute", attributesRoute.updateNoteAttribute);
    apiRoute(PUT, "/api/notes/:noteId/set-attribute", attributesRoute.setNoteAttribute);
    apiRoute(PUT, "/api/notes/:noteId/relations/:name/to/:targetNoteId", attributesRoute.createRelation);
    apiRoute(DEL, "/api/notes/:noteId/relations/:name/to/:targetNoteId", attributesRoute.deleteRelation);
    apiRoute(DEL, "/api/notes/:noteId/attributes/:attributeId", attributesRoute.deleteNoteAttribute);
    apiRoute(GET, "/api/attribute-names", attributesRoute.getAttributeNames);
    apiRoute(GET, "/api/attribute-values/:attributeName", attributesRoute.getValuesForAttribute);

    // :filename is not used by trilium, but instead used for "save as" to assign a human-readable filename
    route(GET, "/api/images/:noteId/:filename", [auth.checkApiAuthOrElectron], imageRoute.returnImageFromNote);
    route(PUT, "/api/images/:noteId", [auth.checkApiAuthOrElectron, uploadMiddlewareWithErrorHandling, csrfMiddleware], imageRoute.updateImage, apiResultHandler);

    apiRoute(GET, "/api/options", optionsApiRoute.getOptions);
    // FIXME: possibly change to sending value in the body to avoid host of HTTP server issues with slashes
    apiRoute(PUT, "/api/options/:name/:value", optionsApiRoute.updateOption);
    apiRoute(PUT, "/api/options", optionsApiRoute.updateOptions);
    apiRoute(GET, "/api/options/user-themes", optionsApiRoute.getUserThemes);
    apiRoute(GET, "/api/options/locales", optionsApiRoute.getSupportedLocales);

    apiRoute(PST, "/api/password/change", passwordApiRoute.changePassword);
    apiRoute(PST, "/api/password/reset", passwordApiRoute.resetPassword);

    asyncApiRoute(PST, "/api/sync/test", syncApiRoute.testSync);
    asyncApiRoute(PST, "/api/sync/now", syncApiRoute.syncNow);
    apiRoute(PST, "/api/sync/fill-entity-changes", syncApiRoute.fillEntityChanges);
    apiRoute(PST, "/api/sync/force-full-sync", syncApiRoute.forceFullSync);
    route(GET, "/api/sync/check", [auth.checkApiAuth], syncApiRoute.checkSync, apiResultHandler);
    route(GET, "/api/sync/changed", [auth.checkApiAuth], syncApiRoute.getChanged, apiResultHandler);
    route(PUT, "/api/sync/update", [auth.checkApiAuth], syncApiRoute.update, apiResultHandler);
    route(PST, "/api/sync/finished", [auth.checkApiAuth], syncApiRoute.syncFinished, apiResultHandler);
    route(PST, "/api/sync/check-entity-changes", [auth.checkApiAuth], syncApiRoute.checkEntityChanges, apiResultHandler);
    route(PST, "/api/sync/queue-sector/:entityName/:sector", [auth.checkApiAuth], syncApiRoute.queueSector, apiResultHandler);
    route(GET, "/api/sync/stats", [], syncApiRoute.getStats, apiResultHandler);

    apiRoute(PST, "/api/recent-notes", recentNotesRoute.addRecentNote);
    apiRoute(GET, "/api/app-info", appInfoRoute.getAppInfo);
    apiRoute(GET, "/api/metrics", metricsRoute.getMetrics);
    apiRoute(GET, "/api/system-checks", systemInfoRoute.systemChecks);

    // docker health check
    route(GET, "/api/health-check", [], () => ({ status: "ok" }), apiResultHandler);

    // group of the services below are meant to be executed from the outside
    route(GET, "/api/setup/status", [], setupApiRoute.getStatus, apiResultHandler);
    asyncRoute(PST, "/api/setup/new-document", [auth.checkAppNotInitialized], setupApiRoute.setupNewDocument, apiResultHandler);
    asyncRoute(PST, "/api/setup/sync-from-server", [auth.checkAppNotInitialized], setupApiRoute.setupSyncFromServer, apiResultHandler);
    route(GET, "/api/setup/sync-seed", [loginRateLimiter, auth.checkCredentials], setupApiRoute.getSyncSeed, apiResultHandler);
    asyncRoute(PST, "/api/setup/sync-seed", [auth.checkAppNotInitialized], setupApiRoute.saveSyncSeed, apiResultHandler);

    apiRoute(GET, "/api/autocomplete", autocompleteApiRoute.getAutocomplete);
    apiRoute(GET, "/api/autocomplete/notesCount", autocompleteApiRoute.getNotesCount);
    apiRoute(GET, "/api/quick-search/:searchString", searchRoute.quickSearch);
    apiRoute(GET, "/api/search-note/:noteId", searchRoute.searchFromNote);
    apiRoute(PST, "/api/search-and-execute-note/:noteId", searchRoute.searchAndExecute);
    apiRoute(PST, "/api/search-related", searchRoute.getRelatedNotes);
    apiRoute(GET, "/api/search/:searchString", searchRoute.search);
    apiRoute(GET, "/api/search-templates", searchRoute.searchTemplates);

    apiRoute(PST, "/api/bulk-action/execute", bulkActionRoute.execute);
    apiRoute(PST, "/api/bulk-action/affected-notes", bulkActionRoute.getAffectedNoteCount);

    route(PST, "/api/login/sync", [loginRateLimiter], loginApiRoute.loginSync, apiResultHandler);
    // this is for entering protected mode so user has to be already logged-in (that's the reason we don't require username)
    apiRoute(PST, "/api/login/protected", loginApiRoute.loginToProtectedSession);
    apiRoute(PST, "/api/login/protected/touch", loginApiRoute.touchProtectedSession);
    apiRoute(PST, "/api/logout/protected", loginApiRoute.logoutFromProtectedSession);

    route(PST, "/api/login/token", [loginRateLimiter], loginApiRoute.token, apiResultHandler);

    apiRoute(GET, "/api/etapi-tokens", etapiTokensApiRoutes.getTokens);
    apiRoute(PST, "/api/etapi-tokens", etapiTokensApiRoutes.createToken);
    apiRoute(PATCH, "/api/etapi-tokens/:etapiTokenId", etapiTokensApiRoutes.patchToken);
    apiRoute(DEL, "/api/etapi-tokens/:etapiTokenId", etapiTokensApiRoutes.deleteToken);

    // in case of local electron, local calls are allowed unauthenticated, for server they need auth
    const clipperMiddleware = isElectron ? [] : [auth.checkEtapiToken];

    route(GET, "/api/clipper/handshake", clipperMiddleware, clipperRoute.handshake, apiResultHandler);
    asyncRoute(PST, "/api/clipper/clippings", clipperMiddleware, clipperRoute.addClipping, apiResultHandler);
    asyncRoute(PST, "/api/clipper/notes", clipperMiddleware, clipperRoute.createNote, apiResultHandler);
    route(PST, "/api/clipper/open/:noteId", clipperMiddleware, clipperRoute.openNote, apiResultHandler);
    asyncRoute(GET, "/api/clipper/notes-by-url/:noteUrl", clipperMiddleware, clipperRoute.findNotesByUrl, apiResultHandler);

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

    apiRoute(GET, "/api/sql/schema", sqlRoute.getSchema);
    apiRoute(PST, "/api/sql/execute/:noteId", sqlRoute.execute);
    asyncRoute(PST, "/api/database/anonymize/:type", [auth.checkApiAuthOrElectron, csrfMiddleware], databaseRoute.anonymize, apiResultHandler);
    apiRoute(GET, "/api/database/anonymized-databases", databaseRoute.getExistingAnonymizedDatabases);

    if (process.env.TRILIUM_INTEGRATION_TEST === "memory") {
        asyncRoute(PST, "/api/database/rebuild/", [auth.checkApiAuthOrElectron], databaseRoute.rebuildIntegrationTestDatabase, apiResultHandler);
    }

    // backup requires execution outside of transaction
    asyncRoute(PST, "/api/database/backup-database", [auth.checkApiAuthOrElectron, csrfMiddleware], databaseRoute.backupDatabase, apiResultHandler);
    apiRoute(GET, "/api/database/backups", databaseRoute.getExistingBackups);

    // VACUUM requires execution outside of transaction
    asyncRoute(PST, "/api/database/vacuum-database", [auth.checkApiAuthOrElectron, csrfMiddleware], databaseRoute.vacuumDatabase, apiResultHandler);

    asyncRoute(PST, "/api/database/find-and-fix-consistency-issues", [auth.checkApiAuthOrElectron, csrfMiddleware], databaseRoute.findAndFixConsistencyIssues, apiResultHandler);

    apiRoute(GET, "/api/database/check-integrity", databaseRoute.checkIntegrity);

    asyncRoute(PST, "/api/script/exec", [auth.checkApiAuth, csrfMiddleware], scriptRoute.exec, apiResultHandler);

    apiRoute(PST, "/api/script/run/:noteId", scriptRoute.run);
    apiRoute(GET, "/api/script/startup", scriptRoute.getStartupBundles);
    apiRoute(GET, "/api/script/widgets", scriptRoute.getWidgetBundles);
    apiRoute(PST, "/api/script/bundle/:noteId", scriptRoute.getBundle);
    apiRoute(GET, "/api/script/relation/:noteId/:relationName", scriptRoute.getRelationBundles);

    // no CSRF since this is called from android app
    route(PST, "/api/sender/login", [loginRateLimiter], loginApiRoute.token, apiResultHandler);
    asyncRoute(PST, "/api/sender/image", [auth.checkEtapiToken, uploadMiddlewareWithErrorHandling], senderRoute.uploadImage, apiResultHandler);
    asyncRoute(PST, "/api/sender/note", [auth.checkEtapiToken], senderRoute.saveNote, apiResultHandler);

    apiRoute(GET, "/api/keyboard-actions", keysRoute.getKeyboardActions);
    apiRoute(GET, "/api/keyboard-shortcuts-for-notes", keysRoute.getShortcutsForNotes);

    apiRoute(PST, "/api/relation-map", relationMapApiRoute.getRelationMap);
    apiRoute(PST, "/api/notes/erase-deleted-notes-now", notesApiRoute.eraseDeletedNotesNow);
    apiRoute(PST, "/api/notes/erase-unused-attachments-now", notesApiRoute.eraseUnusedAttachmentsNow);
    asyncApiRoute(GET, "/api/similar-notes/:noteId", similarNotesRoute.getSimilarNotes);
    asyncApiRoute(GET, "/api/backend-log", backendLogRoute.getBackendLog);
    apiRoute(GET, "/api/stats/note-size/:noteId", statsRoute.getNoteSize);
    apiRoute(GET, "/api/stats/subtree-size/:noteId", statsRoute.getSubtreeSize);
    apiRoute(PST, "/api/delete-notes-preview", notesApiRoute.getDeleteNotesPreview);
    route(GET, "/api/fonts", [auth.checkApiAuthOrElectron], fontsRoute.getFontCss);
    apiRoute(GET, "/api/other/icon-usage", otherRoute.getIconUsage);
    apiRoute(PST, "/api/other/render-markdown", otherRoute.renderMarkdown);
    apiRoute(PST, "/api/other/to-markdown", otherRoute.toMarkdown);
    apiRoute(GET, "/api/recent-changes/:ancestorNoteId", recentChangesApiRoute.getRecentChanges);
    apiRoute(GET, "/api/edited-notes/:date", revisionsApiRoute.getEditedNotesOnDate);

    apiRoute(PST, "/api/note-map/:noteId/tree", noteMapRoute.getTreeMap);
    apiRoute(PST, "/api/note-map/:noteId/link", noteMapRoute.getLinkMap);
    apiRoute(GET, "/api/note-map/:noteId/backlink-count", noteMapRoute.getBacklinkCount);
    apiRoute(GET, "/api/note-map/:noteId/backlinks", noteMapRoute.getBacklinks);

    shareRoutes.register(router);

    etapiAuthRoutes.register(router, [loginRateLimiter]);
    etapiAppInfoRoutes.register(router);
    etapiAttachmentRoutes.register(router);
    etapiAttributeRoutes.register(router);
    etapiBranchRoutes.register(router);
    etapiNoteRoutes.register(router);
    etapiSpecialNoteRoutes.register(router);
    etapiSpecRoute.register(router);
    etapiBackupRoute.register(router);
    etapiMetricsRoute.register(router);

    // LLM Chat API
    asyncApiRoute(PST, "/api/llm/chat", llmRoute.createSession);
    asyncApiRoute(GET, "/api/llm/chat", llmRoute.listSessions);
    asyncApiRoute(GET, "/api/llm/chat/:sessionId", llmRoute.getSession);
    asyncApiRoute(PATCH, "/api/llm/chat/:sessionId", llmRoute.updateSession);
    asyncApiRoute(DEL, "/api/llm/chat/:chatNoteId", llmRoute.deleteSession);
    asyncApiRoute(PST, "/api/llm/chat/:chatNoteId/messages", llmRoute.sendMessage);
    asyncApiRoute(PST, "/api/llm/chat/:chatNoteId/messages/stream", llmRoute.streamMessage);

    // LLM provider endpoints - moved under /api/llm/providers hierarchy
    asyncApiRoute(GET, "/api/llm/providers/ollama/models", ollamaRoute.listModels);
    asyncApiRoute(GET, "/api/llm/providers/openai/models", openaiRoute.listModels);
    asyncApiRoute(GET, "/api/llm/providers/anthropic/models", anthropicRoute.listModels);

    app.use("", router);
}

export default {
    register
};
