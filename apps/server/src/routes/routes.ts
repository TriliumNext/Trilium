import { routes } from "@triliumnext/core";
import { createPartialContentHandler } from "@triliumnext/express-partial-content";
import express from "express";
import rateLimit from "express-rate-limit";

import etapiAppInfoRoutes from "../etapi/app_info.js";
import etapiAttachmentRoutes from "../etapi/attachments.js";
import etapiAttributeRoutes from "../etapi/attributes.js";
import etapiAuthRoutes from "../etapi/auth.js";
import etapiBackupRoute from "../etapi/backup.js";
import etapiBranchRoutes from "../etapi/branches.js";
import etapiMetricsRoute from "../etapi/metrics.js";
import etapiNoteRoutes from "../etapi/notes.js";
import etapiRevisionsRoutes from "../etapi/revisions.js";
import etapiSpecRoute from "../etapi/spec.js";
import etapiSpecialNoteRoutes from "../etapi/special_notes.js";
import auth from "../services/auth.js";
import openID from '../services/open_id.js';
import { isElectron } from "../services/utils.js";
import shareRoutes from "../share/routes.js";
import clipperRoute from "./api/clipper.js";
import databaseRoute from "./api/database.js";
import etapiTokensApiRoutes from "./api/etapi_tokens.js";
import filesRoute from "./api/files.js";
import fontsRoute from "./api/fonts.js";
import llmChatRoute from "./api/llm_chat.js";
import llmSpecialNotesRoute from "./api/llm_special_notes.js";
import loginApiRoute from "./api/login.js";
import metricsRoute from "./api/metrics.js";
import ocrRoute from "./api/ocr.js";
import recoveryCodes from './api/recovery_codes.js';
import senderRoute from "./api/sender.js";
import systemInfoRoute from "./api/system_info.js";
import totp from './api/totp.js';
// API routes
import { doubleCsrfProtection as csrfMiddleware } from "./csrf_protection.js";
import * as indexRoute from "./index.js";
import loginRoute from "./login.js";
import { apiResultHandler, apiRoute, asyncApiRoute, asyncRoute, route, router, uploadMiddlewareWithErrorHandling } from "./route_api.js";
// page routes
import setupRoute from "./setup.js";

const GET = "get",
    PST = "post",
    PUT = "put",
    PATCH = "patch",
    DEL = "delete";

