import { entity_changes as entityChangesService, NotFoundError, routes, utils as coreUtils, ValidationError } from "@triliumnext/core";
import { cls } from "@triliumnext/core";
import { getLog } from "@triliumnext/core";
import express, { type RequestHandler } from "express";
import type { ParamsDictionary } from "express-serve-static-core";
import { mkdirSync } from "fs";
import { readFile, rm } from "fs/promises";
import multer from "multer";
import { join } from "path";

import { namespace } from "../cls_provider.js";
import auth from "../services/auth.js";
import dataDirs from "../services/data_dir.js";
import sql from "../services/sql.js";
import { safeExtractMessageAndStackFromError } from "../services/utils.js";
import { doubleCsrfProtection as csrfMiddleware } from "./csrf_protection.js";

export const router = express.Router();

// TODO: Deduplicate with etapi_utils.ts afterwards.
type HttpMethod = "all" | "get" | "post" | "put" | "delete" | "patch" | "options" | "head";

export type ApiResultHandler = (req: express.Request, res: express.Response, result: unknown) => number;

type NotAPromise<T> = T & { then?: void };
export type ApiRequestHandler<P extends ParamsDictionary> = (req: express.Request<P>, res: express.Response, next: express.NextFunction) => unknown;
export type SyncRouteRequestHandler<P extends ParamsDictionary> = (req: express.Request<P>, res: express.Response, next: express.NextFunction) => NotAPromise<object> | number | string | void | null;

