/** Reveal the image even if `decode()` never settles (it can stall for some images, e.g. SVGs). */
const REVEAL_FALLBACK_MS = 1000;

export interface ImageReveal {
    /** Settles "ok" when the image is displayable, "error" when it truly failed. Never settles after {@link cancel}. */
    promise: Promise<"ok" | "error">;
    /** Stops the timer and prevents any later settling (call when the image is unmounted/replaced). */
    cancel(): void;
}

/**
 * Waits until the image is displayable, driven by `decode()` rather than the load event. decode()
 * resolves once the bitmap is ready whether or not we observed `load`, so a fast/cached image that
 * finishes before the handler is wired can't stay hidden forever (a race the load event has). Large
 * images therefore fade in on real pixels; the timer guarantees we always settle even if decode()
 * never does (it can stall, e.g. for some SVGs).
 */
export function awaitImageReveal(img: HTMLImageElement, fallbackMs = REVEAL_FALLBACK_MS): ImageReveal {
    let settled = false;
    let resolveReveal: (result: "ok" | "error") => void = () => {};
    const promise = new Promise<"ok" | "error">((resolve) => { resolveReveal = resolve; });

    const settle = (result: "ok" | "error" | null) => {
        if (settled) return;
        settled = true;
        clearTimeout(timer);
        if (result) resolveReveal(result);
    };
    const timer = setTimeout(() => settle("ok"), fallbackMs);

    if (typeof img.decode === "function") {
        img.decode().then(() => settle("ok"), () => {
            // decode() can reject for an image that still paints fine — notably large images on
            // memory-constrained Chrome (Android), which throw EncodingError despite loading OK.
            // Only fail when the image truly didn't load; otherwise settle without the smooth fade.
            if (img.complete && img.naturalWidth > 0) settle("ok");
            else settle("error");
        });
    } else {
        // No decode() (ancient/unusual runtimes, some headless test envs): settle without the fade.
        settle("ok");
    }

    return { promise, cancel: () => settle(null) };
}
