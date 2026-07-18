/**
 * Converts an Obsidian Excalidraw-plugin drawing (`*.excalidraw.md`) into a Trilium `canvas` note.
 *
 * The plugin stores a drawing as a Markdown file with the real scene tucked into a `## Drawing` section —
 * either a `compressed-json` fence (LZ-String/base64, the default) or a plain `json` fence. Both decompress /
 * parse to a standard Excalidraw scene (`{ type, version, elements, appState, files }`), which is exactly the
 * shape a Trilium canvas note stores, so the conversion is mostly a matter of extracting and re-emitting it.
 *
 * Embedded images are not inlined in the scene: an image element carries a `fileId` that the file's
 * `## Embedded Files` section maps to a vault file (`<fileId>: [[image.png]]`). The caller resolves those
 * vault files and saves them as `image`-role attachments titled with the `fileId` — the same way the canvas
 * editor persists images — so the scene's `fileId` references resolve on load. The emitted scene therefore
 * keeps `files` empty (the bytes live in attachments).
 */

import LZString from "lz-string";

interface ExcalidrawScene {
    elements?: unknown[];
    appState?: Record<string, unknown>;
}

export interface ExcalidrawDrawing {
    /** The Trilium canvas content JSON (an Excalidraw scene with `files` emptied — images become attachments). */
    content: string;
    /** Excalidraw `fileId` -> the embedded vault file it references (only ids actually used by an element). */
    embeddedFiles: Map<string, string>;
}

/** Whether a vault path is an Obsidian Excalidraw drawing (the plugin names them `*.excalidraw.md`). */
export function isExcalidrawPath(path: string): boolean {
    return /\.excalidraw\.md$/i.test(path);
}

/**
 * Parses an Excalidraw-plugin Markdown file into the canvas content plus its embedded-image references.
 * Returns `null` when no usable drawing can be extracted (no `## Drawing` block, bad compression, invalid
 * JSON), so the caller can fall back to importing the file as an ordinary text note.
 */
export function parseExcalidraw(markdown: string): ExcalidrawDrawing | null {
    const scene = extractScene(markdown);
    if (!scene) {
        return null;
    }

    const elements = Array.isArray(scene.elements) ? scene.elements : [];
    const content = JSON.stringify({
        type: "excalidraw",
        version: 2,
        elements,
        // Images are persisted as attachments (keyed by fileId), not inline, matching the canvas editor.
        files: {},
        appState: scene.appState ?? {}
    });

    return { content, embeddedFiles: collectEmbeddedFiles(markdown, elements) };
}

/** Extracts and parses the Excalidraw scene from the `## Drawing` section (compressed first, then plain JSON). */
function extractScene(markdown: string): ExcalidrawScene | null {
    const compressed = /```compressed-json\r?\n([\s\S]*?)```/.exec(markdown);
    if (compressed) {
        const json = LZString.decompressFromBase64(compressed[1].replace(/[\r\n]/g, ""));
        return json ? safeParseScene(json) : null;
    }
    const plain = /##+\s+Drawing\s*\r?\n```json\r?\n([\s\S]*?)```/.exec(markdown);
    if (plain) {
        return safeParseScene(plain[1]);
    }
    return null;
}

function safeParseScene(json: string): ExcalidrawScene | null {
    try {
        const parsed = JSON.parse(json);
        return parsed && typeof parsed === "object" ? (parsed as ExcalidrawScene) : null;
    } catch {
        return null;
    }
}

/**
 * Reads the `## Embedded Files` section (`<fileId>: [[vault file]]` per line), keeping only the file ids that
 * an image element actually references so no orphan attachments are created. Display aliases / size suffixes
 * (`[[file|alias]]`) are stripped down to the bare vault reference.
 */
function collectEmbeddedFiles(markdown: string, elements: unknown[]): Map<string, string> {
    const usedFileIds = new Set<string>();
    for (const element of elements) {
        if (element && typeof element === "object" && "fileId" in element) {
            const fileId = (element as { fileId?: unknown }).fileId;
            if (typeof fileId === "string") {
                usedFileIds.add(fileId);
            }
        }
    }

    const embeddedFiles = new Map<string, string>();
    if (usedFileIds.size === 0) {
        return embeddedFiles;
    }

    const lineRegex = /^([0-9a-fA-F]{6,}):\s*\[\[(.+?)\]\]\s*$/gm;
    let match: RegExpExecArray | null;
    while ((match = lineRegex.exec(markdown)) !== null) {
        const [, fileId, ref] = match;
        if (usedFileIds.has(fileId)) {
            embeddedFiles.set(fileId, ref.split("|")[0].trim());
        }
    }
    return embeddedFiles;
}
