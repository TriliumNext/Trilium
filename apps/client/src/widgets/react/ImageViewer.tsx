import "./ImageViewer.css";

import { useEffect, useRef, useState } from "preact/hooks";
import { TransformComponent, TransformWrapper } from "react-zoom-pan-pinch";

import { t } from "../../services/i18n";
import type { ShortcutHintDefinition } from "../../services/shortcut_hints";
import { isMobile } from "../../services/utils";
import ShortcutHintButton from "../shortcut_hints/shortcut_hint_button";
import ContentErrorMessage from "./ContentErrorMessage";
import { useContextualShortcutHints } from "./hooks";
import OverlayControlGroup, { ZoomControls } from "./OverlayControlGroup";
import { useZoomPanPinch, useZoomPanWheel } from "./zoom_pan";
import { useZoomPanKeyboard, ZOOM_PAN_HINTS, ZOOM_PAN_VIEWPORT_CLASS } from "./zoom_pan_keyboard";

interface ImageViewerProps {
    src: string;
    imgClassName?: string;
    /** Alt text for the image; callers should pass a descriptive value such as the note title. */
    alt?: string;
    minScale?: number;
    maxScale?: number;
    /** The shortcut hints to offer; defaults to zoom, pan and navigation between a folder's images. */
    shortcutHints?: ShortcutHintDefinition;
}

/** Beyond this multiple of the image's native resolution, switch to crisp (non-smoothed) rendering. */
const CRISP_NATIVE_SCALE = 4;
/** Reveal the image even if `decode()` never settles (it can stall for some images, e.g. SVGs). */
const REVEAL_FALLBACK_MS = 1000;

// The zoom and pan keys are shared; only this viewer navigates between a folder's images.
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
 * Interactive image viewer: the image is fit to the viewport on load, then the user can zoom
 * (wheel/pinch/buttons/keyboard) and pan (drag/keyboard). Double-clicking resets to the fitted view.
 */
export default function ImageViewer({
    src, imgClassName, alt = "", minScale = 0.5, maxScale = 50, shortcutHints = IMAGE_VIEWER_HINTS
}: ImageViewerProps) {
    const [ pannable, setPannable ] = useState(false);
    const [ panning, setPanning ] = useState(false);
    const [ largeZoom, setLargeZoom ] = useState(false);
    const [ zoomPercent, setZoomPercent ] = useState(0);
    const [ loaded, setLoaded ] = useState(false);
    const [ loadingError, setLoadingError ] = useState(false);
    const imgRef = useRef<HTMLImageElement>(null);
    const [ rootEl, setRootEl ] = useState<HTMLDivElement | null>(null);

    // Recompute the cursor/rendering flags and the displayed (native-relative) zoom percentage.
    // The setters bail out on identical values, so no manual change checks are needed.
    const updateZoomState = (scale: number) => {
        const { pannable: nextPannable, largeZoom: nextLargeZoom, nativeScale } = evaluateImageZoom(scale, imgRef.current);
        setPannable(nextPannable);
        setLargeZoom(nextLargeZoom);
        setZoomPercent(nativeScale * 100);
    };

    const zoom = useZoomPanPinch({ minScale, maxScale, onScaleChange: updateZoomState });

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
        const reveal = () => settle(() => {
            setLoaded(true);
            updateZoomState(zoom.ref.current?.instance?.state?.scale ?? 1);
        });
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

    useZoomPanKeyboard(zoom.ref, rootEl);
    useZoomPanWheel(zoom.ref, rootEl);
    useContextualShortcutHints(shortcutHints);

    const wrapperClass = [
        "image-viewer-viewport",
        pannable && "pannable",
        panning && "panning",
        largeZoom && "tn-image-large-zoom",
        loaded && "img-loaded",
        loadingError && "img-loading-error"
    ].filter(Boolean).join(" ");

    return (
        <div
            ref={setRootEl}
            tabIndex={0}
            role="group"
            aria-label={t("image_viewer.viewport")}
            className={`image-viewer-root ${ZOOM_PAN_VIEWPORT_CLASS}`}
        >
            <TransformWrapper
                ref={zoom.ref}
                minScale={minScale}
                maxScale={maxScale}
                centerOnInit
                centerZoomedOut
                wheel={zoom.wheel}
                autoAlignment={{ disabled: true }}
                doubleClick={{ mode: "reset" }}
                onTransform={zoom.onTransform}
                onPanningStart={() => setPanning(true)}
                onPanningStop={() => setPanning(false)}
            >
                <TransformComponent wrapperClass={wrapperClass} contentClass="image-viewer-content">
                    <img
                        ref={imgRef}
                        className={imgClassName}
                        src={src}
                        alt={alt}
                    />
                </TransformComponent>
            </TransformWrapper>

            {loadingError && (
                <ContentErrorMessage message={t("image_viewer.loading_error")} />
            )}

            {!isMobile() && loaded && (
                <ShortcutHintButton />
            )}

            {!isMobile() && loaded && (
                <OverlayControlGroup className="image-viewer-controls" placement="bottom-end">
                    <ZoomControls
                        percent={zoomPercent}
                        canZoomIn={zoom.canZoomIn}
                        canZoomOut={zoom.canZoomOut}
                        onZoomIn={zoom.zoomIn}
                        onZoomOut={zoom.zoomOut}
                        onReset={zoom.reset}
                    />
                </OverlayControlGroup>
            )}
        </div>
    );
}
