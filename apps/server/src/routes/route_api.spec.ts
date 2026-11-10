import { cls, getLog, NotFoundError } from "@triliumnext/core";
import express from "express";
import { existsSync, rmSync } from "fs";
import http, { type Server } from "http";
import type { AddressInfo } from "net";
import request from "supertest";
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from "vitest";

const readBack = vi.hoisted(() => ({
    error: undefined as Error | undefined,
    removeError: undefined as Error | undefined,
    removed: [] as string[]
}));

vi.mock("fs/promises", async (importOriginal) => {
    const actual = await importOriginal<typeof import("fs/promises")>();
    return {
        ...actual,
        readFile: (...args: Parameters<typeof actual.readFile>) =>
            readBack.error ? Promise.reject(readBack.error) : actual.readFile(...args),
        rm: (...args: Parameters<typeof actual.rm>) => {
            readBack.removed.push(String(args[0]));
            return readBack.removeError ? Promise.reject(readBack.removeError) : actual.rm(...args);
        }
    };
});

import {
    apiResultHandler,
    asyncRoute,
    createShareTargetMiddleware,
    importMiddlewareWithErrorHandling,
    multipartBoundary,
    route,
    router,
    stripNulBeforeDelimiters,
    uploadMiddlewareWithErrorHandling
} from "./route_api.js";

/** Minimal app mounting only the import middleware + a handler that reports what it received. */
function buildApp() {
    const app = express();
    app.post("/import", importMiddlewareWithErrorHandling, (req, res) => {
        const file = req.file;
        res.json({
            hasFile: !!file,
            // Present only for the buffered (non-streamed) path; undefined when streamed from a path.
            content: file?.buffer?.toString("utf-8"),
            originalname: file?.originalname,
            hasPath: !!file?.path,
            // Whether the temp file is still on disk while the handler runs.
            tempPresent: file?.path ? existsSync(file.path) : null
        });
    });
    app.use((err: Error, _req: express.Request, res: express.Response, _next: express.NextFunction) => {
        res.status(500).send(err.message);
    });
    return app;
}

/** Minimal app mounting the in-memory upload middleware + a handler that reports the buffered file. */
function buildUploadApp() {
    const app = express();
    app.post("/upload", uploadMiddlewareWithErrorHandling, (req, res) => {
        const file = req.file;
        res.json({
            hasFile: !!file,
            content: file?.buffer?.toString("utf-8"),
            originalname: file?.originalname
        });
    });
    return app;
}

describe("importMiddlewareWithErrorHandling (disk storage)", () => {
    it("streams a generic .zip from its temp path: no buffer, temp kept for the importer", async () => {
        const res = await request(buildApp())
            .post("/import")
            .attach("upload", Buffer.from("PK-zip-bytes"), "backup.zip");

        expect(res.status).toBe(200);
        // Not buffered — the importer reads it in place via file.path.
        expect(res.body.content).toBeUndefined();
        expect(res.body.hasPath).toBe(true);
        // The temp file is still present during the import (cleaned up after the response).
        expect(res.body.tempPresent).toBe(true);
    });

    it("buffers a non-zip upload and removes the temp file before the handler", async () => {
        const res = await request(buildApp())
            .post("/import")
            .attach("upload", Buffer.from("<en-export/>"), "notes.enex");

        expect(res.status).toBe(200);
        expect(res.body.content).toBe("<en-export/>");
        expect(res.body.tempPresent).toBe(false);
    });

    it("streams a .zip tagged with a provider format (e.g. notion) from its temp path too", async () => {
        const res = await request(buildApp())
            .post("/import")
            .field("format", "notion")
            .attach("upload", Buffer.from("notion-zip"), "export.zip");

        expect(res.status).toBe(200);
        // Provider importers now read the archive in place via file.path, so it isn't buffered and the
        // temp file is kept for the duration of the import.
        expect(res.body.content).toBeUndefined();
        expect(res.body.hasPath).toBe(true);
        expect(res.body.tempPresent).toBe(true);
    });

    it("buffers a .zip when explodeArchives is disabled (imported as a single file)", async () => {
        const res = await request(buildApp())
            .post("/import")
            .field("explodeArchives", "false")
            .attach("upload", Buffer.from("opaque-zip"), "thing.zip");

        expect(res.status).toBe(200);
        expect(res.body.content).toBe("opaque-zip");
        expect(res.body.tempPresent).toBe(false);
    });

    it("proceeds to the handler when no file is uploaded", async () => {
        const res = await request(buildApp()).post("/import");

        expect(res.status).toBe(200);
        expect(res.body.hasFile).toBe(false);
    });

    it("rejects a nested multipart field name with a 400 (CVE-2026-5079 guard)", async () => {
        const res = await request(buildApp())
            .post("/import")
            .field("a[b]", "x")
            .attach("upload", Buffer.from("PK-zip-bytes"), "backup.zip");

        expect(res.status).toBe(400);
        expect(res.text).toContain("nested multipart field names are not allowed");
    });

    it("forwards a body it cannot parse as an error instead of reaching the handler", async () => {
        const res = await request(buildApp())
            .post("/import")
            .set("Content-Type", "multipart/form-data; boundary=b")
            .send("--b\r\nContent-Disposition: form-data; name=\"upload\"; filename=\"a.enex\"\r\n\r\nhi");

        expect([ res.status, res.text ]).toEqual([ 500, "Unexpected end of form" ]);
    });

    it("forwards an upload it cannot read back as an error, and removes its temp file", async () => {
        readBack.error = new Error("EIO: i/o error, read");
        readBack.removed = [];
        try {
            const res = await request(buildApp())
                .post("/import")
                .attach("upload", Buffer.from("<en-export/>"), "notes.enex");

            expect([ res.status, res.text ]).toEqual([ 500, "EIO: i/o error, read" ]);
        } finally {
            readBack.error = undefined;
        }
        expect(readBack.removed).toHaveLength(1);
        expect(readBack.removed[0]).toMatch(/upload-\w+\.trilium$/);
        await vi.waitFor(() => expect(existsSync(readBack.removed[0])).toBe(false));
    });
});

