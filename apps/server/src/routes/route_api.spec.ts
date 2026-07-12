import express from "express";
import { existsSync } from "fs";
import request from "supertest";
import { describe, expect, it } from "vitest";

import { importMiddlewareWithErrorHandling, uploadMiddlewareWithErrorHandling } from "./route_api.js";

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
