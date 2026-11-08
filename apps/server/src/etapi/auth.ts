import { becca, cls } from "@triliumnext/core";
import type { RequestHandler, Router } from "express";

import { verifyLoginCredentials } from "../services/auth.js";
import etapiTokenService from "../services/etapi_tokens.js";
import totp from "../services/totp.js";
import eu from "./etapi_utils.js";

function register(router: Router, loginMiddleware: RequestHandler[]) {
    // Password verification is async (scrypt), so it runs as middleware: the synchronous
    // transactional route handler below cannot await, and the check must complete before the
    // token is issued.
    const verifyCredentialsMiddleware: RequestHandler = async (req, res, next) => {
        try {
            const { password, totpToken } = req.body;

            // Checked before the password so that the answer says nothing about the password.
            if (totp.isTotpEnabled() && (typeof totpToken !== "string" || !totpToken)) {
                eu.sendError(res, 401, "TOTP_REQUIRED", "TOTP token is required.");
                return;
            }

            // `verifyTOTP()` and `verifyRecoveryCode()` write options when they accept a code, and
            // middleware runs before `processRequest()` opens a CLS context.
            const failedFactor = await cls.init(() => verifyLoginCredentials(password, totpToken));
            if (failedFactor === "password") {
                eu.sendError(res, 401, "WRONG_PASSWORD", "Wrong password.");
                return;
            }
            if (failedFactor === "totp") {
                eu.sendError(res, 401, "WRONG_TOTP", "Wrong TOTP token.");
                return;
            }

            next();
        } catch (e: any) {
            eu.sendError(res, 500, eu.GENERIC_CODE, e.message);
        }
    };

    eu.NOT_AUTHENTICATED_ROUTE(router, "post", "/etapi/auth/login", [...loginMiddleware, verifyCredentialsMiddleware], (req, res) => {
        const { tokenName } = req.body;

        const { authToken } = etapiTokenService.createToken(tokenName || "ETAPI login");

        res.status(201).json({
            authToken
        });
    });

    eu.route(router, "post", "/etapi/auth/logout", (req, res, next) => {
        const parsed = etapiTokenService.parseAuthToken(req.headers.authorization);

        if (!parsed || !parsed.etapiTokenId) {
            throw new eu.EtapiError(400, eu.GENERIC_CODE, "Cannot logout this token.");
        }

        const etapiToken = becca.getEtapiToken(parsed.etapiTokenId);

        /* v8 ignore next 4 -- unreachable: the token id was already validated by
           checkEtapiAuth before this handler runs, so it always exists here. */
        if (!etapiToken) {
            throw new Error(`Cannot find the token '${parsed.etapiTokenId}'.`);
        }

        etapiToken.markAsDeletedSimple();

        res.sendStatus(204);
    });
}

export default {
    register
};
