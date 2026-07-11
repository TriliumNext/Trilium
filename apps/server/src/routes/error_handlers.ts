import { ForbiddenError, HttpError, NotFoundError } from "@triliumnext/core";
import type { Application, NextFunction, Request, Response } from "express";

import { getLog } from "@triliumnext/core";

function register(app: Application) {

    app.use((err: unknown | Error, req: Request, res: Response, next: NextFunction) => {

        const isCsrfTokenError = typeof err === "object"
            && err
            && "code" in err
            && err.code === "EBADCSRFTOKEN";

        if (isCsrfTokenError) {
            const csrfHeader = req.headers["x-csrf-token"];
            const csrfHeaderPrefix = typeof csrfHeader === "string" ? csrfHeader.slice(0, 8) : undefined;
            const tokenInfo = csrfHeaderPrefix ? ` (token prefix: ${csrfHeaderPrefix})` : "";
            getLog().error(`Invalid CSRF token on ${req.method} ${req.url}${tokenInfo}`);
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

        getLog().info(errMessage);

        // Many upstream failures hide their real reason below the surface `.message`: OAuth/OIDC errors
        // stash it in `error` / `error_description`, while undici's opaque `TypeError: fetch failed`
        // (thrown e.g. when the OIDC discovery/token request can't reach the provider — TLS rejection,
        // DNS failure, refused connection) keeps it in the nested `.cause` chain. Surface both so these
        // are diagnosable instead of a bare "fetch failed".
        const detail = describeError(err);
        const plainMessage = err instanceof Error ? err.message : undefined;
        if (detail && detail !== plainMessage) {
            getLog().error(`Error on ${req.method} ${req.url}: ${detail}`);
        }

        res.status(statusCode).send({
            message: err instanceof Error ? err.message : "Unknown Error"
        });

    });
}

/**
 * Pulls the OAuth/OIDC error code and description off an error, if present. Returns `null` when the
 * error carries neither, so callers can skip logging for ordinary errors.
 */
export function extractOAuthErrorDetail(err: unknown) {
    if (typeof err !== "object" || err === null) {
        return null;
    }

    const candidate = err as { error?: unknown; error_description?: unknown };
    const code = typeof candidate.error === "string" ? candidate.error : undefined;
    const description = typeof candidate.error_description === "string" ? candidate.error_description : undefined;

    if (!code && !description) {
        return null;
    }

    return [ code, description ].filter(Boolean).join(": ");
}

/**
 * Builds a single-line, diagnosable description of an error for logging. Beyond the top-level
 * `.message` it surfaces:
 *  - OAuth/OIDC `error` / `error_description` fields (see {@link extractOAuthErrorDetail}),
 *  - Node system-error fields (`code`, `syscall`, `hostname`, `address`, `port`), and
 *  - the nested `.cause` chain — crucial for undici's opaque `TypeError: fetch failed`, whose real
 *    reason (e.g. `DEPTH_ZERO_SELF_SIGNED_CERT`, `ENOTFOUND`, `ECONNREFUSED`) only lives in `cause`.
 *
 * Returns `null` for non-object errors (e.g. a thrown string) that carry no extractable detail.
 */
export function describeError(err: unknown) {
    const segments: string[] = [];
    const seen = new Set<unknown>();
    let current: unknown = err;

    // Bounded walk down the cause chain, guarding against cycles and pathologically deep nesting.
    while (current && typeof current === "object" && !seen.has(current) && seen.size < 8) {
        seen.add(current);

        const candidate = current as { message?: unknown; cause?: unknown } & Record<string, unknown>;
        const parts: string[] = [];

        if (typeof candidate.message === "string" && candidate.message) {
            parts.push(candidate.message);
        }

        const oauthDetail = extractOAuthErrorDetail(current);
        if (oauthDetail) {
            parts.push(oauthDetail);
        }

        const systemFields = [ candidate.code, candidate.syscall, candidate.hostname, candidate.address, candidate.port ]
            .filter((value): value is string | number => typeof value === "string" || typeof value === "number")
            .map(String);
        if (systemFields.length) {
            parts.push(`[${systemFields.join(" ")}]`);
        }

        if (parts.length) {
            segments.push(parts.join(" "));
        }

        current = candidate.cause;
    }

    return segments.length ? segments.join(" ← caused by: ") : null;
}

export default {
    register
};