describe("uploadMiddlewareWithErrorHandling (in-memory)", () => {
    it("buffers a small upload into file.buffer", async () => {
        const res = await request(buildUploadApp())
            .post("/upload")
            .attach("upload", Buffer.from("<svg/>"), "icon.svg");

        expect(res.status).toBe(200);
        expect(res.body.content).toBe("<svg/>");
        expect(res.body.originalname).toBe("icon.svg");
    });

    it("rejects a nested multipart field name with a 400 (CVE-2026-5079 guard)", async () => {
        const res = await request(buildUploadApp())
            .post("/upload")
            .field("a[b]", "x")
            .attach("upload", Buffer.from("<svg/>"), "icon.svg");

        expect(res.status).toBe(400);
        expect(res.text).toContain("nested multipart field names are not allowed");
    });

    it("proceeds to the handler when no file is uploaded", async () => {
        const res = await request(buildUploadApp()).post("/upload");

        expect(res.status).toBe(200);
        expect(res.body.hasFile).toBe(false);
    });
});

describe("createShareTargetMiddleware", () => {
    it("rejects a file above the size limit before the handler runs", async () => {
        const app = express();
        const handler = vi.fn((_req: express.Request, res: express.Response) => res.sendStatus(200));
        app.post("/share", createShareTargetMiddleware(4), handler);

        const res = await request(app).post("/share").attach("files", Buffer.from("12345"), "big.bin");

        expect(res.status).toBe(400);
        expect(res.text).toContain("Share rejected");
        expect(handler).not.toHaveBeenCalled();
        await request(app).post("/share").attach("files", Buffer.from("1234"), "fits.bin").expect(200);
    });

    it("forwards a body busboy cannot parse as an error instead of reaching the handler", async () => {
        const app = express();
        const handler = vi.fn((_req: express.Request, res: express.Response) => res.sendStatus(200));
        app.post("/share", createShareTargetMiddleware(), handler);
        app.use((err: Error, _req: express.Request, res: express.Response, _next: express.NextFunction) => {
            res.status(500).send(err.message);
        });

        const unterminated = await request(app)
            .post("/share")
            .set("Content-Type", "multipart/form-data; boundary=b")
            .send("--b\r\nContent-Disposition: form-data; name=\"text\"\r\n\r\nhi");
        expect(unterminated.status).toBe(500);
        expect(unterminated.text).toBe("Unexpected end of form");

        const noBoundary = await request(app).post("/share").set("Content-Type", "multipart/form-data").send("x");
        expect(noBoundary.status).toBe(500);
        expect(handler).not.toHaveBeenCalled();
    });

    it("parses a body whose boundary is quoted", async () => {
        const app = express();
        app.post("/share", createShareTargetMiddleware(), (req, res) => res.json(req.body));

        const res = await request(app)
            .post("/share")
            .set("Content-Type", "multipart/form-data; boundary=\"b c\"")
            .send("--b c\r\nContent-Disposition: form-data; name=\"text\"\r\n\r\nhi\r\n\0--b c--\r\n");

        expect(res.body).toEqual({ text: "hi" });
    });
});

