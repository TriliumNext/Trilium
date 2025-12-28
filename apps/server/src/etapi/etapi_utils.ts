import cls from "../services/cls.js";
import sql from "../services/sql.js";
import log from "../services/log.js";
import becca from "../becca/becca.js";
import etapiTokenService from "../services/etapi_tokens.js";
import config from "../services/config.js";
import type { NextFunction, Request, RequestHandler, Response, Router } from "express";
import type { ValidatorMap } from "./etapi-interface.js";
import type { ApiRequestHandler, SyncRouteRequestHandler } from "../routes/route_api.js";
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
                code: code,
                message: message
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

function processRequest(req: Request, res: Response, routeHandler: ApiRequestHandler, next: NextFunction, method: string, path: string) {
    try {
        cls.namespace.bindEmitter(req);
        cls.namespace.bindEmitter(res);

        cls.init(() => {
            cls.set("componentId", "etapi");
            cls.set("localNowDateTime", req.headers["trilium-local-now-datetime"]);

            const cb = () => routeHandler(req, res, next);

            return sql.transactional(cb);
        });
    } catch (e: any) {
        log.error(`${method} ${path} threw exception ${e.message} with stacktrace: ${e.stack}`);

        if (e instanceof EtapiError) {
            sendError(res, e.statusCode, e.code, e.message);
        } else {
            sendError(res, 500, GENERIC_CODE, e.message);
        }
    }
}

function route(router: Router, method: HttpMethod, path: string, routeHandler: SyncRouteRequestHandler) {
    router[method](path, checkEtapiAuth, (req: Request, res: Response, next: NextFunction) => processRequest(req, res, routeHandler, next, method, path));
}

function NOT_AUTHENTICATED_ROUTE(router: Router, method: HttpMethod, path: string, middleware: RequestHandler[], routeHandler: SyncRouteRequestHandler) {
    router[method](path, ...middleware, (req: Request, res: Response, next: NextFunction) => processRequest(req, res, routeHandler, next, method, path));
}

function getAndCheckNote(noteId: string) {
    const note = becca.getNote(noteId);

    if (note) {
        return note;
    } else {
        throw new EtapiError(404, "NOTE_NOT_FOUND", `Note '${noteId}' not found.`);
    }
}

function getAndCheckAttachment(attachmentId: string) {
    const attachment = becca.getAttachment(attachmentId);

    if (attachment) {
        return attachment;
    } else {
        throw new EtapiError(404, "ATTACHMENT_NOT_FOUND", `Attachment '${attachmentId}' not found.`);
    }
}

function getAndCheckBranch(branchId: string) {
    const branch = becca.getBranch(branchId);

    if (branch) {
        return branch;
    } else {
        throw new EtapiError(404, "BRANCH_NOT_FOUND", `Branch '${branchId}' not found.`);
    }
}

function getAndCheckAttribute(attributeId: string) {
    const attribute = becca.getAttribute(attributeId);

    if (attribute) {
        return attribute;
    } else {
        throw new EtapiError(404, "ATTRIBUTE_NOT_FOUND", `Attribute '${attributeId}' not found.`);
    }
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
    route,
    NOT_AUTHENTICATED_ROUTE,
    GENERIC_CODE,
    validateAndPatch,
    getAndCheckNote,
    getAndCheckBranch,
    getAndCheckAttribute,
    getAndCheckAttachment
};
