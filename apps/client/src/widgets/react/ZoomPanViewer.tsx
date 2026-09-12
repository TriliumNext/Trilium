import "./ZoomPanViewer.css";

import clsx from "clsx";
import type { ComponentChildren, Ref } from "preact";
import { useCallback, useEffect, useRef, useState } from "preact/hooks";
import { type ReactZoomPanPinchRef, TransformComponent, TransformWrapper } from "react-zoom-pan-pinch";

import { t } from "../../services/i18n";
import type { ShortcutHintDefinition } from "../../services/shortcut_hints";
import { isMobile } from "../../services/utils";
import ShortcutHintButton from "../shortcut_hints/shortcut_hint_button";
import { useContextualShortcutHints, useElementSize } from "./hooks";
import { useImageViewerKeyboard } from "./image_viewer_keyboard";
import OverlayControlGroup, { OverlayControlButton } from "./OverlayControlGroup";

export interface ZoomPanViewerProps {
    children: ComponentChildren;
    /**
     * How the content is sized against the viewport. `"css"` leaves that to the content itself (an
     * `<img>` capped at `max-width`/`max-height` 100%), so scale 1 is the fitted view. `"measure"`
     * lays the content out at its natural size and lets the viewer drive the fit scale, which both
     * shrinks a diagram larger than the viewport and grows a formula smaller than it.
     */
    fit?: "css" | "measure";
    minScale?: number;
    maxScale?: number;
    /** Readout numerator: on-screen size as a multiple of the content's own pixels. Identity by default. */
    nativeScale?: (scale: number) => number;
    /** Controls and hints render only when true. */
    ready?: boolean;
    viewportClassName?: string;
    contentClassName?: string;
    controlsClassName?: string;
    /** Contextual shortcut hints to register, usually {@link ZOOM_PAN_HINTS} or an extension of it. */
    hints?: ShortcutHintDefinition;
    onScaleChange?: (scale: number) => void;
    /** Exposes the zoom/pan instance so the parent can drive zoom in/out/reset. */
    apiRef?: Ref<ReactZoomPanPinchRef>;
}

/**
 * Interactive zoom/pan viewport: the content is fit to the viewport, then the user can zoom
 * (wheel/pinch/buttons/keyboard) and pan (drag/keyboard). Double-clicking returns to the fitted view.
 */
export default function ZoomPanViewer({
    children,
    fit = "css",
    minScale = 0.5,
    maxScale = 50,
    nativeScale,
    ready = true,
    viewportClassName,
    contentClassName,
    controlsClassName,
    hints,
    onScaleChange,
    apiRef
}: ZoomPanViewerProps) {
    const [ scale, setScale ] = useState<number | null>(null);
    const [ panning, setPanning ] = useState(false);
    const [ contentSize, setContentSize ] = useState<{ width: number; height: number } | null>(null);
    const rootRef = useRef<HTMLDivElement>(null);
    const zoomRef = useRef<ReactZoomPanPinchRef>(null);
    const viewportSize = useElementSize(rootRef);

    // Keep our own ref to drive keyboard control, while still forwarding to the caller's apiRef.
    const setZoomRef = useCallback((instance: ReactZoomPanPinchRef | null) => {
        zoomRef.current = instance;
        if (typeof apiRef === "function") apiRef(instance);
        else if (apiRef) (apiRef as { current: ReactZoomPanPinchRef | null }).current = instance;
    }, [ apiRef ]);

    // In measure mode the library's content box is `fit-content`, so the content lays out at its
    // natural size and its offset box measures it independent of the transform. The observer follows
    // content that resizes after mount, such as a diagram that renders asynchronously.
    useEffect(() => {
        if (fit !== "measure") return;

        const content = zoomRef.current?.instance?.contentComponent;
        if (!content) return;

        const measure = () => setContentSize({ width: content.offsetWidth, height: content.offsetHeight });
        measure();
        const observer = new ResizeObserver(measure);
        observer.observe(content);
        return () => observer.disconnect();
    }, [ fit ]);

    const fitted = fit === "css" || (hasSize(viewportSize) && hasSize(contentSize));
    const fitScale = fit === "measure" && hasSize(viewportSize) && hasSize(contentSize)
        ? computeFitScale(viewportSize, contentSize, minScale, maxScale)
        : 1;

    // `TransformWrapper` pushes prop changes into its instance and `resetTransform` re-derives the
    // view from the current `initialScale`, so this applies each new fit — and so does every other
    // reset path (the readout button, `/`, double-click).
    useEffect(() => {
        if (fit === "measure") zoomRef.current?.resetTransform(0);
    }, [ fit, fitScale ]);

    useImageViewerKeyboard(zoomRef, rootRef);

    const currentScale = scale ?? fitScale;
    const zoomPercent = Math.round((nativeScale ? nativeScale(currentScale) : currentScale) * 100);
    const showControls = ready && !isMobile();

    const wrapperClass = clsx(
        "zoom-pan-viewer-viewport",
        viewportClassName,
        currentScale > fitScale && "pannable",
        panning && "panning",
        !fitted && "fitting"
    );

    return (
        <div ref={rootRef} tabIndex={0} className="zoom-pan-viewer-root">
            <TransformWrapper
                ref={setZoomRef}
                initialScale={fitScale}
                // A diagram far larger than the viewport fits below the caller's floor, which
                // `createState` would otherwise clamp the fit scale away to. In css mode the content
                // fits itself at scale 1, so the floor stands as the caller set it.
                minScale={fit === "measure" ? Math.min(minScale, fitScale) : minScale}
                maxScale={maxScale}
                centerOnInit
                centerZoomedOut
                wheel={{ step: 0.0085 }}
                autoAlignment={{ disabled: true }}
                doubleClick={{ mode: "reset" }}
                onTransform={(_ref, { scale: nextScale }) => {
                    setScale(nextScale);
                    onScaleChange?.(nextScale);
                }}
                onPanningStart={() => setPanning(true)}
                onPanningStop={() => setPanning(false)}
            >
                <TransformComponent
                    wrapperClass={wrapperClass}
                    contentClass={clsx("zoom-pan-viewer-content", contentClassName)}
                >
                    {children}
                </TransformComponent>
            </TransformWrapper>

            {hints && <ZoomPanShortcutHints hints={hints} showButton={showControls} />}

            {showControls && (
                <OverlayControlGroup className={clsx("zoom-pan-viewer-controls", controlsClassName)} placement="bottom-end">
                    <OverlayControlButton
                        title={t("image_buttons.zoom_out")}
                        icon="bx-minus-circle"
                        onClick={() => zoomRef.current?.zoomOut(BUTTON_ZOOM_STEP)}
                    />
                    <OverlayControlButton
                        title={t("image_buttons.reset_zoom")}
                        text={`${zoomPercent}%`}
                        onClick={() => zoomRef.current?.resetTransform()}
                    />
                    <OverlayControlButton
                        title={t("image_buttons.zoom_in")}
                        icon="bx-plus-circle"
                        onClick={() => zoomRef.current?.zoomIn(BUTTON_ZOOM_STEP)}
                    />
                </OverlayControlGroup>
            )}
        </div>
    );
}

