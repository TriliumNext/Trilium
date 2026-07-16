import "yet-another-react-lightbox/styles.css";
import "yet-another-react-lightbox/plugins/thumbnails.css";
import "./MediaViewer.css";

import clsx from "clsx";
import type { Ref } from "preact";
import { useLayoutEffect, useMemo, useRef, useState } from "preact/hooks";
import Lightbox, { type SlideImage, type ZoomRef } from "yet-another-react-lightbox";
import Inline from "yet-another-react-lightbox/plugins/inline";
import Thumbnails from "yet-another-react-lightbox/plugins/thumbnails";
import Zoom from "yet-another-react-lightbox/plugins/zoom";

import type NoteContext from "../../../components/note_context";
import { t } from "../../../services/i18n";
import ContentErrorMessage from "../ContentErrorMessage";
import { type SiblingNavigationState, useSiblingKeyboard } from "../SiblingNavigator";
import type { MediaGallery } from "./gallery";
import { awaitImageReveal, type ImageReveal } from "./image_decode";
import MediaViewerToolbar from "./MediaViewerToolbar";
import {
    DEFAULT_ORIENTATION,
    flipOrientationHorizontal,
    isDefaultOrientation,
    type Orientation,
    type OrientedRender,
    renderOrientedImage,
    rotateOrientation
} from "./orientation";
import { useMediaViewerKeyboard } from "./viewer_keyboard";

/** Beyond this multiple of the image's native resolution, switch to crisp (non-smoothed) rendering. */
const CRISP_NATIVE_SCALE = 4;

// In addition to PageUp/PageDown, the media viewer navigates with Backspace (previous) and Space (next).
const MEDIA_PREVIOUS_KEYS = [ "Backspace" ];
const MEDIA_NEXT_KEYS = [ "Space" ];

// The Thumbnails plugin mounts only while fullscreen: even hidden, a mounted strip eagerly
// loads every gallery image (there is no thumbnail endpoint — the strip shows the full images).
const INLINE_PLUGINS = [ Inline, Zoom ];
const FULLSCREEN_PLUGINS = [ Inline, Thumbnails, Zoom ];
const INLINE_PROPS = { style: { width: "100%", height: "100%" } };

/**
 * Keyboard panning rides on the zoom anchor of `changeZoom` (there is no public pan API): a 0.1%
 * zoom jiggle whose anchor is sized to shift the offsets by exactly the requested amount. Each
 * pan gesture oscillates between two fixed levels so the zoom never drifts.
 */
const PAN_ZOOM_JIGGLE = 0.999;

/** The surface the toolbar/keyboard drive. All ratios are native-relative: 1 = actual pixel size. */
export interface MediaViewerApi {
    /** Zooms by a relative amount (+0.1 → 10% in). Pivot is viewer-relative. */
    zoomBy(delta: number, pivot?: { x: number; y: number }): void;
    zoomTo(nativeRatio: number): void;
    fitToWindow(): void;
    actualSize(): void;
    /** Restores the initial fit and clears rotation/flip. */
    reset(): void;
    rotate(degrees: number): void;
    flipHorizontal(): void;
    moveBy(offsetX: number, offsetY: number): void;
    toggleFullscreen(): void;
    isFullscreen(): boolean;
    isAtFit(): boolean;
    /** Native-relative zoom percentage of the current image (100 = actual size); 0 before the first view. */
    zoomPercent(): number;
}

interface MediaViewerProps {
    gallery: MediaGallery;
    /** Scopes the document-level navigation keys (PageUp/PageDown/…) to the active tab/pane. */
    noteContext?: NoteContext;
    /**
     * The hosting widget's visibility. Type widgets are hidden rather than unmounted on note/type
     * switches, so fullscreen must be abandoned the moment the widget stops being visible.
     */
    isVisible?: boolean;
    /** Shown as a toolbar action when provided (copy-reference needs the caller's DOM context). */
    onCopyReference?: () => void;
    /** Exposes the viewer surface so the caller can wire extra chrome around it. */
    apiRef?: Ref<MediaViewerApi | null>;
}

