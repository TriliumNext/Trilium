/**
 * Path, id and resource-resolution helpers shared by the Notion structure importer and the collection
 * (database-property) handling. Notion exports name a page `Title <id>.html` and keep its children in a
 * sibling `Title/` folder, so most of these turn those id-suffixed names into stable, matchable keys.
 */

import { HTMLElement } from "node-html-parser";

import { getNotionId, stripNotionId } from "./notion_id.js";

/** Whether a zip entry name denotes a directory (Notion archives may include explicit directory entries). */
export function isDirectory(path: string): boolean {
    return path.endsWith("/");
}

export function baseName(path: string): string {
    /* v8 ignore next -- String.split always yields at least one element (""), so pop() is never undefined and the `?? path` fallback is unreachable */
    return path.split("/").pop() ?? path;
}

export function removeExtension(name: string): string {
    return name.replace(/\.[^.]+$/, "");
}

function dirname(path: string): string {
    const lastSlash = path.lastIndexOf("/");
    return lastSlash >= 0 ? path.slice(0, lastSlash) : "";
}

/** Collapses `.`/`..` segments in a forward-slash zip path and drops empty segments. */
export function normalizePath(path: string): string {
    const parts: string[] = [];
    for (const segment of path.split("/")) {
        if (segment === "" || segment === ".") {
            continue;
        }
        if (segment === "..") {
            parts.pop();
        } else {
            parts.push(segment);
        }
    }
    return parts.join("/");
}

/** Folder depth of a page path — pages are created shallowest-first so parents precede their children. */
export function folderDepth(path: string): number {
    return path.split("/").length;
}

/** Strips the Notion id from each segment so a title-only folder (`Title`) and a page (`Title <id>`) match. */
function folderKey(folderPath: string): string {
    return folderPath.split("/").map((segment) => stripNotionId(segment)).join("/");
}

/**
 * The folder a page's children live in: its directory plus its own title (the file's id and extension
 * dropped). Keyed against {@link parentFolderKey} to attach children to their parent.
 */
export function ownedFolderKey(path: string): string {
    const title = stripNotionId(removeExtension(baseName(path)));
    const dir = dirname(path);
    return folderKey(dir ? `${dir}/${title}` : title);
}

/** A page's containing folder (its path's directory), normalized for matching against an owned folder. */
export function parentFolderKey(path: string): string {
    return folderKey(dirname(path));
}

/**
 * Resolves an `<img src>`/attachment href (zip-relative, percent-encoded) against the page's directory in
 * the zip, returning a normalized path that matches the keys collected while reading the archive.
 */
export function resolveResourcePath(pagePath: string, src: string): string {
    let decoded = src;
    try {
        decoded = decodeURIComponent(src);
    } catch {
        // Leave malformed percent-encoding as-is rather than throwing.
    }
    const lastSlash = pagePath.lastIndexOf("/");
    const baseDir = lastSlash >= 0 ? pagePath.slice(0, lastSlash) : "";
    return normalizePath(baseDir ? `${baseDir}/${decoded}` : decoded);
}

/** Extracts the target page's Notion id from an internal `.html` link href, or null if it isn't one. */
export function internalPageId(href: string | undefined): string | null {
    if (!href) {
        return null;
    }
    let decoded = href;
    try {
        decoded = decodeURIComponent(href);
    } catch {
        // Leave malformed percent-encoding as-is rather than throwing.
    }
    const path = decoded.split(/[?#]/)[0];
    if (!path.toLowerCase().endsWith(".html")) {
        return null;
    }
    // Match against the path only: a 32-hex sequence in a query/hash must not be mistaken for the page id.
    return getNotionId(path) ?? null;
}

/**
 * Returns the Notion id of `body`'s page-wrapper child. Only `body`'s direct children are considered: a
 * nested block whose id happens to match the 32-hex pattern must not be taken for the page id.
 */
export function firstChildNotionId(body: HTMLElement | null): string | undefined {
    if (!body) {
        return undefined;
    }
    for (const child of body.childNodes) {
        if (child instanceof HTMLElement) {
            const id = getNotionId(child.getAttribute("id") ?? "");
            if (id) {
                return id;
            }
        }
    }
    return undefined;
}
