import type { NextFunction, Request, RequestHandler, Response, Router } from "express";
import type { ParamsDictionary } from "express-serve-static-core";

import { becca } from "@triliumnext/core";
import { bindEmitter } from "../cls_provider.js";
import type { ApiRequestHandler, SyncRouteRequestHandler } from "../routes/route_api.js";
import { cls } from "@triliumnext/core";
import config from "../services/config.js";
import etapiTokenService from "../services/etapi_tokens.js";
import { getLog } from "@triliumnext/core";
import sql from "../services/sql.js";
import type { ValidatorMap } from "./etapi-interface.js";
const GENERIC_CODE = "GENERIC";

type HttpMethod = "all" | "get" | "post" | "put" | "delete" | "patch" | "options" | "head";

const noAuthentication = config.General && config.General.noAuthentication === true;

class EtapiError extends Error {
    statusCode: number;
    code: string;

    constructor(statusCode: number, code: string, message: string) {
        super(message);

        // Set the prototype explicitly.
        Object.setPrototypeOf(this, EtapiError.prototype);

        this.statusCode = statusCode;
        this.code = code;
    }
}

function sendError(res: Response, statusCode: number, code: string, message: string) {
    return res
        .set("Content-Type", "application/json")
        .status(statusCode)
        .send(
            JSON.stringify({
                status: statusCode,
                code,
                message
            })
        );
}

function checkEtapiAuth(req: Request, res: Response, next: NextFunction) {
    if (noAuthentication || etapiTokenService.isValidAuthHeader(req.headers.authorization)) {
        next();
    } else {
        sendError(res, 401, "NOT_AUTHENTICATED", "Not authenticated");
    }
}

function processRequest<P extends ParamsDictionary>(req: Request<P>, res: Response, routeHandler: ApiRequestHandler<P>, next: NextFunction, method: string, path: string) {
    try {
        bindEmitter(req);
        bindEmitter(res);

        cls.init(() => {
            cls.set("componentId", "etapi");
            cls.set("localNowDateTime", req.headers["trilium-local-now-datetime"]);

            const cb = () => routeHandler(req, res, next);

            return sql.transactional(cb);
        });
    } catch (e: unknown) {
        handleRequestError(e, res, method, path);
    }
}

/** Logs a handler's error and answers with its ETAPI error code, or the generic one. */
function handleRequestError(e: unknown, res: Response, method: string, path: string) {
    const error = e instanceof Error ? e : new Error(String(e));
    getLog().error(`${method} ${path} threw exception ${error.message} with stacktrace: ${error.stack}`);

    if (error instanceof EtapiError) {
        sendError(res, error.statusCode, error.code, error.message);
    } else {
        sendError(res, 500, GENERIC_CODE, error.message);
    }
}

function route<P extends ParamsDictionary>(router: Router, method: HttpMethod, path: string, routeHandler: SyncRouteRequestHandler<P>) {
    router[method](path, checkEtapiAuth, (req: Request<P>, res: Response, next: NextFunction) => processRequest(req, res, routeHandler, next, method, path));
}

function NOT_AUTHENTICATED_ROUTE<P extends ParamsDictionary>(router: Router, method: HttpMethod, path: string, middleware: RequestHandler[], routeHandler: SyncRouteRequestHandler<P>) {
    router[method](path, ...middleware, (req: Request<P>, res: Response, next: NextFunction) => processRequest(req, res, routeHandler, next, method, path));
}

function getAndCheckNote(noteId: string) {
    const note = becca.getNote(noteId);

    if (note) {
        return note;
    }
    throw new EtapiError(404, "NOTE_NOT_FOUND", `Note '${noteId}' not found.`);

}

function getAndCheckAttachment(attachmentId: string) {
    const attachment = becca.getAttachment(attachmentId);

    if (attachment) {
        return attachment;
    }
    throw new EtapiError(404, "ATTACHMENT_NOT_FOUND", `Attachment '${attachmentId}' not found.`);

}

function getAndCheckBranch(branchId: string) {
    const branch = becca.getBranch(branchId);

    if (branch) {
        return branch;
    }
    throw new EtapiError(404, "BRANCH_NOT_FOUND", `Branch '${branchId}' not found.`);

}

function getAndCheckAttribute(attributeId: string) {
    const attribute = becca.getAttribute(attributeId);

    if (attribute) {
        return attribute;
    }
    throw new EtapiError(404, "ATTRIBUTE_NOT_FOUND", `Attribute '${attributeId}' not found.`);

}

function getAndCheckRevision(revisionId: string) {
    const revision = becca.getRevision(revisionId);

    if (revision) {
        return revision;
    }
    throw new EtapiError(404, "REVISION_NOT_FOUND", `Revision '${revisionId}' not found.`);
}

function validateAndPatch(target: any, source: any, allowedProperties: ValidatorMap) {
    for (const key of Object.keys(source)) {
        if (!(key in allowedProperties)) {
            throw new EtapiError(400, "PROPERTY_NOT_ALLOWED", `Property '${key}' is not allowed for this method.`);
        } else {
            for (const validator of allowedProperties[key]) {
                const validationResult = validator(source[key]);

                if (validationResult) {
                    throw new EtapiError(400, "PROPERTY_VALIDATION_ERROR", `Validation failed on property '${key}': ${validationResult}.`);
                }
            }
        }
    }

    // validation passed, let's patch
    for (const propName of Object.keys(source)) {
        target[propName] = source[propName];
    }
}

export default {
    EtapiError,
    sendError,
    handleRequestError,
    route,
    NOT_AUTHENTICATED_ROUTE,
    GENERIC_CODE,
    validateAndPatch,
    getAndCheckNote,
    getAndCheckBranch,
    getAndCheckAttribute,
    getAndCheckAttachment,
    getAndCheckRevision
};
