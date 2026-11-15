/**
 * Server-only login routes.
 *
 * Protected session routes (loginToProtectedSession, logoutFromProtectedSession,
 * touchProtectedSession) are now in core and registered via buildSharedApiRoutes.
 */
import { app_info as appInfo, date_utils as dateUtils, getInstanceId, options } from "@triliumnext/core";
import type { Request } from "express";

import { verifyLoginCredentials } from "../../services/auth.js";
import etapiTokenService from "../../services/etapi_tokens.js";
import sql from "../../services/sql.js";
import sqlInit from "../../services/sql_init.js";
import utils from "../../services/utils.js";

async function loginSync(req: Request) {
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

    // Regenerate session to prevent session fixation attacks.
    await new Promise<void>((resolve, reject) => {
        req.session.regenerate((err) => {
            if (err) {
                reject(err);
            } else {
                resolve();
            }
        });
    });

    req.session.loggedIn = true;

    return {
        instanceId: getInstanceId(),
        maxEntityChangeId: sql.getValue("SELECT COALESCE(MAX(id), 0) FROM entity_changes WHERE isSynced = 1")
    };
}

async function token(req: Request) {
    const password = req.body.password;
    const submittedTotpToken = req.body.totpToken;

    const failedFactor = await verifyLoginCredentials(password, submittedTotpToken);
    if (failedFactor) {
        return [401, { message: "Incorrect credential", factor: failedFactor }];
    }

    // for backwards compatibility with Sender which does not send the name
    const tokenName = req.body.tokenName || "Trilium Sender / Web Clipper";

    const { authToken } = etapiTokenService.createToken(tokenName);

    return { token: authToken };
}

export default {
    loginSync,
    token
};
