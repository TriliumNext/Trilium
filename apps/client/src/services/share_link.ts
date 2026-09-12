/**
 * Builds the browser-openable URL for a shared note.
 *
 * Precedence: an explicitly configured sync server wins; otherwise the desktop
 * renderer uses the server-injected loopback origin (`glob.httpBaseUrl`) because it
 * loads from `trilium-app://`, where location-based derivation would yield an unusable
 * `trilium-app://app/share/...` link (#10589); everywhere else we derive from the page
 * origin (which is correct for the server build and for a browser hitting the desktop).
 */
export function buildShareLink(shareId: string, syncServerHost: string | null | undefined): string {
    // A shareId is either a noteId or a free-form shareAlias, so it can hold spaces, quotes and
    // path separators. Encoding keeps it a single segment the /share/:shareId route decodes back.
    const encodedShareId = encodeURIComponent(shareId);

    if (syncServerHost) {
        return new URL(`/share/${encodedShareId}`, syncServerHost).href;
    }

    if (window.glob.httpBaseUrl) {
        return new URL(`/share/${encodedShareId}`, window.glob.httpBaseUrl).href;
    }

    return `${location.protocol}//${location.host}${location.pathname}share/${encodedShareId}`;
}
