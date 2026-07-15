/**
 * Stops audio/video still playing inside a container that is about to be hidden
 * but kept mounted (e.g. the note-type widget cache in `NoteDetail`, which only
 * toggles a `hidden-ext` class instead of unmounting). A `display:none` element
 * keeps its media playing, so switching a read-only note with a playing video to
 * editable mode would otherwise leave the video running in the background.
 *
 * - HTML5 `<video>` / `<audio>` are paused directly.
 * - Cross-origin embeds (YouTube, Vimeo, …) expose no pause API to the host page,
 *   so the iframe is reloaded by reassigning its `src`. This tears down the
 *   player and stops the audio, and the reloaded iframe simply shows its
 *   thumbnail again when the container is shown later.
 *
 * Scoped to the known video-embed containers — Trilium's Link Preview
 * (`.link-embed-video`) and `figure.media` — so unrelated iframes (PDFs,
 * web-view notes, included notes) are left untouched and don't lose their state.
 */
export function stopBackgroundMedia(container: HTMLElement | null | undefined) {
    if (!container) return;

    for (const el of container.querySelectorAll<HTMLMediaElement>("video, audio")) {
        el.pause();
    }

    for (const iframe of container.querySelectorAll<HTMLIFrameElement>("figure.media iframe, .link-embed-video iframe")) {
        const src = iframe.src;
        if (src) {
            // Reassigning src (even to the same value) reloads the frame.
            iframe.src = withoutAutoplay(src);
        }
    }
}

/**
 * Strips `autoplay=1` from an embed URL. The link-preview player carries it — the user's click on
 * the click-to-play facade *is* the play command — but reloading a hidden iframe with autoplay still
 * set would start the video playing again in the background, which is the very thing being
 * prevented here.
 */
function withoutAutoplay(src: string): string {
    if (!src.includes("autoplay=1")) return src;

    try {
        const url = new URL(src);
        url.searchParams.delete("autoplay");
        return url.toString();
    } catch {
        /* v8 ignore next -- an iframe's resolved `src` is always a valid absolute URL */
        return src;
    }
}
