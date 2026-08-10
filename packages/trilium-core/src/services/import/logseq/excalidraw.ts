/**
 * Converts a Logseq drawing (a `draws/*.excalidraw` file) into a Trilium `canvas` note.
 *
 * Logseq stores a drawing as the plain Excalidraw scene JSON — `{ type, version, source, elements, appState,
 * files }` — which is already the shape a Trilium canvas note stores, so the conversion is mostly validation
 * and re-emission. (Obsidian's plugin, by contrast, buries the scene in a Markdown file; see
 * {@link ../obsidian/excalidraw.js}.)
 *
 * The one real difference is images. Excalidraw inlines them in `files` as `fileId -> { dataURL, mimeType }`,
 * while a Trilium canvas note keeps them as `image`-role attachments titled with the `fileId` — the format the
 * canvas editor writes and the only one it re-saves. Trilium's loader still understands inline `files` (that's
 * how legacy notes are stored), but a drawing left that way would silently convert on the first edit, so the
 * pictures are lifted out here: the emitted scene carries an empty `files`, and the caller saves each decoded
 * image as an attachment.
 */

import { decodeBase64 } from "../../utils/binary.js";

interface ExcalidrawScene {
    type?: unknown;
    elements?: unknown[];
    appState?: Record<string, unknown>;
    files?: Record<string, unknown>;
}

export interface LogseqDrawing {
    /** The Trilium canvas content JSON (an Excalidraw scene with `files` emptied — images become attachments). */
    content: string;
    /** Excalidraw `fileId` -> the decoded inline image (only ids an element actually references). */
    embeddedFiles: Map<string, { mime: string; bytes: Uint8Array }>;
}

/** Whether a graph path is a Logseq drawing. They live in `draws/`, but the extension alone identifies them. */
export function isDrawingPath(path: string): boolean {
    return /\.excalidraw$/i.test(path);
}

/**
 * Parses a `.excalidraw` file into the canvas content plus its embedded images. Returns `null` when the file
 * is not a usable Excalidraw scene (invalid JSON, or JSON that isn't a scene), so the caller can fall back to
 * importing it as an ordinary file note.
 */
export function parseDrawing(json: string): LogseqDrawing | null {
    const scene = safeParseScene(json);
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

    return { content, embeddedFiles: collectEmbeddedFiles(scene.files, elements) };
}

/**
 * Parses the file, accepting it only if it looks like an Excalidraw scene: an object that either declares
 * `type: "excalidraw"` or carries an `elements` array. Both `.excalidraw` and Trilium's own canvas content
 * satisfy this; an arbitrary JSON file that merely borrowed the extension does not.
 */
function safeParseScene(json: string): ExcalidrawScene | null {
    let parsed: unknown;
    try {
        parsed = JSON.parse(json);
    } catch {
        return null;
    }
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
        return null;
    }
    const scene = parsed as ExcalidrawScene;
    return scene.type === "excalidraw" || Array.isArray(scene.elements) ? scene : null;
}

/**
 * Decodes the scene's inline `files` into raw bytes, keeping only the ids an image element actually
 * references so no orphan attachments are created. An entry whose `dataURL` isn't decodable base64 is dropped
 * — the element then renders as a placeholder, exactly as it would in Excalidraw itself.
 */
function collectEmbeddedFiles(files: Record<string, unknown> | undefined, elements: unknown[]): Map<string, { mime: string; bytes: Uint8Array }> {
    const embeddedFiles = new Map<string, { mime: string; bytes: Uint8Array }>();
    if (!files || typeof files !== "object") {
        return embeddedFiles;
    }

    const usedFileIds = new Set<string>();
    for (const element of elements) {
        if (element && typeof element === "object" && "fileId" in element) {
            const fileId = (element as { fileId?: unknown }).fileId;
            if (typeof fileId === "string") {
                usedFileIds.add(fileId);
            }
        }
    }

    for (const [fileId, entry] of Object.entries(files)) {
        if (!usedFileIds.has(fileId) || !entry || typeof entry !== "object") {
            continue;
        }
        const decoded = decodeDataUrl((entry as { dataURL?: unknown }).dataURL);
        if (decoded) {
            embeddedFiles.set(fileId, decoded);
        }
    }
    return embeddedFiles;
}

/** Splits a base64 `data:` URL into its mime type and raw bytes; `null` for anything else. */
function decodeDataUrl(dataURL: unknown): { mime: string; bytes: Uint8Array } | null {
    if (typeof dataURL !== "string") {
        return null;
    }
    const match = /^data:([^;,]+);base64,(.*)$/s.exec(dataURL.trim());
    if (!match) {
        return null;
    }
    try {
        return { mime: match[1], bytes: decodeBase64(match[2]) };
    } catch {
        return null;
    }
}
