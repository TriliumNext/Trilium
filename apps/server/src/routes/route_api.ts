import express, { type RequestHandler } from "express";
import { mkdirSync } from "fs";
import multer from "multer";
import { join } from "path";

import AbstractBeccaEntity from "../becca/entities/abstract_becca_entity.js";
import NotFoundError from "../errors/not_found_error.js";
import ValidationError from "../errors/validation_error.js";
import auth from "../services/auth.js";
import cls from "../services/cls.js";
import dataDirs from "../services/data_dir.js";
import entityChangesService from "../services/entity_changes.js";
import log from "../services/log.js";
import sql from "../services/sql.js";
import { randomString, safeExtractMessageAndStackFromError } from "../services/utils.js";
import { doubleCsrfProtection as csrfMiddleware } from "./csrf_protection.js";

const MAX_ALLOWED_FILE_SIZE_MB = 250;
export const router = express.Router();

// TODO: Deduplicate with etapi_utils.ts afterwards.
type HttpMethod = "all" | "get" | "post" | "put" | "delete" | "patch" | "options" | "head";

export type ApiResultHandler = (req: express.Request, res: express.Response, result: unknown) => number;

type NotAPromise<T> = T & { then?: void };
export type ApiRequestHandler = (req: express.Request, res: express.Response, next: express.NextFunction) => unknown;
export type SyncRouteRequestHandler = (req: express.Request, res: express.Response, next: express.NextFunction) => NotAPromise<object> | number | string | void | null;

