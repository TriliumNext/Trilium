import { isHttpUrl } from "@triliumnext/commons";

/**
 * A url-typed label value as the address it may be followed to, or `null` where it is not one we may
 * follow at all.
 *
 * A label's value is free text that can have arrived from an import or a sync peer, so a hostile
 * scheme (`javascript:`, `data:`) is rejected rather than opened. A value carrying no scheme gets the
 * `https://` an address bar would give it, rather than being followed as a path relative to Trilium
 * itself.
 */
export function normalizeExternalUrl(value: unknown): string | null {
    if (typeof value !== "string" || !value.trim()) return null;

    const trimmed = value.trim();
    const withScheme = /^[a-z][a-z0-9+.-]*:/i.test(trimmed) ? trimmed : `https://${trimmed}`;
    return isHttpUrl(withScheme) ? withScheme : null;
}

/**
 * The `href` to link a url-typed label value as. A value we may not follow is rendered inert rather
 * than left out, so that what a note holds stays readable — as the share view and the markdown export
 * already do with a hostile scheme. See {@link normalizeExternalUrl}.
 */
export function safeUrlHref(value: unknown): string {
    if (typeof value !== "string" || !value.trim()) return "";

    return normalizeExternalUrl(value) ?? "about:blank";
}