export function apiResultHandler(req: express.Request, res: express.Response, result: unknown) {
    res.setHeader("trilium-max-entity-change-id", entityChangesService.getMaxEntityChangeId());

    result = routes.convertEntitiesToPojo(result);

    // if it's an array and the first element is integer, then we consider this to be [statusCode, response] format
    if (Array.isArray(result) && result.length > 0 && Number.isInteger(result[0])) {
        const [statusCode, response] = result;

        if (statusCode !== 200 && statusCode !== 201 && statusCode !== 204) {
            getLog().info(`${req.method} ${req.originalUrl} returned ${statusCode} with response ${JSON.stringify(response)}`);
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

export function apiRoute<P extends ParamsDictionary>(method: HttpMethod, path: string, routeHandler: SyncRouteRequestHandler<P>) {
    route(method, path, [auth.checkApiAuth, csrfMiddleware], routeHandler, apiResultHandler);
}

export function asyncApiRoute<P extends ParamsDictionary>(method: HttpMethod, path: string, routeHandler: ApiRequestHandler<P>) {
    asyncRoute(method, path, [auth.checkApiAuth, csrfMiddleware], routeHandler, apiResultHandler);
}

export function route<P extends ParamsDictionary>(method: HttpMethod, path: string, middleware: express.Handler[], routeHandler: SyncRouteRequestHandler<P>, resultHandler: ApiResultHandler | null = null) {
    internalRoute(method, path, middleware, routeHandler, resultHandler, true);
}

export function asyncRoute<P extends ParamsDictionary>(method: HttpMethod, path: string, middleware: express.Handler[], routeHandler: ApiRequestHandler<P>, resultHandler: ApiResultHandler | null = null) {
    internalRoute(method, path, middleware, routeHandler, resultHandler, false);
}

function internalRoute<P extends ParamsDictionary>(method: HttpMethod, path: string, middleware: express.Handler[], routeHandler: ApiRequestHandler<P>, resultHandler: ApiResultHandler | null = null, transactional: boolean) {
    router[method](path, ...(middleware as express.Handler[]), (req: express.Request<P>, res: express.Response, next: express.NextFunction) => {
        const start = Date.now();

        try {
            namespace.bindEmitter(req);
            namespace.bindEmitter(res);

            const result = cls.init(() => {
                cls.set("componentId", req.headers["trilium-component-id"]);
                cls.set("localNowDateTime", req.headers["trilium-local-now-datetime"]);
                cls.set("hoistedNoteId", req.headers["trilium-hoisted-note-id"] || "root");
                cls.set("userId", req.session?.userId);

                const cb = () => routeHandler(req, res, next);

                return transactional ? sql.transactional(cb) : cb();
            });

            if (!resultHandler) {
                return;
            }

            if (result instanceof Promise) {
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
    if (res.triliumResponseHandled) {
        // Just log the request without additional processing
        getLog().request(req, res, Date.now() - start, 0);
        return;
    }

    const responseLength = resultHandler(req, res, result);
    getLog().request(req, res, Date.now() - start, responseLength);
}

function handleException(e: unknown | Error, method: HttpMethod, path: string, res: express.Response) {
    const [errMessage, errStack] = safeExtractMessageAndStackFromError(e);

    getLog().error(`${method} ${path} threw exception: '${errMessage}', stack: ${errStack}`);

    // Skip sending response if it's already been handled by the route handler
    if (res.triliumResponseHandled || res.headersSent) {
        return;
    }

    const resStatusCode = (e instanceof ValidationError || e instanceof NotFoundError) ? e.statusCode : 500;

    res.status(resStatusCode).json({
        message: errMessage
    });

}

/**
 * Common multer options for every upload route.
 *
 * `fieldNestingDepth: 0` rejects any bracketed multipart field name — none of our routes consume nested
 * text fields — which activates multer 2.2.0's guard against CVE-2026-5079 (DoS via deeply-nested field
 * names). It is not yet in @types/multer 2.1.0, hence the local intersection type.
 *
 * There is deliberately no `fileSize` limit: the old 250 MiB cap conflated archive size (a ZIP's many
 * entries are each their own blob) with single-blob size, and only bounded the *compressed* upload. The
 * real constraint — a single blob must stay serialisable for sync — is now enforced per blob at creation
 * time (see AbstractBeccaEntity._setContent / MAX_BLOB_CONTENT_LENGTH).
 */
function baseMulterOptions(): multer.Options {
    const limits: NonNullable<multer.Options["limits"]> & { fieldNestingDepth?: number } = {
        fieldNestingDepth: 0
    };

    return {
        limits,
        fileFilter: (req: express.Request, file, cb) => {
            // UTF-8 file names are not well decoded by multer/busboy, so we handle the conversion on our side.
            // See https://github.com/expressjs/multer/pull/1102.
            file.originalname = Buffer.from(file.originalname, "latin1").toString("utf-8");
            cb(null, true);
        }
    };
}

export function createUploadMiddleware(): RequestHandler {
    // In-memory storage: small uploads (images, single files) that downstream handlers read as `file.buffer`.
    return multer(baseMulterOptions()).single("upload");
}

export function createImportUploadMiddleware(): RequestHandler {
    // Disk storage: imports can be large archives, so stream the upload to Trilium's tmp dir instead of
    // buffering the whole multipart in memory during the HTTP receive. The temp file is read back into
    // `file.buffer` and deleted by importMiddlewareWithErrorHandling before the handler runs.
    const outDir = join(dataDirs.TMP_DIR, "upload");
    mkdirSync(outDir, { recursive: true });

    return multer({
        ...baseMulterOptions(),
        storage: multer.diskStorage({
            destination: (req, file, cb) => cb(null, outDir),
            filename: (req, file, cb) => cb(null, `upload-${coreUtils.randomString(13)}.trilium`)
        })
    }).single("upload");
}

const uploadMiddleware = createUploadMiddleware();
const importUploadMiddleware = createImportUploadMiddleware();

/** Maps the multer field-nesting guard to a clean 400; returns true when the request was already answered. */
function rejectedNestedField(err: { code?: string } | undefined, res: express.Response): boolean {
    if (err?.code === "LIMIT_FIELD_NESTING") {
        // Triggered by the fieldNestingDepth: 0 limit (CVE-2026-5079 guard). Without this branch the
        // error would be swallowed and the request forwarded to the handler with no file.
        res.setHeader("Content-Type", "text/plain").status(400).send("Upload rejected: nested multipart field names are not allowed.");
        return true;
    }
    return false;
}

export const uploadMiddlewareWithErrorHandling = function (req: express.Request, res: express.Response, next: express.NextFunction) {
    uploadMiddleware(req, res, (err) => {
        if (!rejectedNestedField(err, res)) {
            next();
        }
    });
};

export const importMiddlewareWithErrorHandling = function (req: express.Request, res: express.Response, next: express.NextFunction) {
    importUploadMiddleware(req, res, (err) => {
        if (rejectedNestedField(err, res)) {
            return;
        }
        if (err) {
            next(err);
            return;
        }

        const file = req.file;
        if (file?.path && isStreamableZipUpload(req)) {
            // Zip import (generic *or* a tagged provider): hand the importer the temp file's path so the
            // archive is read in place per entry (the route prefers `file.path`), never buffered. Keep the
            // temp file alive through the import and delete it once the response is done (or the connection
            // drops).
            const tempPath = file.path;
            res.on("close", () => void rm(tempPath, { force: true }).catch(() => {}));
            next();
            return;
        }

        void materializeUploadedImport(file, next);
    });
};

/**
 * Whether this upload is a `.zip` read by a zip-reading importer — the case worth streaming from disk. That
 * covers both the generic zip importer and the tagged providers (notion/keep/anytype/obsidian), which all
 * read the archive via the zip provider and now accept a path. Non-zip files, and a generic `.zip` the user
 * chose not to explode, go through the buffer-based {@link materializeUploadedImport} path instead. Kept in
 * sync with the zip branches in the core import route (services/import/dispatch.ts).
 */
function isStreamableZipUpload(req: express.Request): boolean {
    const body = req.body as Record<string, string> | undefined;
    const isZip = req.file?.originalname?.toLowerCase().endsWith(".zip") ?? false;
    if (!isZip) {
        return false;
    }
    // A tagged provider always reads its zip regardless of the explode toggle; only the generic importer
    // honours `explodeArchives=false` (storing the zip as a single attachment, which needs the buffer).
    if (body?.format) {
        return true;
    }
    return body?.explodeArchives !== "false";
}

/**
 * For uploads that aren't streamed from a path (tagged providers, non-zip files, the browser): diskStorage
 * gives us `file.path` rather than `file.buffer`, but those importers consume `file.buffer`, so read the
 * temp file back into it and delete the temp file before handing off — the unlink is awaited so nothing is
 * left behind even if the handler later throws.
 */
async function materializeUploadedImport(file: Express.Multer.File | undefined, next: express.NextFunction) {
    if (!file?.path) {
        next();
        return;
    }
    const tempPath = file.path;
    try {
        file.buffer = await readFile(tempPath);
    } catch (readErr) {
        next(readErr);
        return;
    } finally {
        await rm(tempPath, { force: true }).catch(() => {});
    }
    next();
}
