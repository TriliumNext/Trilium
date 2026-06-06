import { password_encryption as passwordEncryptionService } from "@triliumnext/core";
import type { RequestHandler, Router } from "express";

import { becca } from "@triliumnext/core";
import etapiTokenService from "../services/etapi_tokens.js";
import eu from "./etapi_utils.js";

function register(router: Router, loginMiddleware: RequestHandler[]) {
    // Password verification is async (scrypt), so it runs as middleware: the synchronous
    // transactional route handler below cannot await, and the check must complete before the
    // token is issued.
    const verifyPasswordMiddleware: RequestHandler = async (req, res, next) => {
        try {
            const { password } = req.body;

            if (!(await passwordEncryptionService.verifyPassword(password))) {
                eu.sendError(res, 401, "WRONG_PASSWORD", "Wrong password.");
                return;
            }

            next();
        } catch (e: any) {
            eu.sendError(res, 500, eu.GENERIC_CODE, e.message);
        }
    };

    eu.NOT_AUTHENTICATED_ROUTE(router, "post", "/etapi/auth/login", [...loginMiddleware, verifyPasswordMiddleware], (req, res) => {
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
