import { binary_utils,getCrypto, utils as coreUtils } from "@triliumnext/core";
import crypto from "crypto";
import { release as osRelease } from "os";
import path from "path";

const osVersion = osRelease().split('.').map(Number);

export const isMac = process.platform === "darwin";

export const isWindows = process.platform === "win32";

export const isWindows11 = isWindows && osVersion[0] === 10 && osVersion[2] >= 22000;

export const isElectron = !!process.versions["electron"];

/** @deprecated Use `isDev()` from `@triliumnext/core` instead. */
export const isDev = !!(process.env.TRILIUM_ENV && process.env.TRILIUM_ENV === "dev");

/** @deprecated */
export function newEntityId() {
    return coreUtils.newEntityId();
}

/** @deprecated */
export function randomString(length: number): string {
    return coreUtils.randomString(length);
}

/** @deprecated */
export function hashedBlobId(content: string | Buffer) {
    return coreUtils.hashedBlobId(content);
}

export function toBase64(plainText: string | Buffer) {
    const buffer = (Buffer.isBuffer(plainText) ? plainText : Buffer.from(plainText));
    return buffer.toString("base64");
}

export function fromBase64(encodedText: string) {
    return Buffer.from(encodedText, "base64");
}

export function hmac(secret: string | Uint8Array, value: string | Uint8Array) {
    return getCrypto().hmac(secret, value);
}

/**
 * Constant-time string comparison to prevent timing attacks.
 * Uses crypto.timingSafeEqual to ensure comparison time is independent
 * of how many characters match.
 *
 * @param a First string to compare
 * @param b Second string to compare
 * @returns true if strings are equal, false otherwise
 * @note Returns false for null/undefined/non-string inputs. Empty strings are considered equal.
 */
export function constantTimeCompare(a: string | null | undefined, b: string | null | undefined): boolean {
    // Handle null/undefined/non-string cases safely
    if (typeof a !== "string" || typeof b !== "string") {
        return false;
    }

    const bufA = Buffer.from(a, "utf-8");
    const bufB = Buffer.from(b, "utf-8");

    // If lengths differ, we still do a constant-time comparison
    // to avoid leaking length information through timing
    if (bufA.length !== bufB.length) {
        // Compare bufA against itself to maintain constant time behavior
        crypto.timingSafeEqual(bufA, bufA);
        return false;
    }

    return crypto.timingSafeEqual(bufA, bufB);
}

/** @deprecated */
export function getContentDisposition(filename: string) {
    return coreUtils.getContentDisposition(filename);
}

/** @deprecated */
export function isStringNote(type: string | undefined, mime: string) {
    return coreUtils.isStringNote(type, mime);
}

/** @deprecated */
export function quoteRegex(url: string) {
    return coreUtils.quoteRegex(url);
}

/** @deprecated */
export function replaceAll(string: string, replaceWhat: string, replaceWith: string) {
    return coreUtils.replaceAll(string, replaceWhat, replaceWith);
}

/** @deprecated */
export function formatDownloadTitle(fileName: string, type: string | null, mime: string) {
    return coreUtils.formatDownloadTitle(fileName, type, mime);
}

/** @deprecated */
export function removeDiacritic(str: string) {
    return coreUtils.removeDiacritic(str);
}

/** @deprecated */
export function normalize(str: string) {
    return coreUtils.normalize(str);
}

/** @deprecated */
export function toMap<T extends Record<string, any>>(list: T[], key: keyof T) {
    return coreUtils.toMap(list, key);
}

/**
 * Returns the directory for resources. On Electron builds this corresponds to the `resources` subdirectory inside the distributable package.
 * On development builds, this simply refers to the src directory of the application.
 *
 * @returns the resource dir.
 */
export function getResourceDir() {
    if (process.env.TRILIUM_RESOURCE_DIR) {
        return process.env.TRILIUM_RESOURCE_DIR;
    }

    if (isElectron && !isDev) return __dirname;
    if (!isDev) {
        return path.dirname(process.argv[1]);
    }

    return path.join(__dirname, "..");
}

/** @deprecated */
export const escapeHtml = coreUtils.escapeHtml;
/** @deprecated */
export const escapeRegExp = coreUtils.escapeRegExp;
/** @deprecated */
export const unescapeHtml = coreUtils.unescapeHtml;
/** @deprecated */
export const randomSecureToken = coreUtils.randomSecureToken;
/** @deprecated */
export const safeExtractMessageAndStackFromError = coreUtils.safeExtractMessageAndStackFromError;
/** @deprecated */
export const isEmptyOrWhitespace = coreUtils.isEmptyOrWhitespace;
/** @deprecated */
export const normalizeUrl = coreUtils.normalizeUrl;
export const timeLimit = coreUtils.timeLimit;
export const sanitizeSqlIdentifier = coreUtils.sanitizeSqlIdentifier;
export const processStringOrBuffer = binary_utils.processStringOrBuffer;

export function waitForStreamToFinish(stream: any): Promise<void> {
    return new Promise((resolve, reject) => {
        stream.on("finish", () => resolve());
        stream.on("error", (err) => reject(err));
    });
}

export default {
    constantTimeCompare,
    escapeHtml,
    escapeRegExp,
    formatDownloadTitle,
    fromBase64,
    getContentDisposition,
    getResourceDir,
    hashedBlobId,
    hmac,
    isDev,
    isElectron,
    isEmptyOrWhitespace,
    isMac,
    isStringNote,
    isWindows,
    newEntityId,
    normalize,
    quoteRegex,
    randomSecureToken,
    randomString,
    removeDiacritic,
    replaceAll,
    safeExtractMessageAndStackFromError,
    toBase64,
    toMap,
    unescapeHtml,
    waitForStreamToFinish
};
