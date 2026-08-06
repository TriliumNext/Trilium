import {
    classifyFaviconContrast,
    type FaviconContrast,
    faviconContrastClass,
    measureFaviconVisibility,
    safeLinkPreviewImageSrc
} from "@triliumnext/commons";
import { useEffect, useState } from "preact/hooks";

/**
 * The measured verdict for each favicon we have looked at, so a note that links one site twenty
 * times measures it once. Keyed by the picture rather than by the site, since that is what was
 * measured — the same attachment URL always yields the same answer.
 *
 * Never invalidated: the answer is a property of the icon's own pixels and does not change when the
 * user switches theme. Acting on it does, which is why the verdict is handed to the stylesheets as a
 * class rather than being resolved into a filter here.
 */
const measured = new Map<string, FaviconContrast>();

/** Measurements still in flight, so several previews of one site share a single decode. */
const pending = new Map<string, Promise<FaviconContrast>>();

/**
 * The class a favicon should carry for the theme to be able to correct it, or undefined while the
 * measurement is still running and for an icon that needs no correction.
 *
 * Renders uncorrected first and corrects on the next frame. That is the right way round: an icon
 * briefly shown as its author drew it is what every other app shows permanently, whereas guessing
 * before measuring would mean occasionally inverting an icon that turns out to be fine.
 */
export function useFaviconContrastClass(src: string | undefined | null): string | undefined {
    const safeSrc = safeLinkPreviewImageSrc(src);
    const [contrast, setContrast] = useState<FaviconContrast>(() => (safeSrc && measured.get(safeSrc)) || "neutral");

    useEffect(() => {
        if (!safeSrc) {
            setContrast("neutral");
            return;
        }

        const known = measured.get(safeSrc);
        if (known) {
            setContrast(known);
            return;
        }

        let stillMounted = true;
        void faviconContrast(safeSrc).then((result) => {
            if (stillMounted) {
                setContrast(result);
            }
        });

        return () => {
            stillMounted = false;
        };
    }, [safeSrc]);

    return faviconContrastClass(contrast);
}

/** Measures an icon, or answers from the cache. Never rejects: an unreadable icon is simply left alone. */
function faviconContrast(src: string): Promise<FaviconContrast> {
    const cached = measured.get(src);
    if (cached) {
        return Promise.resolve(cached);
    }

    const inFlight = pending.get(src);
    if (inFlight) {
        return inFlight;
    }

    const measurement = loadAndMeasure(src).then((contrast) => {
        measured.set(src, contrast);
        pending.delete(src);
        return contrast;
    });

    pending.set(src, measurement);

    return measurement;
}

/**
 * Loads the icon a second time, into an image of our own, and measures that.
 *
 * Deliberately not the `<img>` the preview renders: this way the measurement owes nothing to when
 * that element mounts, whether it has already fired `load`, or whether it is on screen at all, and
 * the same answer serves every preview of the site at once. The second load is free — the browser
 * has the picture in its cache, this being the very URL it just drew.
 */
function loadAndMeasure(src: string): Promise<FaviconContrast> {
    return new Promise((resolve) => {
        const image = new Image();

        image.addEventListener("load", () => {
            const visibility = measureFaviconVisibility(image);
            resolve(visibility ? classifyFaviconContrast(visibility) : "neutral");
        }, { once: true });

        // An icon that will not load is one the preview is already showing its placeholder for.
        image.addEventListener("error", () => resolve("neutral"), { once: true });

        image.src = src;
    });
}