function register(app: express.Application) {
    route(GET, "/login", [auth.checkAppInitialized, auth.checkPasswordSet], loginRoute.loginPage);
    route(GET, "/set-password", [auth.checkAppInitialized, auth.checkPasswordNotSet], loginRoute.setPasswordPage);

    const loginRateLimiter = rateLimit({
        windowMs: 15 * 60 * 1000, // 15 minutes
        max: 10, // limit each IP to 10 requests per windowMs
        skipSuccessfulRequests: true // successful auth to rate-limited ETAPI routes isn't counted. However, successful auth to /login is still counted!
    });

    route(GET, "/bootstrap", [ auth.checkAuth ], indexRoute.bootstrap);
    asyncRoute(PST, "/login", [loginRateLimiter], loginRoute.login, null);
    route(PST, "/logout", [csrfMiddleware, auth.checkAuth], loginRoute.logout);
    asyncRoute(PST, "/set-password", [auth.checkAppInitialized, auth.checkPasswordNotSet], loginRoute.setPassword, null);
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

    routes.buildSharedApiRoutes({
        route,
        asyncRoute,
        apiRoute,
        asyncApiRoute,
        apiResultHandler,
        checkApiAuth: auth.checkApiAuth,
        checkApiAuthOrElectron: auth.checkApiAuthOrElectron,
        checkAppNotInitialized: auth.checkAppNotInitialized,
        checkCredentials: auth.checkCredentials,
        loginRateLimiter,
        uploadMiddlewareWithErrorHandling,
        csrfMiddleware
    });

    route(PUT, "/api/notes/:noteId/file", [auth.checkApiAuthOrElectron, uploadMiddlewareWithErrorHandling, csrfMiddleware], filesRoute.updateFile, apiResultHandler);
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
    apiRoute(PST, "/api/notes/:noteId/save-to-tmp-dir", filesRoute.saveNoteToTmpDir);
    apiRoute(PST, "/api/notes/:noteId/upload-modified-file", filesRoute.uploadModifiedFileToNote);

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

    apiRoute(PST, "/api/attachments/:attachmentId/save-to-tmp-dir", filesRoute.saveAttachmentToTmpDir);
    apiRoute(PST, "/api/attachments/:attachmentId/upload-modified-file", filesRoute.uploadModifiedFileToAttachment);
    route(PUT, "/api/attachments/:attachmentId/file", [auth.checkApiAuthOrElectron, uploadMiddlewareWithErrorHandling, csrfMiddleware], filesRoute.updateAttachment, apiResultHandler);

    // TODO: Re-enable once we support route()
    // route(GET, "/api/revisions/:revisionId/download", [auth.checkApiAuthOrElectron], revisionsApiRoute.downloadRevision);

    apiRoute(GET, "/api/metrics", metricsRoute.getMetrics);
    apiRoute(GET, "/api/system-checks", systemInfoRoute.systemChecks);

    // docker health check
    route(GET, "/api/health-check", [], () => ({ status: "ok" }), apiResultHandler);

    route(PST, "/api/login/sync", [loginRateLimiter], loginApiRoute.loginSync, apiResultHandler);
    asyncRoute(PST, "/api/login/token", [loginRateLimiter], loginApiRoute.token, apiResultHandler);

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

    apiRoute(PST, "/api/special-notes/llm-chat", llmSpecialNotesRoute.createLlmChat);
    apiRoute(GET, "/api/special-notes/most-recent-llm-chat", llmSpecialNotesRoute.getMostRecentLlmChat);
    apiRoute(GET, "/api/special-notes/get-or-create-llm-chat", llmSpecialNotesRoute.getOrCreateLlmChat);
    apiRoute(GET, "/api/special-notes/recent-llm-chats", llmSpecialNotesRoute.getRecentLlmChats);
    apiRoute(PST, "/api/special-notes/save-llm-chat", llmSpecialNotesRoute.saveLlmChat);
    asyncRoute(PST, "/api/database/anonymize/:type", [auth.checkApiAuthOrElectron, csrfMiddleware], databaseRoute.anonymize, apiResultHandler);
    apiRoute(GET, "/api/database/anonymized-databases", databaseRoute.getExistingAnonymizedDatabases);

    if (process.env.TRILIUM_INTEGRATION_TEST === "memory") {
        asyncRoute(PST, "/api/database/rebuild/", [auth.checkApiAuthOrElectron], databaseRoute.rebuildIntegrationTestDatabase, apiResultHandler);
    }

    // backup routes (backups, backup-database, backup/download) are in core
    // VACUUM requires execution outside of transaction
    asyncRoute(PST, "/api/database/vacuum-database", [auth.checkApiAuthOrElectron, csrfMiddleware], databaseRoute.vacuumDatabase, apiResultHandler);

    asyncRoute(PST, "/api/database/find-and-fix-consistency-issues", [auth.checkApiAuthOrElectron, csrfMiddleware], databaseRoute.findAndFixConsistencyIssues, apiResultHandler);

    apiRoute(GET, "/api/database/check-integrity", databaseRoute.checkIntegrity);

    // LLM chat endpoints
    asyncRoute(PST, "/api/llm-chat/stream", [auth.checkApiAuthOrElectron, csrfMiddleware], llmChatRoute.streamChat, null);
    apiRoute(GET, "/api/llm-chat/models", llmChatRoute.getModels);

    // no CSRF since this is called from android app
    asyncRoute(PST, "/api/sender/login", [loginRateLimiter], loginApiRoute.token, apiResultHandler);
    asyncRoute(PST, "/api/sender/image", [auth.checkEtapiToken, uploadMiddlewareWithErrorHandling], senderRoute.uploadImage, apiResultHandler);
    asyncRoute(PST, "/api/sender/note", [auth.checkEtapiToken], senderRoute.saveNote, apiResultHandler);

    route(GET, "/api/fonts", [auth.checkApiAuthOrElectron], fontsRoute.getFontCss);

    shareRoutes.register(router);

    etapiAuthRoutes.register(router, [loginRateLimiter]);
    etapiAppInfoRoutes.register(router);
    etapiAttachmentRoutes.register(router);
    etapiAttributeRoutes.register(router);
    etapiBranchRoutes.register(router);
    // Register revisions routes BEFORE notes routes so /etapi/notes/history is matched before /etapi/notes/:noteId
    etapiRevisionsRoutes.register(router);
    etapiNoteRoutes.register(router);
    etapiSpecialNoteRoutes.register(router);
    etapiSpecRoute.register(router);
    etapiBackupRoute.register(router);
    etapiMetricsRoute.register(router);

    // OCR API
    asyncApiRoute(PST, "/api/ocr/process-note/:noteId", ocrRoute.processNoteOCR);
    asyncApiRoute(PST, "/api/ocr/process-attachment/:attachmentId", ocrRoute.processAttachmentOCR);
    asyncApiRoute(PST, "/api/ocr/batch-process", ocrRoute.batchProcessOCR);
    asyncApiRoute(GET, "/api/ocr/batch-progress", ocrRoute.getBatchProgress);
    asyncApiRoute(GET, "/api/ocr/notes/:noteId/text", ocrRoute.getNoteOCRText);
    asyncApiRoute(GET, "/api/ocr/attachments/:attachmentId/text", ocrRoute.getAttachmentOCRText);

    app.use("", router);
}

export default {
    register
};
