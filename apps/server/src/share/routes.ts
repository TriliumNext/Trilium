import { getShareRoutes, handleShareRequest, type ShareReply, type ShareRequest } from "@triliumnext/core/src/share/index.js";
import type { Request, Response, Router } from "express";

import { registerShareProvider } from "./share_provider.js";

/** Mounts the share routes on the Express router, one adapter per transport-neutral core handler. */
function register(router: Router) {
    registerShareProvider();

    for (const route of getShareRoutes()) {
        router.get(route.path, (req, res) => {
            send(res, handleShareRequest(route, toShareRequest(req)));
        });
    }
}

function toShareRequest(req: Request): ShareRequest {
    return {
        path: req.path,
        // Express types a repeated path parameter as an array; the share patterns declare each of
        // theirs once, so every match here is a single segment.
        params: req.params as Record<string, string | undefined>,
        query: req.query as Record<string, string | string[] | undefined>,
        getHeader: (name: string) => req.header(name)
    };
}

function send(res: Response, reply: ShareReply) {
    if (reply.redirect) {
        res.redirect(reply.redirect);

        return;
    }

    for (const [name, value] of Object.entries(reply.headers)) {
        res.setHeader(name, value);
    }

    if (reply.body === undefined) {
        res.sendStatus(reply.status);

        return;
    }

    res.status(reply.status).send(reply.body instanceof Uint8Array ? Buffer.from(reply.body) : reply.body);
}

export default {
    register
};
