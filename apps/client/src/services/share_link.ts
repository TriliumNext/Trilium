import { encodeBlockParameter } from "@triliumnext/commons/src/lib/block_reference.js";

import type FNote from "../entities/fnote.js";
import options from "./options.js";
import { isElectron, isMobileApp, isStandalone } from "./utils.js";

/** Where a shared note can be opened from, see `getShareScope()`. */
export type ShareScope = "public" | "local" | "preview" | "export-only";

/**
 * Builds the browser-openable URL for a shared note.
 *
 * Precedence: on the desktop, standalone and mobile apps a configured sync server wins, since
 * it is the instance others can reach. A server serves the shared page itself, so its page
 * origin wins there and `syncServerHost` (another instance, often on a private network) is
 * ignored. Without a sync server, the desktop renderer uses the server-injected loopback origin
 * (`glob.httpBaseUrl`) because it loads from `trilium-app://` (#10589); everywhere else the
 * link derives from the page origin.
 */
export function buildShareLink(shareId: string, syncServerHost: string | null | undefined): string {
    // A shareId is either a noteId or a free-form shareAlias, so it can hold spaces, quotes and
    // path separators. Encoding keeps it a single segment the /share/:shareId route decodes back.
    const encodedShareId = encodeURIComponent(shareId);

    if (syncServerHost && (isElectron() || window.glob.isStandalone || isMobileApp())) {
        return appendSharePath(syncServerHost, encodedShareId);
    }

    if (window.glob.httpBaseUrl) {
        return appendSharePath(window.glob.httpBaseUrl, encodedShareId);
    }

    return appendSharePath(location.href, encodedShareId);
}

/**
 * The URL of the shared page of `note`, or `null` when the note is not shared or its shared page
 * cannot be opened (`export-only` scope).
 */
export function getNoteShareLink(note: FNote): string | null {
    const syncServerHost = options.get("syncServerHost");
    const scope = getShareScope({
        isElectron: isElectron(),
        isStandalone: !!isStandalone,
        isMobileApp: isMobileApp(),
        syncServerHost
    });
    if (!note.isShared() || scope === "export-only") {
        return null;
    }

    return buildShareLink(getShareId(note), syncServerHost);
}

/** The link to the blocks `block`, a `block` link parameter, on the shared page `shareLink`. */
export function getSharedPageLink(shareLink: string, block: string) {
    return `${shareLink}?block=${encodeBlockParameter(block)}`;
}

/**
 * Where a shared note can be opened from. `local` is the desktop app without a sync server, which
 * serves the page on the loopback address. `preview` is the standalone build without a sync server,
 * which renders the page in its own service worker, so only this browser can open it. `export-only`
 * is the mobile app without a sync server: its link opens nowhere, so the static export is the only
 * way to publish the note. A server cannot tell whether it is reachable from outside, so it always
 * reports `public`.
 */
export function getShareScope({ isElectron, isStandalone, isMobileApp, syncServerHost }: {
    isElectron: boolean;
    isStandalone: boolean;
    isMobileApp: boolean;
    syncServerHost: string | null | undefined;
}): ShareScope {
    if (syncServerHost) {
        return "public";
    }

    if (isMobileApp) {
        return "export-only";
    }

    if (isStandalone) {
        return "preview";
    }

    return isElectron ? "local" : "public";
}

/** The id in the URL of the shared page of `note`: empty for the share root. */
export function getShareId(note: FNote) {
    if (note.hasOwnedLabel("shareRoot")) {
        return "";
    }

    return note.getOwnedLabelValue("shareAlias") || note.noteId;
}

// `new URL("/share/x", base)` cannot stand in here: the leading slash makes the path absolute
// and drops the base's own path, which an instance reverse-proxied under a subpath needs.
function appendSharePath(base: string, encodedShareId: string): string {
    const url = new URL(base);

    url.search = "";
    url.hash = "";
    url.pathname = `${url.pathname.replace(/\/+$/, "")}/share/${encodedShareId}`;

    return url.href;
}