/** Scale step applied per zoom-in/out button click (react-zoom-pan-pinch's zoomIn/zoomOut step). */
const BUTTON_ZOOM_STEP = 0.5;

/** The zoom and pan keys the viewer claims, offered to whichever widget hosts it. */
export const ZOOM_PAN_HINTS: ShortcutHintDefinition = [
    {
        titleKey: "image_viewer.hints.zoom",
        hints: [
            { keys: ["Ctrl++", "E"], labelKey: "image_viewer.hints.zoom_in" },
            { keys: ["Ctrl+-", "Q"], labelKey: "image_viewer.hints.zoom_out" },
            { keys: ["/", "Numpad /"], labelKey: "image_viewer.hints.reset_zoom" }
        ]
    },
    {
        titleKey: "image_viewer.hints.pan",
        hints: [
            { keys: ["Up", "W"], labelKey: "image_viewer.hints.pan_up" },
            { keys: ["Down", "S"], labelKey: "image_viewer.hints.pan_down" },
            { keys: ["Left", "A"], labelKey: "image_viewer.hints.pan_left" },
            { keys: ["Right", "D"], labelKey: "image_viewer.hints.pan_right" },
            { keys: ["Shift"], labelKey: "image_viewer.hints.pan_fast" }
        ]
    }
];

/**
 * The scale at which `content` fits inside `viewport` along both axes, kept within the caller's
 * envelope. Content or viewport with no measured size falls back to 1, so the view stays usable
 * while either is still zero-sized.
 */
export function computeFitScale(
    viewport: { width: number; height: number },
    content: { width: number; height: number },
    minScale: number,
    maxScale: number
): number {
    if (viewport.width <= 0 || viewport.height <= 0 || content.width <= 0 || content.height <= 0) {
        return 1;
    }

    const scale = Math.min(viewport.width / content.width, viewport.height / content.height);
    return Math.min(Math.max(scale, minScale), maxScale);
}

/**
 * Whether a measured box has a size to fit against. Content that renders after mount — a diagram, a
 * formula — reports 0×0 first, which is not yet a measurement.
 */
function hasSize(box: { width: number; height: number } | null | undefined): box is { width: number; height: number } {
    return !!box && box.width > 0 && box.height > 0;
}

/**
 * Registers the hints on the host component and, once the viewer is ready, offers the button that
 * opens them. A component of its own so that a viewer given no hints registers no provider, which
 * would otherwise displace the host's own.
 */
function ZoomPanShortcutHints({ hints, showButton }: { hints: ShortcutHintDefinition; showButton: boolean }) {
    useContextualShortcutHints(hints);
    return showButton ? <ShortcutHintButton /> : null;
}
