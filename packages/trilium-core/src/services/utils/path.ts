/**
 * Browser-safe path utilities that don't depend on Node's `path` module.
 * Handles both forward slashes and backslashes.
 */

/** Returns the extension of a file path (e.g. ".txt"), or "" if none. */
export function extname(filePath: string): string {
    const base = basename(filePath);
    const dotIdx = base.lastIndexOf(".");
    if (dotIdx <= 0) return "";
    return base.substring(dotIdx);
}

/** Returns the last component of a file path. */
export function basename(filePath: string): string {
    const lastSlash = Math.max(filePath.lastIndexOf("/"), filePath.lastIndexOf("\\"));
    return filePath.substring(lastSlash + 1);
}

/** Returns the directory part of a file path, or "." if there is none. */
export function dirname(filePath: string): string {
    const normalized = filePath.replace(/\\/g, "/");
    const lastSlash = normalized.lastIndexOf("/");
    if (lastSlash === -1) return ".";
    if (lastSlash === 0) return "/";
    return normalized.substring(0, lastSlash);
}
