import "viewerjs/dist/viewer.css";
import "./MediaViewer.css";

import clsx from "clsx";
import type { Ref } from "preact";
import { useLayoutEffect, useMemo, useRef, useState } from "preact/hooks";
import Viewer from "viewerjs";

import type NoteContext from "../../../components/note_context";
import { t } from "../../../services/i18n";
import ContentErrorMessage from "../ContentErrorMessage";
import { type SiblingNavigationState, useSiblingKeyboard } from "../SiblingNavigator";
import type { MediaGallery } from "./gallery";
import { awaitImageReveal, type ImageReveal } from "./image_decode";
import MediaViewerToolbar from "./MediaViewerToolbar";
import { useMediaViewerKeyboard } from "./viewer_keyboard";

/** Beyond this multiple of the image's native resolution, switch to crisp (non-smoothed) rendering. */
const CRISP_NATIVE_SCALE = 4;

// In addition to PageUp/PageDown, the media viewer navigates with Backspace (previous) and Space (next).
const MEDIA_PREVIOUS_KEYS = [ "Backspace" ];
const MEDIA_NEXT_KEYS = [ "Space" ];

/** The surface the toolbar/keyboard drive. All ratios are native-relative: 1 = actual pixel size. */
export interface MediaViewerApi {
    /** Zooms by a relative amount (Viewer.js semantics: +0.1 → 10% in). Pivot is viewer-relative. */
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

/** The Viewer.js internals the wrapper relies on beyond the published typings. */
type ViewerInternals = Viewer & {
    fulled?: boolean;
    index?: number;
    image?: HTMLImageElement;
    imageData?: { ratio?: number; scaleX?: number };
    initialImageData?: { ratio?: number };
    navbar?: HTMLElement;
    options: { navbar: boolean | number };
    /** Present at runtime; missing from the published typings. */
    resize(): void;
};

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
 * Interactive image viewer over a {@link MediaGallery}, powered by Viewer.js in inline mode: the image
 * fits the viewport on load, wheel/pinch zoom toward the cursor, drag pans, double-click toggles fit ↔
 * actual size, swipe moves through the gallery. Fullscreen presentation is the same instance flipped
 * via `full()`/`exit()`, where the thumbnail navbar becomes available (its images are only loaded on
 * the first fullscreen entry). All chrome (toolbar/keyboard/title) is provided by the caller through
 * {@link MediaViewerApi} — the Viewer.js built-ins stay disabled.
 */
export default function MediaViewer({ gallery, noteContext, isVisible = true, onCopyReference, apiRef }: MediaViewerProps) {
    const [ fulled, setFulled ] = useState(false);
    const [ largeZoom, setLargeZoom ] = useState(false);
    const [ loaded, setLoaded ] = useState(false);
    const [ loadingError, setLoadingError ] = useState(false);
    const [ zoomPercent, setZoomPercent ] = useState(0);
    const rootRef = useRef<HTMLDivElement>(null);
    const sourcesRef = useRef<HTMLDivElement>(null);
    const viewerRef = useRef<ViewerInternals | null>(null);
    const readyRef = useRef(false);
    const zoomPercentRef = useRef(0);
    const lastViewedIndexRef = useRef(-1);
    const itemsKeyRef = useRef<string | null>(null);
    const revealRef = useRef<ImageReveal | null>(null);
    // Where the root lives in the widget; set while it is temporarily reparented for fullscreen.
    const homeRef = useRef<{ parent: Node; nextSibling: Node | null } | null>(null);
    // Read the freshest gallery from inside Viewer.js event handlers without re-binding them.
    const galleryRef = useRef(gallery);
    galleryRef.current = gallery;

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

    // Track the reveal of the currently-viewed image (Viewer.js clones the source <img> into its
    // canvas), preserving the decode quirks: SVG stalls, Chrome-Android EncodingError tolerance.
    const watchReveal = (img: HTMLImageElement | undefined) => {
        revealRef.current?.cancel();
        if (!img) return;
        setLoaded(false);
        setLoadingError(false);
        const reveal = awaitImageReveal(img);
        revealRef.current = reveal;
        void reveal.promise.then((result) => {
            if (result === "ok") setLoaded(true);
            else setLoadingError(true);
        });
    };

    // Viewer.js dispatches CustomEvents on the source element; the listeners live for the component's
    // lifetime and read state through refs, so they never need re-binding.
    useLayoutEffect(() => {
        const sources = sourcesRef.current;
        if (!sources) return;

        const onReady = () => {
            readyRef.current = true;
            const currentIndex = galleryRef.current.currentIndex;
            if (currentIndex >= 0 && currentIndex !== lastViewedIndexRef.current) {
                lastViewedIndexRef.current = currentIndex;
                viewerRef.current?.view(currentIndex);
            }
        };
        const onViewed = (event: Event) => {
            const index = (event as CustomEvent<{ index?: number }>).detail?.index ?? -1;
            lastViewedIndexRef.current = index;
            // Swipe/thumbnail navigation happens inside Viewer.js first; propagate it into app
            // navigation. The app's own navigation echoes back with a matching index and stops here.
            if (index >= 0 && index !== galleryRef.current.currentIndex) {
                galleryRef.current.navigateToIndex(index);
            }
            const initialRatio = viewerRef.current?.imageData?.ratio;
            if (typeof initialRatio === "number") {
                zoomPercentRef.current = Math.round(initialRatio * 100);
                setZoomPercent(zoomPercentRef.current);
            }
            watchReveal(viewerRef.current?.image);
        };
        const onZoomed = (event: Event) => {
            const ratio = (event as CustomEvent<{ ratio?: number }>).detail?.ratio ?? 0;
            zoomPercentRef.current = Math.round(ratio * 100);
            setZoomPercent(zoomPercentRef.current);
            setLargeZoom(ratio > CRISP_NATIVE_SCALE);
        };

        sources.addEventListener("ready", onReady);
        sources.addEventListener("viewed", onViewed);
        sources.addEventListener("zoomed", onZoomed);
        return () => {
            sources.removeEventListener("ready", onReady);
            sources.removeEventListener("viewed", onViewed);
            sources.removeEventListener("zoomed", onZoomed);
        };
    }, []);

    // One Viewer.js instance per gallery surface; a different surface (other parent/role) rebuilds it.
    useLayoutEffect(() => {
        const sources = sourcesRef.current;
        if (!sources) return;

        readyRef.current = false;
        const initialIndex = Math.max(galleryRef.current.currentIndex, 0);
        lastViewedIndexRef.current = initialIndex;
        itemsKeyRef.current = itemsKey(galleryRef.current);
        const viewer = new Viewer(sources, {
            inline: true,
            backdrop: true,
            button: false,
            // Our own toolbar lives outside the Viewer element; the focus enforcer would steal
            // focus back from it, and all keyboard handling is focus-scoped in the caller.
            focus: false,
            keyboard: false,
            // Enabled on the first fullscreen entry — Viewer.js loads every thumbnail (at full
            // resolution; there is no thumbnail endpoint) the moment the navbar list is built.
            navbar: false,
            title: false,
            toolbar: false,
            tooltip: false,
            loading: true,
            loop: true,
            slideOnTouch: true,
            toggleOnDblclick: true,
            // No morph animation when switching photos — navigation should feel instant.
            transition: false,
            zoomOnTouch: true,
            zoomOnWheel: true,
            zoomRatio: 0.25,
            minZoomRatio: 0.02,
            maxZoomRatio: 64,
            initialCoverage: 1,
            initialViewIndex: initialIndex,
            url: "data-src",
            zIndexInline: 1,
            zIndex: 1500
        }) as ViewerInternals;
        viewerRef.current = viewer;

        return () => {
            revealRef.current?.cancel();
            // A surface change while fullscreen must not leave the stale presentation behind:
            // the new Viewer instance starts un-fulled, so the state resets alongside it.
            exitFullscreenPresentation();
            setFulled(false);
            viewerRef.current = null;
            viewer.destroy();
        };
    }, [ gallery.surfaceKey ]);

    // Same surface, different members/content (revision upload, added/removed sibling): let Viewer.js
    // reconcile against the re-rendered hidden source list.
    const currentItemsKey = itemsKey(gallery);
    useLayoutEffect(() => {
        if (itemsKeyRef.current !== null && itemsKeyRef.current !== currentItemsKey) {
            viewerRef.current?.update();
        }
        itemsKeyRef.current = currentItemsKey;
    }, [ currentItemsKey ]);

    // App navigation flows down as a new currentIndex; mirror it into the viewer exactly once.
    useLayoutEffect(() => {
        if (!readyRef.current || gallery.currentIndex < 0) return;
        if (gallery.currentIndex === lastViewedIndexRef.current) return;
        lastViewedIndexRef.current = gallery.currentIndex;
        viewerRef.current?.view(gallery.currentIndex);
    }, [ gallery.currentIndex ]);

    // Split-pane resizes don't fire window resize; Viewer.js only listens for the latter.
    useLayoutEffect(() => {
        const root = rootRef.current;
        if (!root || typeof ResizeObserver === "undefined") return;
        const observer = new ResizeObserver(() => {
            if (readyRef.current) viewerRef.current?.resize();
        });
        observer.observe(root);
        return () => observer.disconnect();
    }, []);

    // The api only touches refs and stable setters, so one instance serves the whole lifetime —
    // the toolbar, the keyboard hook and the caller's apiRef all share it.
    const api = useMemo<MediaViewerApi>(() => ({
        zoomBy: (delta, pivot) => viewerRef.current?.zoom(delta, false, pivot),
        zoomTo: (nativeRatio) => viewerRef.current?.zoomTo(nativeRatio),
        fitToWindow: () => {
            const fitRatio = viewerRef.current?.initialImageData?.ratio;
            if (typeof fitRatio === "number") viewerRef.current?.zoomTo(fitRatio);
        },
        actualSize: () => viewerRef.current?.zoomTo(1),
        reset: () => viewerRef.current?.reset(),
        rotate: (degrees) => viewerRef.current?.rotate(degrees),
        flipHorizontal: () => viewerRef.current?.scaleX(-(viewerRef.current?.imageData?.scaleX ?? 1)),
        moveBy: (offsetX, offsetY) => viewerRef.current?.move(offsetX, offsetY),
        toggleFullscreen: () => {
            const viewer = viewerRef.current;
            if (!viewer) return;
            if (viewer.fulled) {
                exitFullscreenPresentation();
                viewer.exit();
                setFulled(false);
                return;
            }
            // The navbar (thumbnail strip) is a fullscreen-only feature; enabling it lazily defers
            // loading every gallery image until the user actually asks for thumbnails.
            if (galleryRef.current.items.length > 1 && !viewer.options.navbar) {
                viewer.options.navbar = true;
                viewer.navbar?.classList.remove("viewer-hide");
                viewer.update();
            }
            enterFullscreenPresentation();
            viewer.full();
            setFulled(true);
        },
        isFullscreen: () => !!viewerRef.current?.fulled,
        isAtFit: () => {
            const current = viewerRef.current?.imageData?.ratio;
            const fit = viewerRef.current?.initialImageData?.ratio;
            return typeof current === "number" && typeof fit === "number" && Math.abs(current - fit) < 0.001;
        },
        zoomPercent: () => zoomPercentRef.current
    }), []);
    const internalApiRef = useRef<MediaViewerApi | null>(api);
    internalApiRef.current = api;

    useMediaViewerKeyboard(internalApiRef, rootRef, gallery);
    // Document-level gallery keys (PageUp/PageDown/Home/End + Backspace/Space), active-tab scoped.
    useSiblingKeyboard(toSiblingNavigation(gallery), noteContext, undefined, MEDIA_PREVIOUS_KEYS, MEDIA_NEXT_KEYS);

    // Type widgets are hidden, not unmounted — never leave a fullscreen overlay behind.
    useLayoutEffect(() => {
        if (!isVisible && viewerRef.current?.fulled) {
            api.toggleFullscreen();
        }
    }, [ isVisible, api ]);

    useLayoutEffect(() => {
        if (!apiRef) return;
        assignRef(apiRef, api);
        return () => assignRef(apiRef, null);
    }, [ apiRef, api ]);

    const rootClass = clsx("media-viewer-root", {
        "media-viewer-fulled": fulled,
        "tn-image-large-zoom": largeZoom,
        "img-loaded": loaded,
        "img-loading-error": loadingError
    });

    return (
        <div ref={rootRef} tabIndex={0} className={rootClass}>
            <div ref={sourcesRef} className="media-viewer-sources" aria-hidden="true">
                {gallery.items.map((item) => (
                    <div key={item.id} className="media-viewer-source">
                        <img data-src={item.src} alt={item.title} />
                    </div>
                ))}
            </div>

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

/** Identity of the gallery contents: members, order and content versions (the src embeds `?v=`). */
function itemsKey(gallery: MediaGallery): string {
    return gallery.items.map((item) => `${item.id}@${item.src}`).join("\n");
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
