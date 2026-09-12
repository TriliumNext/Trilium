import "./ImageViewer.css";

import clsx from "clsx";
import { Ref } from "preact";
import { useEffect, useRef, useState } from "preact/hooks";
import type { ReactZoomPanPinchRef } from "react-zoom-pan-pinch";

import { t } from "../../services/i18n";
import type { ShortcutHintDefinition } from "../../services/shortcut_hints";
import ContentErrorMessage from "./ContentErrorMessage";
import ZoomPanViewer, { ZOOM_PAN_HINTS } from "./ZoomPanViewer";

interface ImageViewerProps {
    src: string;
    imgClassName?: string;
    /** Alt text for the image; callers should pass a descriptive value such as the note title. */
    alt?: string;
    minScale?: number;
    maxScale?: number;
    /** Exposes the zoom/pan instance so the parent can drive zoom in/out/reset. */
    apiRef?: Ref<ReactZoomPanPinchRef>;
}

/** Beyond this multiple of the image's native resolution, switch to crisp (non-smoothed) rendering. */
const CRISP_NATIVE_SCALE = 4;
/** Reveal the image even if `decode()` never settles (it can stall for some images, e.g. SVGs). */
const REVEAL_FALLBACK_MS = 1000;

const IMAGE_VIEWER_HINTS: ShortcutHintDefinition = [
    ...ZOOM_PAN_HINTS,
    {
        titleKey: "image_viewer.hints.navigation",
        hints: [
            { keys: ["Space", "PageDown"], labelKey: "image_viewer.hints.next_image" },
            { keys: ["Backspace", "PageUp"], labelKey: "image_viewer.hints.previous_image" },
            { keys: ["Home"], labelKey: "image_viewer.hints.first_image" },
            { keys: ["End"], labelKey: "image_viewer.hints.last_image" }
        ]
    }
];

/**
 * Derives the zoom-driven values: whether the image is pannable (zoomed past the fitted size),
 * whether it's enlarged beyond {@link CRISP_NATIVE_SCALE}× its native resolution, and `nativeScale` —
 * the on-screen size as a multiple of the image's real pixels (`clientWidth * scale / naturalWidth`,
 * where `clientWidth` is the un-transformed fitted width).
 */
export function evaluateImageZoom(scale: number, img: { naturalWidth: number; clientWidth: number } | null) {
    const nativeScale = img && img.naturalWidth > 0 ? (img.clientWidth * scale) / img.naturalWidth : 0;
    return { pannable: scale > 1, largeZoom: nativeScale > CRISP_NATIVE_SCALE, nativeScale };
}

/**
 * Interactive image viewer: the image is fit to the viewport by CSS, then a {@link ZoomPanViewer}
 * carries the zoom and pan. The image reveals itself once it has decoded, and tints the viewport on
 * a failed load.
 */
export default function ImageViewer({ src, imgClassName, alt = "", minScale = 0.5, maxScale = 50, apiRef }: ImageViewerProps) {
    const [ largeZoom, setLargeZoom ] = useState(false);
    const [ loaded, setLoaded ] = useState(false);
    const [ loadingError, setLoadingError ] = useState(false);
    const imgRef = useRef<HTMLImageElement>(null);

    // Reveal (or fail) the image, driven by decode() rather than the load event. decode() resolves once
    // the bitmap is ready whether or not we observed `load`, so a fast/cached image that finishes before
    // the handler is wired can't stay hidden forever (a race the load event has). Large images therefore
    // fade in on real pixels; the timer guarantees we always reveal even if decode() never settles (it
    // can, e.g. for some SVGs).
    useEffect(() => {
        setLoaded(false);
        setLoadingError(false);

        const img = imgRef.current;
        if (!img) return;

        let settled = false;
        const settle = (action: () => void) => {
            if (settled) return;
            settled = true;
            clearTimeout(timer);
            action();
        };
        const reveal = () => settle(() => setLoaded(true));
        const timer = setTimeout(reveal, REVEAL_FALLBACK_MS);
        if (typeof img.decode === "function") {
            img.decode().then(reveal, () => {
                // decode() can reject for an image that still paints fine — notably large images on
                // memory-constrained Chrome (Android), which throw EncodingError despite loading OK.
                // Only fail when the image truly didn't load; otherwise reveal without the smooth fade.
                if (img.complete && img.naturalWidth > 0) reveal();
                else settle(() => setLoadingError(true));
            });
        } else {
            // No decode() (ancient/unusual runtimes, some headless test envs): reveal without the fade.
            reveal();
        }

        return () => settle(() => {});
    }, [ src ]);

    return (
        <div className="image-viewer-root">
            <ZoomPanViewer
                apiRef={apiRef}
                minScale={minScale}
                maxScale={maxScale}
                ready={loaded}
                hints={IMAGE_VIEWER_HINTS}
                viewportClassName={clsx(
                    "image-viewer-viewport",
                    largeZoom && "tn-image-large-zoom",
                    loaded && "img-loaded",
                    loadingError && "img-loading-error"
                )}
                contentClassName="image-viewer-content"
                controlsClassName="image-viewer-controls"
                nativeScale={(scale) => evaluateImageZoom(scale, imgRef.current).nativeScale}
                onScaleChange={(scale) => setLargeZoom(evaluateImageZoom(scale, imgRef.current).largeZoom)}
            >
                <img
                    ref={imgRef}
                    className={imgClassName}
                    src={src}
                    alt={alt}
                />
            </ZoomPanViewer>

            {loadingError && (
                <ContentErrorMessage message={t("image_viewer.loading_error")} />
            )}
        </div>
    );
}
