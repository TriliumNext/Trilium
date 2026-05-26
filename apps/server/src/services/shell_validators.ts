import fs from "fs";
import path from "path";
import url from "url";

import { SHELL_OPEN_EXTERNAL_PROTOCOLS } from "@triliumnext/commons";

/**
 * Input validators for every IPC channel under window.electronApi.shell.
 *
 * Each validator throws on any invariant violation so a hostile or buggy
 * caller surfaces loudly in the main-process log rather than silently
 * triggering an OS-level action. The handlers in window.ts delegate to these
 * functions before invoking the underlying electron.shell / WebContents APIs.
 */

//#region Shared helpers

/** Windows filesystems are case-insensitive, POSIX are case-sensitive. */
function normalizeForCompare(p: string): string {
    return process.platform === "win32" ? p.toLowerCase() : p;
}

/** True if `resolved` is a strict descendant of `root` (not `root` itself). */
function isStrictlyUnder(resolved: string, root: string): boolean {
    const prefix = path.resolve(root) + path.sep;
    return normalizeForCompare(resolved).startsWith(normalizeForCompare(prefix));
}

/** True if `resolved` equals `root` or is a descendant. */
function isUnderOrEquals(resolved: string, root: string): boolean {
    return normalizeForCompare(resolved) === normalizeForCompare(path.resolve(root))
        || isStrictlyUnder(resolved, root);
}

//#endregion

//#region open-custom — sandbox to Trilium's tmp dir + existence check

/**
 * Validates a path for the "open-custom" IPC channel (renderer asks the main
 * process to invoke Windows' "Open With…" dialog or the Linux mimeopen flow).
 * The legit caller always passes a path freshly written by saveToTmpDir, so
 * the path must live under that dir and the file must exist on disk.
 */
export function validateOpenCustomPath(filePath: unknown, tmpDir: string): string {
    if (typeof filePath !== "string" || filePath.length === 0 || filePath.includes("\0")) {
        throw new Error("open-custom: invalid filePath");
    }

    const resolved = path.resolve(filePath);
    if (!isStrictlyUnder(resolved, tmpDir)) {
        throw new Error(`open-custom: refusing path outside tmpdir: ${resolved}`);
    }

    if (!fs.existsSync(resolved)) {
        throw new Error(`open-custom: file does not exist: ${resolved}`);
    }

    return resolved;
}

//#endregion

//#region open-path — sandbox to Trilium's data dir ∪ tmp dir + existence check

/**
 * Validates a path for the "open-path" IPC channel (Open Note Externally,
 * Open Attachment Externally, and the "open data directory" link in the
 * About dialog). The legit callers only ever pass server-generated paths
 * either inside the tmp dir or equal to the data dir itself.
 *
 * UNC paths are blocked implicitly — they cannot normalise to a descendant
 * of the data/tmp dirs, so the sandbox check rejects them. This closes the
 * NTLM-hash-leak vector that affects file:// and smb:// URLs.
 */
export function validateOpenPath(input: unknown, dataDir: string, tmpDir: string): string {
    if (typeof input !== "string" || input.length === 0 || input.includes("\0")) {
        throw new Error("open-path: invalid filePath");
    }

    const resolved = path.resolve(input);
    if (!isUnderOrEquals(resolved, dataDir) && !isUnderOrEquals(resolved, tmpDir)) {
        throw new Error(`open-path: refusing path outside data dir: ${resolved}`);
    }

    if (!fs.existsSync(resolved)) {
        throw new Error(`open-path: file does not exist: ${resolved}`);
    }

    return resolved;
}

//#endregion

//#region open-external — scheme allowlist

/**
 * Validates a URL for the "open-external" IPC channel (electron.shell.openExternal,
 * which hands the URL to the OS protocol handler). Historically this is a
 * Follina-class RCE primitive on Windows (ms-msdt:, search-ms:, ms-officecmd:)
 * and a credential-leak primitive (smb:, ldap:). Allowlisting the scheme is
 * the only reliable defence — see SHELL_OPEN_EXTERNAL_PROTOCOLS in commons.
 */
