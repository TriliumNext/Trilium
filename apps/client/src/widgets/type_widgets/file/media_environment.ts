/**
 * Where a media player is being rendered. The note detail is `standalone`; a note included in a text note
 * or embedded in a canvas is `embedded`; a lightweight preview such as a collection tile or an attachment
 * list is `preview`.
 */
export type MediaEnvironment = "standalone" | "embedded" | "preview";

/**
 * Whether the player is mounted right away, or only once the user clicks the placeholder's play button.
 * A preview is lazy: many of them are on screen at once, and each media element that exists starts
 * streaming from the server, so none is created until the user actually asks for it.
 */
export function loadsEagerly(environment: MediaEnvironment): boolean {
    return environment !== "preview";
}

/** How much a mounted player may buffer ahead: only the note detail is worth pre-loading in full. */
export function preloadFor(environment: MediaEnvironment): "auto" | "metadata" {
    return environment === "standalone" ? "auto" : "metadata";
}

/**
 * Classes for a player's root element:
 * - `media-compact` styles the compact chrome, keeping {@link usesCompactControls} the one thing that decides
 *   who wears it (the markup and the stylesheet both follow from it).
 * - `no-link-navigation` is only for a preview, which sits inside a clickable host (a collection card is itself
 *   a link): without it, pressing play or seeking would also open the note. See services/link.ts.
 */
export function playerRootClasses(environment: MediaEnvironment): string {
    const classes = [ `media-env-${environment}` ];
    if (usesCompactControls(environment)) classes.push("media-compact");
    if (environment === "preview") classes.push("no-link-navigation");
    return classes.join(" ");
}

/**
 * Whether the player wears its compact chrome: only the note detail has room for the full control set, so
 * everywhere else keeps just what a small host needs — play, seek, volume — and drops the rest.
 */
export function usesCompactControls(environment: MediaEnvironment): boolean {
    return environment !== "standalone";
}

/**
 * Whether the player offers a way out to a bigger viewport (picture-in-picture, fullscreen). A preview is an
 * incidental tile in a list of many and stays put; an embedded player is a deliberate placement, where being
 * able to escape a small box is worth the two buttons.
 */
export function showsViewportControls(environment: MediaEnvironment): boolean {
    return environment !== "preview";
}

/**
 * Whether the player carries the Download / Open-externally actions at the end of its own controls. An embed
 * is tight on height, so it takes them into the controls row instead of letting the content renderer append
 * its `.file-footer` below — which is why the renderer consults this too, and drops the footer when it does.
 */
export function showsFileActions(environment: MediaEnvironment): boolean {
    return environment === "embedded";
}