describe("temp file cleanup", () => {
    it("leaves no stray rejection when an upload's temp file cannot be removed", async () => {
        const rejections: unknown[] = [];
        const collect = (reason: unknown) => rejections.push(reason);
        process.on("unhandledRejection", collect);
        readBack.removeError = Object.assign(new Error("EBUSY: resource busy or locked"), { code: "EBUSY" });
        readBack.removed = [];
        try {
            const shareApp = express();
            shareApp.post("/share", createShareTargetMiddleware(), (_req, res) => res.sendStatus(200));

            await request(shareApp).post("/share").attach("files", Buffer.from("shared"), "shared.txt").expect(200);
            await request(buildApp()).post("/import").attach("upload", Buffer.from("PK-zip-bytes"), "backup.zip").expect(200);
            await request(buildApp()).post("/import").attach("upload", Buffer.from("<en-export/>"), "notes.enex").expect(200);

            await vi.waitFor(() => expect(readBack.removed).toHaveLength(3));
            await new Promise((resolve) => setTimeout(resolve, 10));
            expect(rejections).toEqual([]);
        } finally {
            readBack.removeError = undefined;
            process.off("unhandledRejection", collect);
            for (const filePath of readBack.removed) {
                rmSync(filePath, { force: true });
            }
        }
    });
});

describe("multipartBoundary", () => {
    it("reads a plain or quoted boundary parameter", () => {
        expect(multipartBoundary("multipart/form-data; boundary=----abc")).toBe("----abc");
        expect(multipartBoundary("multipart/form-data; charset=utf-8; BOUNDARY=\"a b\"")).toBe("a b");
        expect(multipartBoundary("multipart/form-data")).toBeUndefined();
        expect(multipartBoundary(undefined)).toBeUndefined();
    });
});

describe("stripNulBeforeDelimiters", () => {
    it("drops the NUL before every delimiter, wherever the chunks split it", async () => {
        const input = Buffer.from("--b\r\n\r\nx\0y\r\n\0--b\r\n\r\nz\r\n\0--b--\r\n", "latin1");
        const expected = "--b\r\n\r\nx\0y\r\n--b\r\n\r\nz\r\n--b--\r\n";

        for (let split = 0; split <= input.length; split++) {
            const filter = stripNulBeforeDelimiters("b");
            const output: Buffer[] = [];
            filter.on("data", (chunk: Buffer) => output.push(chunk));
            const ended = new Promise((resolve) => filter.on("end", resolve));
            filter.write(input.subarray(0, split));
            filter.end(input.subarray(split));
            await ended;
            expect(Buffer.concat(output).toString("latin1"), `split at ${split}`).toBe(expected);
        }
    });

    it("passes the bytes through unchanged without a boundary", async () => {
        const filter = stripNulBeforeDelimiters(undefined);
        const output: Buffer[] = [];
        filter.on("data", (chunk: Buffer) => output.push(chunk));
        const ended = new Promise((resolve) => filter.on("end", resolve));
        filter.end(Buffer.from("x\r\n\0--b", "latin1"));
        await ended;
        expect(Buffer.concat(output).toString("latin1")).toBe("x\r\n\0--b");
    });
});

/**
 * `internalRoute` opens the CLS context every API handler runs in and seeds it from the
 * `trilium-*` request headers. Entity changes are collected against that context, so losing it
 * mid-request means writes are attributed to no component rather than failing loudly.
 */
