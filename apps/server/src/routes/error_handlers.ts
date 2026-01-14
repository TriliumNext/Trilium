import { ForbiddenError, HttpError, NotFoundError } from "@triliumnext/core";
import type { Application, NextFunction, Request, Response } from "express";

import log from "../services/log.js";

function register(app: Application) {

    app.use((err: unknown | Error, req: Request, res: Response, next: NextFunction) => {

        const isCsrfTokenError = typeof err === "object"
            && err
            && "code" in err
            && err.code === "EBADCSRFTOKEN";

        if (isCsrfTokenError) {
            log.error(`Invalid CSRF token: ${req.headers["x-csrf-token"]}, secret: ${req.cookies["_csrf"]}`);
            return next(new ForbiddenError("Invalid CSRF token"));
        }

        return next(err);
    });

    // catch 404 and forward to error handler
    app.use((req, res, next) => {
        const err = new NotFoundError(`Router not found for request ${req.method} ${req.url}`);
        next(err);
    });

    // error handler
    app.use((err: unknown | Error, req: Request, res: Response, _next: NextFunction) => {

        const statusCode = (err instanceof HttpError) ? err.statusCode : 500;
        const errMessage = (err instanceof Error && statusCode !== 404)
            ? err
            : `${statusCode} ${req.method} ${req.url}`;

        log.info(errMessage);

        res.status(statusCode).send({
            message: err instanceof Error ? err.message : "Unknown Error"
        });

    });
}

export default {
    register
};
