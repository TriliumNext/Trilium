import type { Request, Response } from "express";

import { wrapStringOrBuffer } from "../services/utils/binary.js";
import { getContentDisposition } from "../services/utils/index.js";

/** The content a (possibly ranged) request is answered from. */
export interface RangedContent {
    content: string | Uint8Array;
    fileName: string;
    mimeType: string;
    /** A stable content identifier (a blobId is a content hash), sent as the ETag so a dropped stream can be resumed. */
    etag?: string;
}

/** A byte range with both ends inclusive — the form the HTTP `Range` header speaks in. */
export interface ByteRange {
    start: number;
    end: number;
}

/**
 * Answers a request for `content` the way a static file server does: the whole body by default, a
 * `206` carrying just the requested slice when the client sends a `Range` header, and a `416` when
 * that header names bytes the content does not have. Media elements rely on this to seek without
 * pulling the whole file down first.
 *
 * Deliberately transport-neutral: it touches only `status`/`setHeader`/`send`, the response surface
 * Express and the standalone browser router both implement, so one handler serves the server,
 * desktop and standalone (WASM) variants alike.
 */
export function serveContentWithRanges(req: Request, res: Response, { content, fileName, mimeType, etag }: RangedContent) {
    const bytes = wrapStringOrBuffer(content);
    const totalSize = bytes.byteLength;

    res.setHeader("Content-Type", mimeType);
    res.setHeader("Content-Disposition", getContentDisposition(fileName));
    res.setHeader("Accept-Ranges", "bytes");
    if (etag) {
        // An entity-tag is quoted by definition; caches and proxies ignore an unquoted one.
        res.setHeader("ETag", /^(W\/)?".*"$/.test(etag) ? etag : `"${etag}"`);
    }

    const rangeHeader = req.headers?.range;

    let range: ByteRange | null;
    try {
        range = parseRangeHeader(rangeHeader, totalSize);
    } catch {
        res.setHeader("Content-Range", `bytes */${totalSize}`);
        return res.status(416).send(`Invalid value for Range: ${rangeHeader}`);
    }

    if (!range) {
        res.setHeader("Content-Length", String(totalSize));
        return res.send(toResponseBody(bytes));
    }

    const { start, end } = range;
    res.setHeader("Content-Range", `bytes ${start}-${end}/${totalSize}`);
    res.setHeader("Content-Length", String(end - start + 1));
    // A slice must never be cached as if it were the whole file.
    res.setHeader("Cache-Control", "no-cache");
    return res.status(206).send(toResponseBody(bytes.subarray(start, end + 1)));
}

const RANGE_PATTERN = /^bytes=(\d*)-(\d*)$/;

/**
 * Resolves a `Range` header against the content's size into a clamped, inclusive range, or `null`
 * when the whole body should be served. Only a single range is supported, which is all a media
 * element ever asks for.
 *
 * A header that cannot be parsed is ignored rather than rejected (RFC 9110 §14.2), so an odd client
 * still gets its content; only a well-formed range that falls outside the content is unsatisfiable.
 */
function parseRangeHeader(rangeHeader: string | undefined, totalSize: number): ByteRange | null {
    const match = rangeHeader ? RANGE_PATTERN.exec(rangeHeader.trim()) : null;
    if (!match || totalSize === 0) {
        return null;
    }

    const [ , startValue, endValue ] = match;

    // `bytes=-500` asks for the last 500 bytes, not for a range starting at zero.
    if (startValue === "") {
        const suffixLength = Number(endValue);
        if (endValue === "" || suffixLength === 0) {
            throw new UnsatisfiableRangeError();
        }

        return { start: Math.max(totalSize - suffixLength, 0), end: totalSize - 1 };
    }

    const start = Number(startValue);
    // `bytes=500-` runs to the end, and an end past it is clamped rather than refused.
    const end = endValue === "" ? totalSize - 1 : Math.min(Number(endValue), totalSize - 1);

    if (start > end || start >= totalSize) {
        throw new UnsatisfiableRangeError();
    }

    return { start, end };
}

class UnsatisfiableRangeError extends Error {}

/**
 * Express only recognises a Buffer as a binary body — a plain `Uint8Array` would be JSON-serialised —
 * while the standalone router takes either. Wraps without copying, and leaves the bytes alone in the
 * browser, where there is no Buffer.
 */
function toResponseBody(bytes: Uint8Array): Uint8Array {
    if (typeof Buffer === "undefined" || Buffer.isBuffer(bytes)) {
        return bytes;
    }

    return Buffer.from(bytes.buffer, bytes.byteOffset, bytes.byteLength);
}