describe("internalRoute CLS wiring", () => {
    const closeProbe: { componentId?: string; wrote?: string; error?: string } = {};
    let app: express.Application;

    beforeAll(() => {
        route("get", "/cls/echo", [], () => ({
            componentId: cls.getComponentId(),
            hoistedNoteId: cls.getHoistedNoteId(),
            localNowDateTime: cls.get<string>("localNowDateTime")
        }), apiResultHandler);

        // `pace` selects one of two fixed delays: a timer whose duration comes from the request
        // is a resource-exhaustion sink.
        asyncRoute("get", "/cls/async", [], async (req) => {
            const delayMs = req.query.pace === "slow" ? 30 : 1;
            await new Promise((resolve) => setTimeout(resolve, delayMs));
            return { componentId: cls.getComponentId() };
        }, apiResultHandler);

        asyncRoute("get", "/cls/close-listener", [], (_req, res) => {
            res.on("close", () => {
                try {
                    closeProbe.componentId = cls.getComponentId();
                    cls.set("probe", "written");
                    closeProbe.wrote = cls.get<string>("probe");
                } catch (e: unknown) {
                    closeProbe.error = e instanceof Error ? e.message : String(e);
                }
            });
            return { ok: true };
        }, apiResultHandler);

        app = express();
        app.use(router);
    });

    it("seeds the context from the trilium-* headers", async () => {
        const res = await request(app)
            .get("/cls/echo")
            .set("trilium-component-id", "comp-1")
            .set("trilium-hoisted-note-id", "noteABC")
            .set("trilium-local-now-datetime", "2026-01-01 10:00:00.000+0100")
            .expect(200);

        expect(res.body).toEqual({
            componentId: "comp-1",
            hoistedNoteId: "noteABC",
            localNowDateTime: "2026-01-01 10:00:00.000+0100"
        });
    });

    it("defaults hoistedNoteId to root when the header is absent", async () => {
        const res = await request(app).get("/cls/echo").expect(200);

        expect(res.body.hoistedNoteId).toBe("root");
        expect(res.body.componentId).toBeUndefined();
    });

    it("keeps each request's context across an await, including while they overlap", async () => {
        const call = (pace: string) => request(app)
            .get(`/cls/async?pace=${pace}`)
            .set("trilium-component-id", pace)
            .expect(200);

        // The slow request starts first and finishes last, so the two are in flight together.
        const [slow, fast] = await Promise.all([call("slow"), call("fast")]);

        expect(slow.body.componentId).toBe("slow");
        expect(fast.body.componentId).toBe("fast");
    });

    it("runs a res close listener inside the request's context", async () => {
        await request(app)
            .get("/cls/close-listener")
            .set("trilium-component-id", "comp-close")
            .expect(200);

        await vi.waitFor(() => expect(closeProbe.componentId ?? closeProbe.error).toBeDefined());

        expect(closeProbe.error).toBeUndefined();
        expect(closeProbe.componentId).toBe("comp-close");
        expect(closeProbe.wrote).toBe("written");
    });
});

describe("internalRoute without a result handler", () => {
    let app: express.Application;

    beforeAll(() => {
        asyncRoute("get", "/no-handler/reject", [], async () => {
            throw new Error("boom");
        }, null);

        asyncRoute("get", "/no-handler/reject-http", [], async () => {
            throw new NotFoundError("missing");
        }, null);

        app = express();
        app.use(router);
    });

    it("answers a rejected async handler with a 500 instead of leaving the request open", async () => {
        const res = await request(app).get("/no-handler/reject").timeout(2000).expect(500);

        expect(res.body).toEqual({ message: "boom" });
    });

    it("keeps the status of a rejected HttpError", async () => {
        const res = await request(app).get("/no-handler/reject-http").timeout(2000).expect(404);

        expect(res.body).toEqual({ message: "missing" });
    });
});

