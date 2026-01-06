import { getCrypto } from "../encryption/crypto";
import { sanitizeFileName } from "../sanitizer";
import { encodeBase64 } from "./binary";
import mimeTypes from "mime-types";
import escape from "escape-html";
import unescape from "unescape";

// render and book are string note in the sense that they are expected to contain empty string
const STRING_NOTE_TYPES = new Set(["text", "code", "relationMap", "search", "render", "book", "mermaid", "canvas", "webView"]);
const STRING_MIME_TYPES = new Set(["application/javascript", "application/x-javascript", "application/json", "application/x-sql", "image/svg+xml"]);

export function hash(text: string) {
    return encodeBase64(getCrypto().createHash("sha1", text.normalize()));
}

export function isStringNote(type: string | undefined, mime: string) {
    return (type && STRING_NOTE_TYPES.has(type)) || mime.startsWith("text/") || STRING_MIME_TYPES.has(mime);
}

// TODO: Refactor to use getCrypto() directly.
export function randomString(length: number) {
    return getCrypto().randomString(length);
}

export function newEntityId() {
    return randomString(12);
}

export function hashedBlobId(content: string | Uint8Array) {
    if (content === null || content === undefined) {
        content = "";
    }

    // sha512 is faster than sha256
    const base64Hash = encodeBase64(getCrypto().createHash("sha512", content));

    // we don't want such + and / in the IDs
    const kindaBase62Hash = base64Hash.replaceAll("+", "X").replaceAll("/", "Y");

    // 20 characters of base62 gives us ~120 bit of entropy which is plenty enough
    return kindaBase62Hash.substr(0, 20);
}

export function quoteRegex(url: string) {
    return url.replace(/[.*+\-?^${}()|[\]\\]/g, "\\$&");
}

export function replaceAll(string: string, replaceWhat: string, replaceWith: string) {
    const quotedReplaceWhat = quoteRegex(replaceWhat);

    return string.replace(new RegExp(quotedReplaceWhat, "g"), replaceWith);
}

export function removeDiacritic(str: string) {
    if (!str) {
        return "";
    }
    str = str.toString();
    return str.normalize("NFD").replace(/\p{Diacritic}/gu, "");
}

export function normalize(str: string) {
    return removeDiacritic(str).toLowerCase();
}

export function sanitizeAttributeName(origName: string) {
    const fixedName = origName === "" ? "unnamed" : origName.replace(/[^\p{L}\p{N}_:]/gu, "_");
    // any not allowed character should be replaced with underscore

    return fixedName;
}

export function getContentDisposition(filename: string) {
    const sanitizedFilename = sanitizeFileName(filename).trim() || "file";
    const uriEncodedFilename = encodeURIComponent(sanitizedFilename);
    return `file; filename="${uriEncodedFilename}"; filename*=UTF-8''${uriEncodedFilename}`;
}

export function formatDownloadTitle(fileName: string, type: string | null, mime: string) {
    const fileNameBase = !fileName ? "untitled" : sanitizeFileName(fileName);

    const getExtension = () => {
        if (type === "text") return ".html";
        if (type === "relationMap" || type === "canvas" || type === "search") return ".json";
        if (!mime) return "";

        const mimeLc = mime.toLowerCase();

        // better to just return the current name without a fake extension
        // it's possible that the title still preserves the correct extension anyways
        if (mimeLc === "application/octet-stream") return "";

        // if fileName has an extension matching the mime already - reuse it
        const mimeTypeFromFileName = mimeTypes.lookup(fileName);
        if (mimeTypeFromFileName === mimeLc) return "";

        // as last resort try to get extension from mimeType
        const extensions = mimeTypes.extension(mime);
        return extensions ? `.${extensions}` : "";
    };

    return `${fileNameBase}${getExtension()}`;
}

export function toMap<T extends Record<string, any>>(list: T[], key: keyof T) {
    const map = new Map<string, T>();
    for (const el of list) {
        const keyForMap = el[key];
        if (!keyForMap) continue;
        // TriliumNextTODO: do we need to handle the case when the same key is used?
        // currently this will overwrite the existing entry in the map
        map.set(keyForMap, el);
    }
    return map;
}

export const escapeHtml = escape;

export const unescapeHtml = unescape;
