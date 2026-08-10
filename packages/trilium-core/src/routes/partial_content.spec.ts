import type { Request, Response } from "express";
import { describe, expect, it } from "vitest";

import { serveContentWithRanges } from "./partial_content.js";

const decoder = new TextDecoder();

interface ServeResult {
    status: number;
    headers: Record<string, string>;
    body: string;
    byteLength: number;
}

/** Serves `content` through the real handler, capturing what it wrote to the response. */
function serve(content: string | Uint8Array, range?: string, etag?: string): ServeResult {
    const captured: ServeResult = { status: 200, headers: {}, body: "", byteLength: 0 };

    const res = {
        setHeader(name: string, value: string) {
            captured.headers[name] = value;
            return res;
        },
        status(code: number) {
            captured.status = code;
            return res;
        },
        send(body: string | Uint8Array) {
            captured.body = typeof body === "string" ? body : decoder.decode(body);
            captured.byteLength = typeof body === "string" ? body.length : body.byteLength;
            return res;
        }
    } as unknown as Response;

    const req = { headers: range ? { range } : {} } as unknown as Request;
    serveContentWithRanges(req, res, { content, fileName: "clip.mp3", mimeType: "audio/mpeg", etag });

    return captured;
}

const CONTENT = "0123456789";

describe("serveContentWithRanges", () => {
    it("serves the whole body, and the headers a client needs to start ranging, when no range is asked for", () => {
        const res = serve(CONTENT, undefined, "blobA");

        expect(res.status).toBe(200);
        expect(res.body).toBe(CONTENT);
        expect(res.headers).toMatchObject({
            "Content-Type": "audio/mpeg",
            "Accept-Ranges": "bytes",
            "Content-Length": "10",
            // An entity-tag has to be quoted, and one that already is stays as it was.
            ETag: `"blobA"`
        });
        expect(res.headers["Content-Disposition"]).toContain("clip.mp3");
        expect(res.headers["Content-Range"]).toBeUndefined();
        expect(serve(CONTENT, undefined, `"quoted"`).headers.ETag).toBe(`"quoted"`);
        expect(serve(CONTENT).headers.ETag).toBeUndefined();
    });

    it("answers a range with 206 and just that slice", () => {
        const res = serve(CONTENT, "bytes=2-5");

        expect(res.status).toBe(206);
        expect(res.body).toBe("2345");
        expect(res.headers["Content-Range"]).toBe("bytes 2-5/10");
        expect(res.headers["Content-Length"]).toBe("4");
        // A slice must not be cached as though it were the whole file.
        expect(res.headers["Cache-Control"]).toBe("no-cache");
    });

    it("handles the open-ended, suffix and single-byte forms a player uses to probe", () => {
        const openEnded = serve(CONTENT, "bytes=6-");
        expect(openEnded.status).toBe(206);
        expect(openEnded.body).toBe("6789");
        expect(openEnded.headers["Content-Range"]).toBe("bytes 6-9/10");

        // `bytes=-3` means the *last* three bytes, not a range starting at zero.
        const suffix = serve(CONTENT, "bytes=-3");
        expect(suffix.body).toBe("789");
        expect(suffix.headers["Content-Range"]).toBe("bytes 7-9/10");

        // A single byte is one byte long — the length must agree with the body.
        const single = serve(CONTENT, "bytes=0-0");
        expect(single.body).toBe("0");
        expect(single.headers["Content-Length"]).toBe("1");

        // A suffix longer than the content is the whole content.
        expect(serve(CONTENT, "bytes=-500").headers["Content-Range"]).toBe("bytes 0-9/10");
    });

    it("clamps an end past the content instead of refusing it", () => {
        const res = serve(CONTENT, "bytes=8-999");

        expect(res.status).toBe(206);
        expect(res.body).toBe("89");
        expect(res.headers["Content-Range"]).toBe("bytes 8-9/10");
    });

    it("rejects a range that starts beyond the content with 416", () => {
        for (const range of [ "bytes=10-12", "bytes=5-2", "bytes=-0" ]) {
            const res = serve(CONTENT, range);
            expect(res.status, range).toBe(416);
            expect(res.headers["Content-Range"], range).toBe("bytes */10");
        }
    });

    it("ignores a header it cannot parse, and serves the whole body", () => {
        // RFC 9110 §14.2: an unparseable Range is ignored rather than rejected.
        for (const range of [ "bytes=abc", "rows=1-2", "bytes=1-2, 5-6", "" ]) {
            const res = serve(CONTENT, range);
            expect(res.status, range).toBe(200);
            expect(res.body, range).toBe(CONTENT);
        }
    });

    it("slices by byte, not by character, so multi-byte content is not corrupted", () => {
        // "é" is two bytes in UTF-8, so a two-byte range holds exactly one character.
        const res = serve("éé", "bytes=0-1");

        expect(res.status).toBe(206);
        expect(res.body).toBe("é");
        expect(res.headers["Content-Range"]).toBe("bytes 0-1/4");
    });

    it("serves empty content as an empty 200, range header or not", () => {
        for (const range of [ undefined, "bytes=0-10" ]) {
            const res = serve(new Uint8Array(), range);
            expect(res.status).toBe(200);
            expect(res.byteLength).toBe(0);
            expect(res.headers["Content-Length"]).toBe("0");
        }
    });
});