describe("internalRoute result handling", () => {
    let app: express.Application;

    beforeAll(() => {
        route("get", "/result/:status", [], (req) => {
            const status = Number(req.params.status);
            return [ status, status === 204 ? "" : { status } ];
        }, apiResultHandler);

        route("get", "/result-handled", [], (_req, res) => {
            res.triliumResponseHandled = true;
            res.status(207).send("handled by the route");
            return { ignored: true };
        }, apiResultHandler);

        asyncRoute("get", "/result-late-failure", [], async (_req, res) => {
            res.status(202).send("partial");
            throw new Error("late failure");
        }, apiResultHandler);

        app = express();
        app.use(router);
    });

    afterEach(() => vi.restoreAllMocks());

    it("sends a [status, body] result with that status, and logs only an unsuccessful one", async () => {
        const info = vi.spyOn(getLog(), "info");

        expect((await request(app).get("/result/201").expect(201)).body).toEqual({ status: 201 });
        await request(app).get("/result/204").expect(204);
        expect((await request(app).get("/result/409").expect(409)).body).toEqual({ status: 409 });

        expect(info.mock.calls.flat().filter((line) => String(line).includes("returned")))
            .toEqual([ `GET /result/409 returned 409 with response {"status":409}` ]);
    });

    it("leaves the response a route already sent alone, and logs it without a length", async () => {
        const logRequest = vi.spyOn(getLog(), "request");

        const res = await request(app).get("/result-handled").expect(207);

        expect(res.text).toBe("handled by the route");
        expect(logRequest).toHaveBeenCalledExactlyOnceWith(expect.anything(), expect.anything(), expect.any(Number), 0);
    });

    it("logs a handler that fails after answering, without answering twice", async () => {
        const error = vi.spyOn(getLog(), "error");

        const res = await request(app).get("/result-late-failure").expect(202);

        expect(res.text).toBe("partial");
        expect(error).toHaveBeenCalledExactlyOnceWith(expect.stringMatching(/^get \/result-late-failure threw exception: 'late failure'/));
    });
});

describe("internalRoute response delivery", () => {
    let server: Server;
    let port: number;

    beforeAll(async () => {
        route("get", "/delivery/large", [], () => ({ payload: "x".repeat(64 * 1024 * 1024) }), apiResultHandler);
        route("get", "/delivery/small", [], () => ({ ok: true }), apiResultHandler);
        // Sends the head and the start of a 1024-byte body and holds back the rest, as a transfer
        // that the client gives up on does.
        route("get", "/delivery/stalled", [], () => ({}), (_req, res) => {
            res.status(200).setHeader("Content-Type", "text/plain");
            res.write("x".repeat(16));
            return 1024;
        });

        const app = express();
        app.use(router);
        server = app.listen(0);
        await new Promise((resolve) => server.once("listening", resolve));
        port = (server.address() as AddressInfo).port;
    });

    afterAll(() => {
        server.close();
    });

    /** Requests `path` and drops the connection as soon as the first bytes of the body arrive. */
    function disconnectAfterFirstChunk(path: string) {
        return new Promise<void>((resolve, reject) => {
            const req = http.get({ port, path }, (res) => {
                res.once("data", () => {
                    req.destroy();
                    resolve();
                });
            });
            req.on("error", (e: NodeJS.ErrnoException) => e.code === "ECONNRESET" ? resolve() : reject(e));
        });
    }

    it("logs a client that disconnects before the response is delivered", async () => {
        const info = vi.spyOn(getLog(), "info");

        await disconnectAfterFirstChunk("/delivery/stalled?logMarkerId=m1");

        await vi.waitFor(() => expect(info).toHaveBeenCalledWith(
            expect.stringMatching(/^Aborted 200 GET \/delivery\/stalled\?logMarkerId=m1 after \d+ms: /),
        ));
        expect(info.mock.calls.flat().filter((line) => String(line).startsWith("Aborted"))).toEqual([
            expect.stringMatching(/: the client disconnected before receiving the 1024-byte response$/)
        ]);
        info.mockRestore();
    });

    // Windows accepts the whole 64 MiB write into the socket at once, even over loopback with a
    // client that reads nothing, so the response counts as finished before the client disconnects.
    it.skipIf(process.platform === "win32")("logs a client that disconnects during a large transfer", async () => {
        const info = vi.spyOn(getLog(), "info");

        await disconnectAfterFirstChunk("/delivery/large?logMarkerId=m2");

        await vi.waitFor(() => expect(info).toHaveBeenCalledWith(expect.stringMatching(
            /^Aborted 200 GET \/delivery\/large\?logMarkerId=m2 after \d+ms: the client disconnected before receiving the \d+-byte response$/
        )));
        info.mockRestore();
    });

    it("logs nothing extra for a response the client receives in full", async () => {
        const info = vi.spyOn(getLog(), "info");

        await request(server).get("/delivery/small").expect(200);
        await new Promise((resolve) => setTimeout(resolve, 20));

        expect(info.mock.calls.flat().some((line) => String(line).startsWith("Aborted"))).toBe(false);
        info.mockRestore();
    });
});
