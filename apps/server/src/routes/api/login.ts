"use strict";

import options from "../../services/options.js";
import utils from "../../services/utils.js";
import dateUtils from "../../services/date_utils.js";
import instanceId from "../../services/instance_id.js";
import passwordEncryptionService from "../../services/encryption/password_encryption.js";
import protectedSessionService from "../../services/protected_session.js";
import appInfo from "../../services/app_info.js";
import eventService from "../../services/events.js";
import sqlInit from "../../services/sql_init.js";
import sql from "../../services/sql.js";
import ws from "../../services/ws.js";
import etapiTokenService from "../../services/etapi_tokens.js";
import type { Request } from "express";
import totp from "../../services/totp";
import recoveryCodeService from "../../services/encryption/recovery_codes";

/**
 * @swagger
 * /api/login/sync:
 *   post:
 *     tags:
 *       - auth
 *     summary: Log in using documentSecret
 *     description: The `hash` parameter is computed using a HMAC of the `documentSecret` and `timestamp`.
 *     operationId: login-sync
 *     externalDocs:
 *       description: HMAC calculation
 *       url: https://github.com/TriliumNext/Trilium/blob/v0.91.6/src/services/utils.ts#L62-L66
 *     requestBody:
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             properties:
 *               timestamp:
 *                 $ref: '#/components/schemas/UtcDateTime'
 *               hash:
 *                 type: string
 *               syncVersion:
 *                 type: integer
 *                 example: 34
 *     responses:
 *       '200':
 *         description: Successful operation
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 syncVersion:
 *                   type: integer
 *                   example: 34
 *                 options:
 *                   type: object
 *                   properties:
 *                     documentSecret:
 *                       type: string
 *       '400':
 *         description: Sync version / document secret mismatch
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 message:
 *                   type: string
 *                   example: "Non-matching sync versions, local is version ${server syncVersion}, remote is ${requested syncVersion}. It is recommended to run same version of Trilium on both sides of sync"
 *       '401':
 *         description: Timestamp mismatch
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 message:
 *                   type: string
 *                   example: "Auth request time is out of sync, please check that both client and server have correct time. The difference between clocks has to be smaller than 5 minutes"
 */
function loginSync(req: Request) {
    if (!sqlInit.schemaExists()) {
        return [500, { message: "DB schema does not exist, can't sync." }];
    }

    const timestampStr = req.body.timestamp;

    const timestamp = dateUtils.parseDateTime(timestampStr);

    const now = new Date();

    // login token is valid for 5 minutes
    if (Math.abs(timestamp.getTime() - now.getTime()) > 5 * 60 * 1000) {
        return [401, { message: "Auth request time is out of sync, please check that both client and server have correct time. The difference between clocks has to be smaller than 5 minutes." }];
    }

    const syncVersion = req.body.syncVersion;

    if (syncVersion !== appInfo.syncVersion) {
        return [
            400,
            { message: `Non-matching sync versions, local is version ${appInfo.syncVersion}, remote is ${syncVersion}. It is recommended to run same version of Trilium on both sides of sync.` }
        ];
    }

    const documentSecret = options.getOption("documentSecret");
    const expectedHash = utils.hmac(documentSecret, timestampStr);

    const givenHash = req.body.hash;

    if (!utils.constantTimeCompare(expectedHash, givenHash)) {
        return [400, { message: "Sync login credentials are incorrect. It looks like you're trying to sync two different initialized documents which is not possible." }];
    }

    req.session.loggedIn = true;

    return {
        instanceId: instanceId,
        maxEntityChangeId: sql.getValue("SELECT COALESCE(MAX(id), 0) FROM entity_changes WHERE isSynced = 1")
    };
}

function loginToProtectedSession(req: Request) {
    const password = req.body.password;

    if (!passwordEncryptionService.verifyPassword(password)) {
        return {
            success: false,
            message: "Given current password doesn't match hash"
        };
    }

    const decryptedDataKey = passwordEncryptionService.getDataKey(password);
    if (!decryptedDataKey) {
        return {
            success: false,
            message: "Unable to obtain data key."
        };
    }

    protectedSessionService.setDataKey(decryptedDataKey);

    eventService.emit(eventService.ENTER_PROTECTED_SESSION);

    ws.sendMessageToAllClients({ type: "protectedSessionLogin" });

    return {
        success: true
    };
}

function logoutFromProtectedSession() {
    protectedSessionService.resetDataKey();

    eventService.emit(eventService.LEAVE_PROTECTED_SESSION);

    ws.sendMessageToAllClients({ type: "protectedSessionLogout" });
}

function touchProtectedSession() {
    protectedSessionService.touchProtectedSession();
}

function token(req: Request) {
    const password = req.body.password;
    const submittedTotpToken = req.body.totpToken;

    if (totp.isTotpEnabled()) {
        if (!verifyTOTP(submittedTotpToken)) {
            return [401, "Incorrect credential"];
        }
    }

    if (!passwordEncryptionService.verifyPassword(password)) {
        return [401, "Incorrect credential"];
    }

    // for backwards compatibility with Sender which does not send the name
    const tokenName = req.body.tokenName || "Trilium Sender / Web Clipper";

    const { authToken } = etapiTokenService.createToken(tokenName);

    return { token: authToken };
}

function verifyTOTP(submittedTotpToken: string) {
    if (totp.validateTOTP(submittedTotpToken)) return true;

    const recoveryCodeValidates = recoveryCodeService.verifyRecoveryCode(submittedTotpToken);

    return recoveryCodeValidates;
}

export default {
    loginSync,
    loginToProtectedSession,
    logoutFromProtectedSession,
    touchProtectedSession,
    token
};