export function validateOpenExternalUrl(input: unknown): URL {
    if (typeof input !== "string" || input.length === 0) {
        throw new Error("open-external: invalid URL");
    }

    let parsed: URL;
    try {
        parsed = new URL(input);
    } catch {
        throw new Error(`open-external: not a valid URL: ${input}`);
    }

    // URL.protocol returns "http:" — strip the trailing colon for comparison.
    const scheme = parsed.protocol.replace(/:$/, "").toLowerCase();
    if (!SHELL_OPEN_EXTERNAL_PROTOCOLS.includes(scheme)) {
        throw new Error(`open-external: blocked scheme '${scheme}'`);
    }

    return parsed;
}

//#endregion

//#region open-file-url — block UNC paths

/**
 * Validates a URL for the "open-file-url" IPC channel and returns the
 * resolved filesystem path. The specific threat blocked here is UNC paths:
 * a file: URL with a non-empty hostname (file://attacker.example/share/x)
 * resolves on Windows to \\attacker.example\share\x, which triggers SMB
 * authentication and leaks the user's NTLM hash to the attacker.
 */
export function validateOpenFileUrl(input: unknown): string {
    if (typeof input !== "string" || input.length === 0) {
        throw new Error("open-file-url: invalid URL");
    }

    // Some sources produce malformed file URLs that look like file://C:/path
    // (drive letter parsed as the host). Insert the missing slash so the URL
    // parser sees file:///C:/path with an empty host.
    const normalized = input.replace(/^file:\/\/(?=[a-zA-Z]:)/i, "file:///");

    let parsed: URL;
    try {
        parsed = new URL(normalized);
    } catch {
        throw new Error(`open-file-url: not a valid URL: ${input}`);
    }

    if (parsed.protocol !== "file:") {
        throw new Error(`open-file-url: not a file: URL: ${input}`);
    }

    if (parsed.hostname !== "") {
        throw new Error(`open-file-url: UNC path blocked: ${parsed.hostname}`);
    }

    return url.fileURLToPath(parsed);
}

//#endregion

//#region download-url — same-origin lock

/**
 * Validates a URL for the "download-url" IPC channel (WebContents.downloadURL,
 * which writes the response straight to the user's Downloads folder).
 * Locking it to the renderer's own origin closes the cross-origin abuse path
 * (a compromised renderer pre-positioning a malicious file disguised as a
 * legitimate download) while preserving the legitimate same-origin
 * attachment / revision / export downloads.
 */
export function validateDownloadUrl(input: unknown, allowedOrigin: string): URL {
    if (typeof input !== "string" || input.length === 0) {
        throw new Error("download-url: invalid URL");
    }

    let parsed: URL;
    try {
        parsed = new URL(input);
    } catch {
        throw new Error(`download-url: not a valid URL: ${input}`);
    }

    let allowed: URL;
    try {
        allowed = new URL(allowedOrigin);
    } catch {
        throw new Error(`download-url: invalid allowed origin: ${allowedOrigin}`);
    }

    // We can't use URL.origin for the comparison because Electron serves the
    // renderer via a custom protocol (trilium-app://app/) which the WHATWG URL
    // spec treats as opaque-origin (.origin === "null"). Two opaque-origin URLs
    // would always string-compare as equal even across different schemes/hosts.
    //
    // Instead, require both sides to have a non-empty hostname (rules out
    // data:, file:///, about:, blob:) and compare scheme + hostname + port
    // component-by-component.
    if (allowed.hostname === "" || parsed.hostname === "") {
        throw new Error("download-url: hostless URL not allowed");
    }

    const sameOrigin = parsed.protocol === allowed.protocol
        && parsed.hostname === allowed.hostname
        && parsed.port === allowed.port;
    if (!sameOrigin) {
        throw new Error(
            `download-url: cross-origin download blocked: ${parsed.protocol}//${parsed.host} (allowed: ${allowed.protocol}//${allowed.host})`
        );
    }

    return parsed;
}

//#endregion
