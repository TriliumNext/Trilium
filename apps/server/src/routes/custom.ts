import { cls, type Request as CoreRequest, routes } from "@triliumnext/core";
import type { Request, Response, Router } from "express";

import { bindEmitter } from "../cls_provider.js";
import { isScriptingEnabled } from "../services/scripting_guard.js";

function register(router: Router) {
    // explicitly no CSRF middleware since it's meant to allow integration from external services

    router.all("/custom/*path", (req: Request, res: Response, _next) => {
        bindEmitter(req);
        bindEmitter(res);

        cls.init(() => routes.handleCustomRequest(
            joinWildcardPath(req), req as unknown as CoreRequest, res, isScriptingEnabled
        ));
    });
}

/**
 * Rebuilds the path below `/custom/` from the `*path` wildcard.
 *
 * Express 5 splits a wildcard into one array entry per segment, where Express 4 passed the whole
 * remainder as a string. The segments arrive decoded, so joining them naively reproduces the
 * Express 4 behaviour a handler's pattern was written against.
 *
 * @TriliumNextTODO: remove the typecast once express types are fixed — they currently only treat
 * `req.params` as string, while in reality it can also be a string[] when using wildcards.
 * @TriliumNextTODO: `splitPath.map(segment => encodeURIComponent(segment)).join("/")` might be safer.
 */
function joinWildcardPath(req: Request): string {
    const splitPath = req.params.path as unknown as string[];

    return splitPath.join("/");
}

export default {
    register
};
