import crypto from "node:crypto";

import { ValidationError } from "@triliumnext/core";
import { isProbedContentType } from "@triliumnext/core/src/services/media_probe.js";
import { validateFetchableUrl } from "@triliumnext/core/src/services/request.js";
import type express from "express";

import { safeFetch } from "../../services/safe_fetch.js";

/** How long the address of a proxied file stays valid: long enough for one frame capture. */
const TOKEN_LIFETIME_MS = 60 * 1000;

/** How long a request through the proxy may take, the transfer of the file included. */
const FETCH_TIMEOUT_MS = 30 * 1000;

/** The headers of the media server's answer that a seeking `<video>` needs. */
const PASSED_HEADERS = [ "content-length", "content-range", "accept-ranges" ];

const proxiedUrls = new Map<string, { url: string; expiresAt: number }>();

/**
 * Returns the address under this server, as `url`, that streams the video file at the `url` of
 * the body for {@link TOKEN_LIFETIME_MS}. The client captures the thumbnail of a video from it
 * when the host of the video sends no CORS headers, which taints a frame read from the host
 * itself. The address carries a token rather than the URL, which stays out of the access logs.
 */
function createProxy(req: express.Request) {
    const url = req.body?.url;
    if (typeof url !== "string" || !url) {
        throw new ValidationError("'url' is required");
    }

    const now = Date.now();
    for (const [ token, entry ] of proxiedUrls) {
        if (entry.expiresAt <= now) {
            proxiedUrls.delete(token);
        }
    }

    const token = crypto.randomBytes(16).toString("hex");
    proxiedUrls.set(token, {
        url: validateFetchableUrl(url).toString(),
        expiresAt: now + TOKEN_LIFETIME_MS
    });
    return { url: `api/link-embed/media-proxy/${token}` };
}

/**
 * Streams the file of the token in the path, with the `Range` of the request, so that a `<video>`
 * can seek in it. `safeFetch()` refuses private addresses, as for any URL from note content. Only
 * a body that can be a media file is passed on, as `nosniff` and under a sandbox policy, so it
 * cannot run as a page of this origin.
 */
async function streamProxy(req: express.Request<{ token: string }>, res: express.Response) {
    const entry = proxiedUrls.get(req.params.token);
    if (!entry || entry.expiresAt <= Date.now()) {
        res.status(404).end();
        return;
    }

    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS);
    res.on("close", () => controller.abort());
    try {
        const range = req.headers.range;
        const upstream = await safeFetch(entry.url, {
            headers: range ? { Range: range } : {},
            signal: controller.signal
        });
        const contentType = (upstream.headers.get("content-type") ?? "")
            .split(";")[0].trim().toLowerCase();
        const reader = upstream.body?.getReader();
        if (!upstream.ok || !reader || !isProbedContentType(contentType)) {
            void reader?.cancel().catch(() => {});
            res.status(upstream.ok ? 415 : 502).end();
            return;
        }

        res.status(upstream.status);
        for (const name of PASSED_HEADERS) {
            const value = upstream.headers.get(name);
            if (value) {
                res.setHeader(name, value);
            }
        }
        res.setHeader("Content-Type", /^(?:video|audio)\//.test(contentType)
            ? contentType
            : "application/octet-stream");
        res.setHeader("X-Content-Type-Options", "nosniff");
        res.setHeader("Content-Security-Policy", "sandbox");
        res.setHeader("Cache-Control", "no-store");
        res.flushHeaders();

        for (;;) {
            const { done, value } = await reader.read();
            if (done || controller.signal.aborted) {
                break;
            }
            if (!res.write(value)) {
                await waitForDrain(res);
            }
        }
        // The abort of the request errors its body, and cancelling an errored body rejects.
        void reader.cancel().catch(() => {});
        res.end();
    } catch {
        if (!res.headersSent) {
            res.status(502);
        }
        res.end();
    } finally {
        clearTimeout(timeout);
    }
}

/** Resolves once `res` can take more data, or once the client has gone away. */
function waitForDrain(res: express.Response) {
    return new Promise<void>((resolve) => {
        const done = () => {
            res.off("drain", done);
            res.off("close", done);
            resolve();
        };
        res.on("drain", done);
        res.on("close", done);
    });
}

export default { createProxy, streamProxy };
