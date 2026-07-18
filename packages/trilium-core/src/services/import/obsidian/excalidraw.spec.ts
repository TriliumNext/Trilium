import LZString from "lz-string";
import { describe, expect, it } from "vitest";

import { isExcalidrawPath, parseExcalidraw } from "./excalidraw.js";

/** Wraps a scene object in an Obsidian Excalidraw-plugin Markdown file with a compressed-json drawing block. */
function compressedFile(scene: object, embeddedFiles = ""): string {
    const compressed = LZString.compressToBase64(JSON.stringify(scene));
    return `---\nexcalidraw-plugin: parsed\ntags: [excalidraw]\n---\n# Excalidraw Data\n## Text Elements\n${embeddedFiles}%%\n## Drawing\n\`\`\`compressed-json\n${compressed}\n\`\`\`\n%%`;
}

const SCENE = {
    type: "excalidraw",
    version: 2,
    source: "https://github.com/zsviczian/obsidian-excalidraw-plugin",
    elements: [{ id: "a", type: "rectangle", x: 0, y: 0 }],
    appState: { viewBackgroundColor: "#fff", gridModeEnabled: false },
    files: {}
};

describe("isExcalidrawPath", () => {
    it("matches only the plugin's `.excalidraw.md` suffix, case-insensitively", () => {
        expect(isExcalidrawPath("Excalidraw/Drawing.excalidraw.md")).toBe(true);
        expect(isExcalidrawPath("Drawing.EXCALIDRAW.MD")).toBe(true);
        expect(isExcalidrawPath("Note.md")).toBe(false);
        expect(isExcalidrawPath("Drawing.excalidraw")).toBe(false);
    });
});

describe("parseExcalidraw", () => {
    it("decompresses a compressed-json drawing into canvas content with `files` emptied", () => {
        const drawing = parseExcalidraw(compressedFile(SCENE));
        if (!drawing) {
            throw new Error("drawing was not parsed");
        }

        const content = JSON.parse(drawing.content);
        // The Trilium canvas shape: type/version/elements/appState carried over, the source key dropped and
        // files emptied (images become attachments, not inline data).
        expect(content).toEqual({
            type: "excalidraw",
            version: 2,
            elements: [{ id: "a", type: "rectangle", x: 0, y: 0 }],
            files: {},
            appState: { viewBackgroundColor: "#fff", gridModeEnabled: false }
        });
        expect(drawing.embeddedFiles.size).toBe(0);
    });

    it("parses an uncompressed `## Drawing` json block", () => {
        const markdown = `## Drawing\n\`\`\`json\n${JSON.stringify(SCENE)}\n\`\`\``;
        const drawing = parseExcalidraw(markdown);
        expect(drawing && JSON.parse(drawing.content).elements).toEqual([{ id: "a", type: "rectangle", x: 0, y: 0 }]);
    });

    it("maps an image element's fileId to its embedded vault file, ignoring unreferenced entries", () => {
        const scene = {
            ...SCENE,
            elements: [{ id: "img", type: "image", fileId: "abc123def456" }]
        };
        const embedded = "## Embedded Files\nabc123def456: [[picture.png|100]]\nffffffffffff: [[unused.png]]\n";
        const drawing = parseExcalidraw(compressedFile(scene, embedded));
        if (!drawing) {
            throw new Error("drawing was not parsed");
        }

        // Only the fileId an element references is kept, and the `|size` alias is stripped to the bare ref.
        expect([...drawing.embeddedFiles]).toEqual([["abc123def456", "picture.png"]]);
    });

    it("defaults missing elements and appState to empty in the canvas content", () => {
        const drawing = parseExcalidraw(`## Drawing\n\`\`\`json\n${JSON.stringify({ type: "excalidraw" })}\n\`\`\``);
        const content = drawing && JSON.parse(drawing.content);
        expect(content).toMatchObject({ elements: [], appState: {}, files: {} });
        expect(drawing?.embeddedFiles.size).toBe(0);
    });

    it("ignores scene elements that are null or carry no string fileId when collecting embeds", () => {
        const scene = { ...SCENE, elements: [null, { id: "x", type: "rectangle" }, { id: "img", type: "image", fileId: 42 }] };
        const embedded = "## Embedded Files\nabc123def456: [[picture.png]]\n";
        const drawing = parseExcalidraw(compressedFile(scene, embedded));
        expect(drawing?.embeddedFiles.size).toBe(0);
    });

    it("returns null when there is no drawing block or the data is corrupt", () => {
        expect(parseExcalidraw("# Just a heading\nNo drawing here.")).toBeNull();
        expect(parseExcalidraw("## Drawing\n```compressed-json\nnot-valid-base64!!\n```")).toBeNull();
        expect(parseExcalidraw("## Drawing\n```json\n{ not json\n```")).toBeNull();
        // A structurally-valid JSON that isn't an object (a bare number) is rejected too.
        expect(parseExcalidraw("## Drawing\n```json\n42\n```")).toBeNull();
        // An empty compressed-json block decompresses to nothing rather than throwing.
        expect(parseExcalidraw("## Drawing\n```compressed-json\n\n```")).toBeNull();
    });
});
