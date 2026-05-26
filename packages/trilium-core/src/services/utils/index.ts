import { getCrypto } from "../encryption/crypto";
import { getPlatform } from "../platform";
import { sanitizeFileName } from "../sanitizer";
import { encodeBase64 } from "./binary";
import { extensions as mimeToExt, types as extToMime } from "mime-types";
import escape from "escape-html";
import unescape from "unescape";
import { basename, extname } from "./path";
import { NoteMeta } from "../../meta";

export function isDev() { return getPlatform().getEnv("TRILIUM_ENV") === "dev"; }
export function isElectron() { return getPlatform().isElectron; }
export function isMac() { return getPlatform().isMac; }
export function isWindows() { return getPlatform().isWindows; }

// render and book are string note in the sense that they are expected to contain empty string
const STRING_NOTE_TYPES = new Set(["text", "code", "relationMap", "search", "render", "book", "mermaid", "canvas", "webView"]);
const STRING_MIME_TYPES = new Set(["application/javascript", "application/x-javascript", "application/json", "application/x-sql", "image/svg+xml"]);

export function hash(text: string) {
    return encodeBase64(getCrypto().createHash("sha1", text.normalize()));
}

export function md5(content: string | Uint8Array) {
    const bytes = getCrypto().createHash("md5", content);
    return Array.from(bytes).map((b) => b.toString(16).padStart(2, "0")).join("");
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

/**
 * Normalizes URL by removing trailing slashes and fixing double slashes.
 * Preserves the protocol (http://, https://) but removes trailing slashes from the rest.
 *
 * @param url The URL to normalize
 * @returns The normalized URL without trailing slashes
 */
export function normalizeUrl(url: string | null | undefined): string | null | undefined {
    if (!url || typeof url !== 'string') {
        return url;
    }

    // Trim whitespace
    url = url.trim();

    if (!url) {
        return url;
    }

    // Fix double slashes (except in protocol) first
    url = url.replace(/([^:]\/)\/+/g, '$1');

    // Remove trailing slash, but preserve protocol
    if (url.endsWith('/') && !url.match(/^https?:\/\/$/)) {
        url = url.slice(0, -1);
    }

    return url;
}

export function timeLimit<T>(promise: Promise<T>, limitMs: number, errorMessage?: string): Promise<T> {
    // TriliumNextTODO: since TS avoids this from ever happening – do we need this check?
    if (!promise || !promise.then) {
        // it's not actually a promise
        return promise;
    }

    // better stack trace if created outside of promise
    const errorTimeLimit = new Error(errorMessage || `Process exceeded time limit ${limitMs}`);

    return new Promise((res, rej) => {
        let resolved = false;

        promise
            .then((result) => {
                resolved = true;

                res(result);
            })
            .catch((error) => rej(error));

        setTimeout(() => {
            if (!resolved) {
                rej(errorTimeLimit);
            }
        }, limitMs);
    });
}

export function sanitizeAttributeName(origName: string) {
    const fixedName = origName === "" ? "unnamed" : origName.replace(/[^\p{L}\p{N}_:]/gu, "_");
    // any not allowed character should be replaced with underscore

    return fixedName;
}

export function sanitizeSqlIdentifier(str: string) {
    return str.replace(/[^A-Za-z0-9_]/g, "");
}

/**
 * Sanitize SVG to remove potentially dangerous elements and attributes.
 * This prevents XSS via script injection in SVG content.
 */
export function sanitizeSvg(svg: string): string {
    return svg
        // Remove script elements
        .replace(/<script[\s\S]*?<\/script>/gi, '')
        // Remove on* event handlers (onclick, onload, onerror, etc.)
        .replace(/\s+on\w+\s*=\s*["'][^"']*["']/gi, '')
        .replace(/\s+on\w+\s*=\s*[^\s>]+/gi, '')
        // Remove javascript: URLs
        .replace(/href\s*=\s*["']javascript:[^"']*["']/gi, 'href="#"')
        .replace(/xlink:href\s*=\s*["']javascript:[^"']*["']/gi, 'xlink:href="#"');
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
        const ext = extname(fileName).toLowerCase().replace(".", "");
        if (ext && extToMime[ext] === mimeLc) return "";

        // as last resort try to get extension from mimeType
        const exts = mimeToExt[mime];
        return exts?.length ? `.${exts[0]}` : "";
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

export function randomSecureToken(bytes = 32) {
    return encodeBase64(getCrypto().randomBytes(bytes));
}

export function safeExtractMessageAndStackFromError(err: unknown): [errMessage: string, errStack: string | undefined] {
    if (err instanceof Error) {
        return [err.message, err.stack] as const;
    }

    if (typeof err === "string") {
        return [err, undefined] as const;
    }

    return ["Unknown Error", undefined] as const;
}

export function isEmptyOrWhitespace(str: string | null | undefined) {
    if (!str) return true;
    return str.match(/^ *$/) !== null;
}

export function escapeRegExp(str: string) {
    return str.replace(/([.*+?^=!:${}()|\[\]\/\\])/g, "\\$1");
}

export function removeFileExtension(filePath: string, mime?: string) {
    const extension = extname(filePath).toLowerCase();

    if (mime?.startsWith("video/") || mime?.startsWith("audio/")) {
        return filePath.substring(0, filePath.length - extension.length);
    }

    switch (extension) {
        case ".md":
        case ".mdx":
        case ".markdown":
        case ".html":
        case ".htm":
        case ".excalidraw":
        case ".mermaid":
        case ".mmd":
        case ".pdf":
            return filePath.substring(0, filePath.length - extension.length);
        default:
            return filePath;
    }
}

export function getNoteTitle(filePath: string, replaceUnderscoresWithSpaces: boolean, noteMeta?: NoteMeta) {
    const trimmedNoteMeta = noteMeta?.title?.trim();
    if (trimmedNoteMeta) return trimmedNoteMeta;

    const fileBasename = basename(removeFileExtension(filePath, noteMeta?.mime));
    return replaceUnderscoresWithSpaces ? fileBasename.replace(/_/g, " ").trim() : fileBasename;
}

// try to turn 'true' and 'false' strings from process.env variables into boolean values or undefined
export function envToBoolean(val: string | undefined) {
    if (val === undefined || typeof val !== "string") return undefined;

    const valLc = val.toLowerCase().trim();

    if (valLc === "true") return true;
    if (valLc === "false") return false;

    return undefined;
}

/**
 * Parses a string value to an integer. If the resulting number is NaN or undefined, the result is also undefined.
 *
 * @param val the value to parse.
 * @returns the parsed value.
 */
export function stringToInt(val: string | undefined) {
    if (!val) {
        return undefined;
    }

    const parsed = parseInt(val, 10);
    if (Number.isNaN(parsed)) {
        return undefined;
    }

    return parsed;
}


/**
 * Normalizes a path pattern for custom request handlers.
 * Ensures both trailing slash and non-trailing slash versions are handled.
 *
 * @param pattern The original pattern from customRequestHandler attribute
 * @returns An array of patterns to match both with and without trailing slash
 */
export function normalizeCustomHandlerPattern(pattern: string | null | undefined): (string | null | undefined)[] {
    if (!pattern || typeof pattern !== "string") {
        return [pattern];
    }

    pattern = pattern.trim();

    if (!pattern) {
        return [pattern];
    }

    // If pattern already ends with optional trailing slash, return as-is
    if (pattern.endsWith("/?$") || pattern.endsWith("/?)")) {
        return [pattern];
    }

    // If pattern ends with $, handle it specially
    if (pattern.endsWith("$")) {
        const basePattern = pattern.slice(0, -1);

        // If already ends with slash, create both versions
        if (basePattern.endsWith("/")) {
            const withoutSlash = `${basePattern.slice(0, -1)}$`;
            const withSlash = pattern;
            return [withoutSlash, withSlash];
        }
        // Add optional trailing slash
        const withSlash = `${basePattern}/?$`;
        return [withSlash];

    }

    // For patterns without $, add both versions
    if (pattern.endsWith("/")) {
        const withoutSlash = pattern.slice(0, -1);
        return [withoutSlash, pattern];
    }
    const withSlash = `${pattern}/`;
    return [pattern, withSlash];

}

export function formatUtcTime(time: string) {
    return time.replace("T", " ").substring(0, 19);
}

// TODO: Deduplicate with client utils
export function formatSize(size: number | null | undefined) {
    if (size === null || size === undefined) {
        return "";
    }

    size = Math.max(Math.round(size / 1024), 1);

    if (size < 1024) {
        return `${size} KiB`;
    }
    return `${Math.round(size / 102.4) / 10} MiB`;

}

export function slugify(text: string) {
    return text
        .normalize("NFC") // keep composed form, preserves accents
        .toLowerCase()
        .replace(/[^\p{Letter}\p{Number}]+/gu, "-") // replace non-letter/number with "-"
        .replace(/(^-|-$)+/g, ""); // trim dashes
}

export function stripTags(text: string) {
    return text.replace(/<(?:.|\n)*?>/gm, "");
}

export function toObject<T, K extends string | number | symbol, V>(array: T[], fn: (item: T) => [K, V]): Record<K, V> {
    const obj: Record<K, V> = {} as Record<K, V>; // TODO: unsafe?

    for (const item of array) {
        const ret = fn(item);

        obj[ret[0]] = ret[1];
    }

    return obj;
}

// TODO: Deduplicate with src/public/app/services/utils.ts
/**
 * Compares two semantic version strings.
 * Returns:
 *   1  if v1 is greater than v2
 *   0  if v1 is equal to v2
 *   -1 if v1 is less than v2
 *
 * @param v1 First version string
 * @param v2 Second version string
 * @returns
 */
export function compareVersions(v1: string, v2: string): number {
    // Remove 'v' prefix and everything after dash if present
    v1 = v1.replace(/^v/, "").split("-")[0];
    v2 = v2.replace(/^v/, "").split("-")[0];

    const v1parts = v1.split(".").map(Number);
    const v2parts = v2.split(".").map(Number);

    // Pad shorter version with zeros
    while (v1parts.length < 3) v1parts.push(0);
    while (v2parts.length < 3) v2parts.push(0);

    // Compare major version
    if (v1parts[0] !== v2parts[0]) {
        return v1parts[0] > v2parts[0] ? 1 : -1;
    }

    // Compare minor version
    if (v1parts[1] !== v2parts[1]) {
        return v1parts[1] > v2parts[1] ? 1 : -1;
    }

    // Compare patch version
    if (v1parts[2] !== v2parts[2]) {
        return v1parts[2] > v2parts[2] ? 1 : -1;
    }

    return 0;
}