/** Handling common patterns. If entity is not caught, serialization to JSON will fail */
function convertEntitiesToPojo(result: unknown) {
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

export function apiResultHandler(req: express.Request, res: express.Response, result: unknown) {
    res.setHeader("trilium-max-entity-change-id", entityChangesService.getMaxEntityChangeId());

    result = convertEntitiesToPojo(result);

    // if it's an array and the first element is integer, then we consider this to be [statusCode, response] format
    if (Array.isArray(result) && result.length > 0 && Number.isInteger(result[0])) {
        const [statusCode, response] = result;

        if (statusCode !== 200 && statusCode !== 201 && statusCode !== 204) {
            log.info(`${req.method} ${req.originalUrl} returned ${statusCode} with response ${JSON.stringify(response)}`);
        }

        return send(res, statusCode, response);
    } else if (result === undefined) {
        return send(res, 204, "");
    }
    return send(res, 200, result);

}

function send(res: express.Response, statusCode: number, response: unknown) {
    if (typeof response === "string") {
        if (statusCode >= 400) {
            res.setHeader("Content-Type", "text/plain");
        }

        res.status(statusCode).send(response);

        return response.length;
    }
    const json = JSON.stringify(response);

    res.setHeader("Content-Type", "application/json");
    res.status(statusCode).send(json);

    return json.length;

}

export function apiRoute(method: HttpMethod, path: string, routeHandler: SyncRouteRequestHandler) {
    route(method, path, [auth.checkApiAuth, csrfMiddleware], routeHandler, apiResultHandler);
}

export function asyncApiRoute(method: HttpMethod, path: string, routeHandler: ApiRequestHandler) {
    asyncRoute(method, path, [auth.checkApiAuth, csrfMiddleware], routeHandler, apiResultHandler);
}

export function route(method: HttpMethod, path: string, middleware: express.Handler[], routeHandler: SyncRouteRequestHandler, resultHandler: ApiResultHandler | null = null) {
    internalRoute(method, path, middleware, routeHandler, resultHandler, true);
}

export function asyncRoute(method: HttpMethod, path: string, middleware: express.Handler[], routeHandler: ApiRequestHandler, resultHandler: ApiResultHandler | null = null) {
    internalRoute(method, path, middleware, routeHandler, resultHandler, false);
}

function internalRoute(method: HttpMethod, path: string, middleware: express.Handler[], routeHandler: ApiRequestHandler, resultHandler: ApiResultHandler | null = null, transactional: boolean) {
    router[method](path, ...(middleware as express.Handler[]), (req: express.Request, res: express.Response, next: express.NextFunction) => {
        const start = Date.now();

        try {
            cls.namespace.bindEmitter(req);
            cls.namespace.bindEmitter(res);

            const result = cls.init(() => {
                cls.set("componentId", req.headers["trilium-component-id"]);
                cls.set("localNowDateTime", req.headers["trilium-local-now-datetime"]);
                cls.set("hoistedNoteId", req.headers["trilium-hoisted-note-id"] || "root");

                const cb = () => routeHandler(req, res, next);

                return transactional ? sql.transactional(cb) : cb();
            });

            if (!resultHandler) {
                return;
            }

            if (result?.then) {
                // promise
                result.then((promiseResult: unknown) => handleResponse(resultHandler, req, res, promiseResult, start)).catch((e: unknown) => handleException(e, method, path, res));
            } else {
                handleResponse(resultHandler, req, res, result, start);
            }
        } catch (e) {
            handleException(e, method, path, res);
        }
    });
}

function handleResponse(resultHandler: ApiResultHandler, req: express.Request, res: express.Response, result: unknown, start: number) {
    // Skip result handling if the response has already been handled
    if ((res as any).triliumResponseHandled) {
        // Just log the request without additional processing
        log.request(req, res, Date.now() - start, 0);
        return;
    }

    const responseLength = resultHandler(req, res, result);
    log.request(req, res, Date.now() - start, responseLength);
}

function handleException(e: unknown | Error, method: HttpMethod, path: string, res: express.Response) {
    const [errMessage, errStack] = safeExtractMessageAndStackFromError(e);

    log.error(`${method} ${path} threw exception: '${errMessage}', stack: ${errStack}`);

    // Skip sending response if it's already been handled by the route handler
    if ((res as unknown as { triliumResponseHandled?: boolean }).triliumResponseHandled || res.headersSent) {
        return;
    }

    const resStatusCode = (e instanceof ValidationError || e instanceof NotFoundError) ? e.statusCode : 500;

    res.status(resStatusCode).json({
        message: errMessage
    });

}

export function createUploadMiddleware(): RequestHandler {
    const multerOptions: multer.Options = {
        fileFilter: (req: express.Request, file, cb) => {
            // UTF-8 file names are not well decoded by multer/busboy, so we handle the conversion on our side.
            // See https://github.com/expressjs/multer/pull/1102.
            file.originalname = Buffer.from(file.originalname, "latin1").toString("utf-8");
            cb(null, true);
        }
    };

    if (!process.env.TRILIUM_NO_UPLOAD_LIMIT) {
        multerOptions.limits = {
            fileSize: MAX_ALLOWED_FILE_SIZE_MB * 1024 * 1024
        };
    }

    return multer(multerOptions).single("upload");
}

export function createImportUploadMiddleware(): RequestHandler {
    const outDir = join(dataDirs.TMP_DIR, "upload");
    mkdirSync(outDir, { recursive: true });

    const multerOptions: multer.Options = {
        storage: multer.diskStorage({
            destination(req, file, cb) {
                cb(null, outDir);
            },
            filename(req, file, cb) {
                cb(null, `upload-${randomString(13)}.trilium`);
            }
        }),
        fileFilter: (req: express.Request, file, cb) => {
            // UTF-8 file names are not well decoded by multer/busboy, so we handle the conversion on our side.
            // See https://github.com/expressjs/multer/pull/1102.
            file.originalname = Buffer.from(file.originalname, "latin1").toString("utf-8");
            cb(null, true);
        }
    };

    if (!process.env.TRILIUM_NO_UPLOAD_LIMIT) {
        multerOptions.limits = {
            fileSize: MAX_ALLOWED_FILE_SIZE_MB * 1024 * 1024
        };
    }

    return multer(multerOptions).single("upload");
}

const uploadMiddleware = createUploadMiddleware();
const importUploadMiddleware = createImportUploadMiddleware();

export const uploadMiddlewareWithErrorHandling = function (req: express.Request, res: express.Response, next: express.NextFunction) {
    uploadMiddleware(req, res, (err) => {
        if (err?.code === "LIMIT_FILE_SIZE") {
            res.setHeader("Content-Type", "text/plain").status(400).send(`Cannot upload file because it excceeded max allowed file size of ${MAX_ALLOWED_FILE_SIZE_MB} MiB`);
        } else {
            next();
        }
    });
};

export const importMiddlewareWithErrorHandling = function (req: express.Request, res: express.Response, next: express.NextFunction) {
    importUploadMiddleware(req, res, (err) => {
        if (err?.code === "LIMIT_FILE_SIZE") {
            res.setHeader("Content-Type", "text/plain").status(400).send(`Cannot upload file because it excceeded max allowed file size of ${MAX_ALLOWED_FILE_SIZE_MB} MiB`);
        } else {
            next();
        }
    });
};
