/**
 * @module
 *
 * While the second factor is `legacy`, every older copy of the database holds it next to its key,
 * so downloading a backup or an anonymized database asks for the password and a current code.
 * A `POST` that passes `checkCredentials()` returns a token for the one file it names, valid for
 * that session and for a minute, and the download link carries it.
 */
import { ValidationError } from "@triliumnext/core";
import type { NextFunction, Request, RequestHandler, Response } from "express";
import { t } from "i18next";

import { isInternalElectronRequest } from "../../services/electron_request.js";
import { getSecondFactorState } from "../../services/second_factor.js";
import sqlInit from "../../services/sql_init.js";
import { randomSecureToken } from "../../services/utils.js";

export type DownloadKind = "backup" | "anonymized";

const TOKEN_LIFETIME_MS = 60 * 1000;

const issued = new Map<string, {
    kind: DownloadKind;
    filePath: string;
    sessionId: string;
    expires: number;
}>();

/** Answers a token for the download of the file that the body names. */
function issueDownloadToken(req: Request) {
    const { kind, filePath } = req.body ?? {};
    if ((kind !== "backup" && kind !== "anonymized") || typeof filePath !== "string" || !filePath) {
        throw new ValidationError("A download token names the kind and the path of a file.");
    }

    const now = Date.now();
    for (const [ token, grant ] of issued) {
        if (grant.expires <= now) {
            issued.delete(token);
        }
    }

    const token = randomSecureToken(32);
    issued.set(token, {
        kind,
        filePath,
        sessionId: req.sessionID,
        expires: now + TOKEN_LIFETIME_MS
    });
    return { token };
}

/**
 * Lets a download through while the factor is not `legacy`, and otherwise only with a token issued
 * to the session for that file. The desktop window and the setup wizard, whose token guards every
 * route, are always let through.
 */
export function checkDownloadToken(kind: DownloadKind): RequestHandler {
    return (req: Request, res: Response, next: NextFunction) => {
        if (getSecondFactorState() !== "legacy" || !sqlInit.isDbInitialized()
            || isInternalElectronRequest(req)) {
            return next();
        }

        const token = req.query.downloadToken;
        const grant = typeof token === "string" ? issued.get(token) : undefined;
        if (typeof token === "string") {
            issued.delete(token);
        }

        const isGranted = !!grant && grant.expires > Date.now() && grant.kind === kind
            && grant.filePath === req.query.filePath && grant.sessionId === req.sessionID;
        if (!isGranted) {
            res.setHeader("Content-Type", "text/plain").status(401)
                .send(t("second_factor.download-refused"));
            return;
        }

        next();
    };
}

export default {
    issueDownloadToken
};
