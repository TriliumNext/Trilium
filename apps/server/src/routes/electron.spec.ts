import express from "express";
import multer from "multer";
import { describe, expect, it, vi } from "vitest";

vi.mock("electron", () => ({
    default: {
        app: { whenReady: () => Promise.resolve() },
        protocol: { handle: () => {} }
    }
}));

const { dispatch } = await import("./electron.js");
const { isInternalElectronRequest } = await import("../services/electron_request.js");

function buildTestApp() {
    const app = express();
    app.use(express.json());

    const upload = multer().single("upload");
    app.post("/upload", upload, (req, res) => {
        res.json({
            field: (req.body as Record<string, unknown>)?.note,
            filename: req.file?.originalname,
            size: req.file?.size,
            content: req.file?.buffer?.toString("utf-8")
        });
    });

    app.post("/echo-json", (req, res) => {
        res.json({ echo: req.body });
    });

    return app;
}

describe("electron protocol dispatcher", () => {
    it("forwards multipart/form-data through multer so handlers see req.file", async () => {
        const app = buildTestApp();
        const formData = new FormData();
        formData.append("upload", new Blob(["hello world"], { type: "text/plain" }), "hello.txt");
        formData.append("note", "abc123");

        const request = new Request("trilium-app://app/upload", { method: "POST", body: formData });
        const response = await dispatch(app, request);

        expect(response.status).toBe(200);
        expect(await response.json()).toEqual({
            field: "abc123",
            filename: "hello.txt",
            size: 11,
            content: "hello world"
        });
    });

    it("forwards application/json bodies as parsed objects", async () => {
        const app = buildTestApp();
        const request = new Request("trilium-app://app/echo-json", {
            method: "POST",
            headers: { "content-type": "application/json" },
            body: JSON.stringify({ hello: "world" })
        });
        const response = await dispatch(app, request);

        expect(response.status).toBe(200);
        expect(await response.json()).toEqual({ echo: { hello: "world" } });
    });

    // Auth + CSRF middleware rely on this marker to distinguish a
    // renderer→main protocol dispatch from a public-HTTP request hitting the
    // desktop's TCP listener. Regression for the auth bypass that used to
    // key off the process-wide `isElectron` flag.
    it("tags dispatched requests with the internal-electron marker", async () => {
        const app = express();
        let markedOnHandler: boolean | undefined;
        app.get("/probe", (req, res) => {
            markedOnHandler = isInternalElectronRequest(req);
            res.status(200).send("");
        });

        await dispatch(app, new Request("trilium-app://app/probe"));

        expect(markedOnHandler).toBe(true);
    });

    it("does NOT tag plain Express requests with the internal-electron marker", () => {
        // Anything that didn't come through `dispatch()` — i.e. a real HTTP
        // request to the TCP listener, or an arbitrary attacker-controlled
        // payload — must register as untagged.
        const plainReq = {} as object;
        expect(isInternalElectronRequest(plainReq)).toBe(false);

        // An attacker can't forge the marker via HTTP headers / body fields
        // because the marker is keyed by a non-exported Symbol. Header maps
        // and JSON-decoded bodies that mention the string "trilium-electron-
        // internal-request" can't reach the Symbol-keyed slot.
        const headerForgery = { headers: { "trilium-electron-internal-request": "true" } };
        const bodyForgery = { body: { "trilium-electron-internal-request": true } };
        const stringKeyForgery: Record<string, unknown> = { "trilium-electron-internal-request": true };
        expect(isInternalElectronRequest(headerForgery)).toBe(false);
        expect(isInternalElectronRequest(bodyForgery)).toBe(false);
        expect(isInternalElectronRequest(stringKeyForgery)).toBe(false);
    });
});