/**
 * Interactive image viewer over a {@link MediaGallery}, powered by yet-another-react-lightbox in
 * inline mode: the image fits the viewport on load, wheel/pinch zoom toward the cursor, drag pans,
 * swipe moves through the gallery. Fullscreen presentation reparents the root under `<body>`
 * (escaping pane stacking contexts) where the thumbnail strip becomes available. Rotate/flip are
 * bitmap transforms (see {@link renderOrientedImage}), so they need no engine support. All chrome
 * (toolbar/keyboard) is provided by the caller through {@link MediaViewerApi} — the lightbox's
 * built-in buttons and keyboard stay disabled.
 */
export default function MediaViewer({ gallery, noteContext, isVisible = true, onCopyReference, apiRef }: MediaViewerProps) {
    const [ fulled, setFulled ] = useState(false);
    const [ largeZoom, setLargeZoom ] = useState(false);
    const [ loaded, setLoaded ] = useState(false);
    const [ loadingError, setLoadingError ] = useState(false);
    const [ zoomPercent, setZoomPercent ] = useState(0);
    const [ oriented, setOriented ] = useState<{ itemId: string; render: OrientedRender } | null>(null);

    const rootRef = useRef<HTMLDivElement>(null);
    const zoomRef = useRef<ZoomRef | null>(null);
    const zoomPercentRef = useRef(0);
    const fulledRef = useRef(false);
    // A pan gesture oscillates between two fixed zoom levels; see moveBy in the api below.
    const panStateRef = useRef<{ base: number; from: number } | null>(null);
    const orientationRef = useRef<Orientation>(DEFAULT_ORIENTATION);
    const orientationItemIdRef = useRef<string | null>(null);
    const revealRef = useRef<ImageReveal | null>(null);
    // Where the root lives in the widget; set while it is temporarily reparented for fullscreen.
    const homeRef = useRef<{ parent: Node; nextSibling: Node | null } | null>(null);
    // Latest render's closures, readable from identity-stable callbacks/effects without re-binding.
    const galleryRef = useRef(gallery);
    galleryRef.current = gallery;
    const watchRevealRef = useRef<(image: HTMLImageElement) => void>(() => {});
    const refreshZoomStateRef = useRef<() => void>(() => {});
    const nativeFitScaleRef = useRef<() => number>(() => 0);
    const clearOrientationRef = useRef<() => void>(() => {});
    const applyOrientationRef = useRef<(next: Orientation) => void>(() => {});
    const handleViewRef = useRef<(index: number) => void>(() => {});

    // Fullscreen must escape the widget's ancestor stacking contexts (panes, sidebars would paint
    // above the fixed viewer), so the whole root moves under <body> and returns home on exit.
    // Preact keeps updating the subtree by element reference, so the move is transparent to it.
    const enterFullscreenPresentation = () => {
        const root = rootRef.current;
        if (!root || !root.parentNode || root.parentNode === document.body) return;
        homeRef.current = { parent: root.parentNode, nextSibling: root.nextSibling };
        document.body.appendChild(root);
    };
    const exitFullscreenPresentation = () => {
        const root = rootRef.current;
        const home = homeRef.current;
        homeRef.current = null;
        if (!root || !home) return;
        const anchor = home.nextSibling && home.nextSibling.parentNode === home.parent ? home.nextSibling : null;
        home.parent.insertBefore(root, anchor);
    };

    const currentSlideImage = () =>
        rootRef.current?.querySelector<HTMLImageElement>(".yarl__slide_current img.yarl__slide_image") ?? null;

    /**
     * The zoom readout is measured off the DOM rather than derived from the lightbox's fit-relative
     * zoom level: the rendered rect already includes the zoom transform, so
     * rect.width / naturalWidth is the native-relative ratio directly.
     */
    const refreshZoomState = () => {
        const image = currentSlideImage();
        if (!image || !image.naturalWidth) return;
        const width = image.getBoundingClientRect().width;
        if (!width) return;
        const nativeRatio = width / image.naturalWidth;
        zoomPercentRef.current = Math.round(nativeRatio * 100);
        setZoomPercent(zoomPercentRef.current);
        setLargeZoom(nativeRatio > CRISP_NATIVE_SCALE);
    };
    refreshZoomStateRef.current = refreshZoomState;

    /** Native-pixel ratio of the current image at fit (lightbox zoom 1); 0 while unknowable. */
    const nativeFitScale = () => {
        const image = currentSlideImage();
        const zoom = zoomRef.current?.zoom ?? 1;
        if (!image || !image.naturalWidth || zoom <= 0) return 0;
        const width = image.getBoundingClientRect().width;
        return width > 0 ? width / image.naturalWidth / zoom : 0;
    };
    nativeFitScaleRef.current = nativeFitScale;

    // Track the reveal of the currently-viewed image, preserving the decode quirks: SVG stalls,
    // Chrome-Android EncodingError tolerance.
    const watchReveal = (image: HTMLImageElement) => {
        revealRef.current?.cancel();
        setLoaded(false);
        setLoadingError(false);
        const reveal = awaitImageReveal(image);
        revealRef.current = reveal;
        void reveal.promise.then((result) => {
            if (result === "ok") {
                setLoaded(true);
                refreshZoomStateRef.current();
            } else {
                setLoadingError(true);
            }
        });
    };
    watchRevealRef.current = watchReveal;

    const clearOrientation = () => {
        orientationRef.current = DEFAULT_ORIENTATION;
        orientationItemIdRef.current = null;
        setOriented((previous) => {
            previous?.render.release();
            return null;
        });
    };
    clearOrientationRef.current = clearOrientation;

    /** Rotates/flips the current item by re-rendering its bitmap; stale renders are discarded. */
    const applyOrientation = (next: Orientation) => {
        const item = galleryRef.current.items[galleryRef.current.currentIndex];
        if (!item) return;
        orientationRef.current = next;
        orientationItemIdRef.current = item.id;
        if (isDefaultOrientation(next)) {
            clearOrientation();
            return;
        }
        void renderOrientedImage(item.src, next)
            .then((render) => {
                if (orientationRef.current !== next || orientationItemIdRef.current !== item.id) {
                    render.release();
                    return;
                }
                setOriented((previous) => {
                    previous?.render.release();
                    return { itemId: item.id, render };
                });
            })
            .catch(() => {
                // The bitmap could not be re-rendered (e.g. an undecodable SVG) — keep the current view.
            });
    };
    applyOrientationRef.current = applyOrientation;

    handleViewRef.current = (index: number) => {
        const currentGallery = galleryRef.current;
        // Lightbox-internal navigation (swipe, thumbnail click) propagates into app navigation;
        // the app's own navigation echoes back with a matching index and stops here.
        if (index >= 0 && index !== currentGallery.currentIndex) {
            currentGallery.navigateToIndex(index);
        }
        const item = currentGallery.items[index];
        if (orientationItemIdRef.current && orientationItemIdRef.current !== item?.id) {
            clearOrientation();
        }
        const image = currentSlideImage();
        if (image && image.complete) {
            watchReveal(image);
        } else {
            // The slide's <img> appears or finishes loading after this callback; the capture-phase
            // load listener below picks it up. Surface the loading state right away.
            revealRef.current?.cancel();
            setLoaded(false);
            setLoadingError(false);
        }
    };

    const lightboxCallbacks = useMemo(() => ({
        view: ({ index }: { index: number }) => handleViewRef.current(index),
        zoom: () => refreshZoomStateRef.current()
    }), []);

    // load/error don't bubble but do run ancestor capture listeners — this is how the wrapper
    // notices the current slide's <img> becoming displayable (initial mount, navigation, and the
    // oriented-bitmap swap all funnel through here).
    useLayoutEffect(() => {
        const root = rootRef.current;
        if (!root) return;
        const onMediaSettled = (event: Event) => {
            const target = event.target;
            if (target instanceof HTMLImageElement && target.closest(".yarl__slide_current")) {
                watchRevealRef.current(target);
            }
        };
        root.addEventListener("load", onMediaSettled, true);
        root.addEventListener("error", onMediaSettled, true);
        return () => {
            root.removeEventListener("load", onMediaSettled, true);
            root.removeEventListener("error", onMediaSettled, true);
        };
    }, []);

    // Surface change (other parent/role) remounts the keyed Lightbox below; reset everything that
    // must not leak across surfaces — most importantly a live fullscreen presentation.
    useLayoutEffect(() => () => {
        revealRef.current?.cancel();
        exitFullscreenPresentation();
        fulledRef.current = false;
        setFulled(false);
        clearOrientationRef.current();
        zoomPercentRef.current = 0;
        setZoomPercent(0);
        setLoaded(false);
        setLoadingError(false);
    }, [ gallery.surfaceKey ]);

    // Split-pane resizes change the fit size (the lightbox re-layouts itself); refresh the readout.
    useLayoutEffect(() => {
        const root = rootRef.current;
        if (!root || typeof ResizeObserver === "undefined") return;
        const observer = new ResizeObserver(() => refreshZoomStateRef.current());
        observer.observe(root);
        return () => observer.disconnect();
    }, []);

    // The api only touches refs and stable setters, so one instance serves the whole lifetime —
    // the toolbar, the keyboard hook and the caller's apiRef all share it.
    const api = useMemo<MediaViewerApi>(() => ({
        zoomBy: (delta, pivot) => {
            const zoom = zoomRef.current;
            if (!zoom) return;
            panStateRef.current = null;
            let anchorX: number | undefined;
            let anchorY: number | undefined;
            if (pivot && rootRef.current) {
                // The lightbox expects anchors relative to the container center.
                const rect = rootRef.current.getBoundingClientRect();
                anchorX = pivot.x - rect.width / 2;
                anchorY = pivot.y - rect.height / 2;
            }
            zoom.changeZoom(zoom.zoom * (1 + delta), true, anchorX, anchorY);
        },
        zoomTo: (nativeRatio) => {
            const zoom = zoomRef.current;
            const fitScale = nativeFitScaleRef.current();
            panStateRef.current = null;
            if (zoom && fitScale > 0) zoom.changeZoom(nativeRatio / fitScale, true);
        },
        fitToWindow: () => {
            panStateRef.current = null;
            zoomRef.current?.changeZoom(1, true);
        },
        actualSize: () => {
            const zoom = zoomRef.current;
            const fitScale = nativeFitScaleRef.current();
            panStateRef.current = null;
            if (zoom && fitScale > 0) zoom.changeZoom(1 / fitScale, true);
        },
        reset: () => {
            clearOrientationRef.current();
            panStateRef.current = null;
            zoomRef.current?.changeZoom(1, true);
        },
        rotate: (degrees) => applyOrientationRef.current(rotateOrientation(orientationRef.current, degrees)),
        flipHorizontal: () => applyOrientationRef.current(flipOrientationHorizontal(orientationRef.current)),
        moveBy: (offsetX, offsetY) => {
            const zoom = zoomRef.current;
            if (!zoom || zoom.zoom <= 1.001) {
                panStateRef.current = null;
                return;
            }
            // A pan is exactly one changeZoom call whose anchor carries the offsets (the anchor
            // delta is subtracted internally, hence the negated offsets). The zoom oscillates
            // between two FIXED levels — base and base×0.999 — rather than relative to the
            // possibly-stale ref value: if the renderer coalesces two pan frames, a relative
            // jiggle stops cancelling out and the zoom drifts, while fixed levels merely drop
            // that frame's pan.
            let pan = panStateRef.current;
            const externallyZoomed = pan
                && Math.abs(zoom.zoom / pan.base - 1) > 0.01
                && Math.abs(zoom.zoom / (pan.base * PAN_ZOOM_JIGGLE) - 1) > 0.01;
            if (!pan || externallyZoomed) {
                pan = { base: zoom.zoom, from: zoom.zoom };
                panStateRef.current = pan;
            }
            const target = pan.from === pan.base ? pan.base * PAN_ZOOM_JIGGLE : pan.base;
            const factor = 1 / pan.from - 1 / target;
            if (Math.abs(factor) < Number.EPSILON) return;
            zoom.changeZoom(target, true, -offsetX / factor, -offsetY / factor);
            pan.from = target;
        },
        toggleFullscreen: () => {
            if (fulledRef.current) {
                exitFullscreenPresentation();
                fulledRef.current = false;
                setFulled(false);
                return;
            }
            enterFullscreenPresentation();
            fulledRef.current = true;
            setFulled(true);
        },
        isFullscreen: () => fulledRef.current,
        isAtFit: () => Math.abs((zoomRef.current?.zoom ?? 1) - 1) < 0.001,
        zoomPercent: () => zoomPercentRef.current
    }), []);
    const internalApiRef = useRef<MediaViewerApi | null>(api);
    internalApiRef.current = api;

    useMediaViewerKeyboard(internalApiRef, rootRef, gallery);
    // Document-level gallery keys (PageUp/PageDown/Home/End + Backspace/Space), active-tab scoped.
    useSiblingKeyboard(toSiblingNavigation(gallery), noteContext, undefined, MEDIA_PREVIOUS_KEYS, MEDIA_NEXT_KEYS);

    // Type widgets are hidden, not unmounted — never leave a fullscreen overlay behind.
    useLayoutEffect(() => {
        if (!isVisible && fulledRef.current) {
            api.toggleFullscreen();
        }
    }, [ isVisible, api ]);

    useLayoutEffect(() => {
        if (!apiRef) return;
        assignRef(apiRef, api);
        return () => assignRef(apiRef, null);
    }, [ apiRef, api ]);

    const slides = useMemo<SlideImage[]>(() => gallery.items.map((item) => {
        if (oriented && oriented.itemId === item.id) {
            return {
                src: oriented.render.url,
                alt: item.title,
                width: oriented.render.width,
                height: oriented.render.height
            };
        }
        return { src: item.src, alt: item.title };
    }), [ gallery.items, oriented ]);

    const rootClass = clsx("media-viewer-root", {
        "media-viewer-fulled": fulled,
        "tn-image-large-zoom": largeZoom,
        "img-loaded": loaded,
        "img-loading-error": loadingError
    });

    return (
        <div ref={rootRef} tabIndex={0} className={rootClass}>
            <Lightbox
                key={gallery.surfaceKey}
                plugins={fulled && gallery.items.length > 1 ? FULLSCREEN_PLUGINS : INLINE_PLUGINS}
                slides={slides}
                index={Math.max(gallery.currentIndex, 0)}
                on={lightboxCallbacks}
                inline={INLINE_PROPS}
                carousel={{ finite: gallery.items.length < 2, preload: 1, padding: 0, imageFit: "contain" }}
                // No morph animation when switching or zooming photos — navigation should feel instant.
                animation={{ fade: 0, swipe: 0, zoom: 0 }}
                zoom={{
                    ref: zoomRef,
                    scrollToZoom: true,
                    maxZoomPixelRatio: 64,
                    // ~1.25× per wheel notch — snappier than the library default.
                    wheelZoomDistanceFactor: 400
                }}
                thumbnails={{ position: "bottom", showToggle: false }}
                // All chrome is ours: no toolbar buttons, no prev/next arrows, and the built-in
                // focus grab would steal focus from the keyboard-scoped root.
                toolbar={{ buttons: [] }}
                render={{ buttonPrev: () => null, buttonNext: () => null, buttonZoom: () => null }}
                controller={{ focus: false, closeOnBackdropClick: false }}
            />

            {loadingError && <ContentErrorMessage message={t("media_viewer.loading_error")} />}

            {loaded && !loadingError && (
                <MediaViewerToolbar
                    api={api}
                    gallery={gallery}
                    zoomPercent={zoomPercent}
                    fullscreen={fulled}
                    onCopyReference={onCopyReference}
                />
            )}
        </div>
    );
}

/** Adapts the gallery to the sibling-keyboard contract; null (keys inactive) when there is nothing to cycle. */
export function toSiblingNavigation(gallery: MediaGallery): SiblingNavigationState | null {
    const { items, currentIndex } = gallery;
    const total = items.length;
    if (currentIndex < 0 || total < 2) return null;
    const previous = items[(currentIndex - 1 + total) % total];
    const next = items[(currentIndex + 1) % total];
    return {
        index: currentIndex + 1,
        total,
        previousId: previous.id,
        nextId: next.id,
        previousTitle: previous.title,
        nextTitle: next.title,
        navigatePrevious: gallery.navigatePrevious,
        navigateNext: gallery.navigateNext,
        navigateFirst: gallery.navigateFirst,
        navigateLast: gallery.navigateLast
    };
}

function assignRef<T>(ref: Ref<T | null>, value: T | null) {
    if (typeof ref === "function") ref(value);
    else if (ref) ref.current = value;
}
