import { describe, expect, it } from "vitest";

import { decodeUtf8, encodeBase64 } from "../../utils/binary.js";
import { isDrawingPath, parseDrawing } from "./excalidraw.js";

/** The scene Logseq writes for an empty drawing, verbatim. */
const EMPTY_SCENE = JSON.stringify({
    type: "excalidraw",
    version: 2,
    source: "https://logseq.com",
    elements: [],
    appState: { viewBackgroundColor: "#FFF", gridSize: null }
});

function imageScene(dataURL: unknown, fileId = "abc123") {
    return JSON.stringify({
        type: "excalidraw",
        version: 2,
        source: "file://",
        elements: [{ id: "el1", type: "image", fileId }],
        appState: {},
        files: { [fileId]: { id: fileId, mimeType: "image/png", dataURL } }
    });
}

describe("isDrawingPath", () => {
    it("matches a .excalidraw file regardless of case or folder, and nothing else", () => {
        expect(isDrawingPath("draws/2026-08-10-19-22-24.excalidraw")).toBe(true);
        expect(isDrawingPath("Drawing.EXCALIDRAW")).toBe(true);
        expect(isDrawingPath("assets/image.png")).toBe(false);
        // Obsidian's plugin format is a Markdown file; that's the other importer's business.
        expect(isDrawingPath("Drawing.excalidraw.md")).toBe(false);
    });
});

describe("parseDrawing", () => {
    it("re-emits the scene as canvas content, preserving elements and appState", () => {
        const drawing = parseDrawing(EMPTY_SCENE);

        expect(drawing?.content && JSON.parse(drawing.content)).toEqual({
            type: "excalidraw",
            version: 2,
            elements: [],
            files: {},
            appState: { viewBackgroundColor: "#FFF", gridSize: null }
        });
        expect(drawing?.embeddedFiles.size).toBe(0);
    });

    it("keeps the scene's elements verbatim", () => {
        const elements = [{ id: "dTln2Cy5fbjXJIcLWqmCH", type: "rectangle", x: 299.9, y: 214.3 }];
        const drawing = parseDrawing(JSON.stringify({ type: "excalidraw", version: 2, elements }));

        expect(drawing?.content && JSON.parse(drawing.content).elements).toEqual(elements);
    });

    it("lifts an inline image out of the scene, decoded and keyed by its fileId", () => {
        const bytes = new Uint8Array([137, 80, 78, 71]);
        const drawing = parseDrawing(imageScene(`data:image/png;base64,${encodeBase64(bytes)}`));

        const decoded = drawing?.embeddedFiles.get("abc123");
        expect(decoded?.mime).toBe("image/png");
        // Compared as a plain array: the server's base64 decoder yields a Buffer, the browser's a Uint8Array.
        expect(decoded && Array.from(decoded.bytes)).toEqual([137, 80, 78, 71]);
        // The emitted scene carries no inline files — the picture lives in an attachment now.
        expect(drawing?.content && JSON.parse(drawing.content).files).toEqual({});
    });

    it("drops a file no element references, so no orphan attachment is created", () => {
        const scene = JSON.stringify({
            type: "excalidraw",
            version: 2,
            elements: [{ id: "el1", type: "rectangle" }],
            files: { stale: { id: "stale", mimeType: "image/png", dataURL: "data:image/png;base64,AAAA" } }
        });

        expect(parseDrawing(scene)?.embeddedFiles.size).toBe(0);
    });

    it("drops an image whose dataURL is missing or not base64, keeping the rest of the scene", () => {
        for (const dataURL of [undefined, 42, "https://example.com/image.png", "data:image/png,notbase64"]) {
            const drawing = parseDrawing(imageScene(dataURL));
            expect(drawing?.embeddedFiles.size).toBe(0);
            expect(drawing?.content && JSON.parse(drawing.content).elements).toHaveLength(1);
        }
    });

    it("returns null for anything that isn't an Excalidraw scene", () => {
        expect(parseDrawing("not json at all")).toBeNull();
        expect(parseDrawing("[1, 2, 3]")).toBeNull();
        expect(parseDrawing("null")).toBeNull();
        // A JSON object that merely borrowed the extension: no `type` and no `elements`.
        expect(parseDrawing(JSON.stringify({ hello: "world" }))).toBeNull();
    });

    it("accepts a scene identified by its elements array alone (no type declared)", () => {
        expect(parseDrawing(JSON.stringify({ elements: [], appState: {} }))).not.toBeNull();
    });

    it("tolerates a scene whose elements are missing or malformed", () => {
        const drawing = parseDrawing(JSON.stringify({ type: "excalidraw", elements: "nope" }));

        expect(drawing?.content && JSON.parse(drawing.content)).toEqual({
            type: "excalidraw", version: 2, elements: [], files: {}, appState: {}
        });
    });

    it("survives a UTF-8 round trip of a scene with non-ASCII text", () => {
        const scene = JSON.stringify({ type: "excalidraw", elements: [{ type: "text", text: "Ședință — 日本語" }] });

        expect(parseDrawing(decodeUtf8(new TextEncoder().encode(scene)))?.content).toContain("Ședință — 日本語");
    });
});
