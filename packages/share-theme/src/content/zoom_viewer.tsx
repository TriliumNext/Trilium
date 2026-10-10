import "./zoom_viewer.css";

import {
    useZoomPanPinch, useZoomPanWheel
} from "@triliumnext/client/src/widgets/react/zoom_pan.js";
import { type ComponentChildren, render } from "preact";
import { useLayoutEffect, useRef, useState } from "preact/hooks";
import { TransformComponent, TransformWrapper } from "react-zoom-pan-pinch";

/** The texts of a viewer, which the page or the app's catalogue gives in the visitor's language. */
export interface ZoomPanLabels {
    label: string;
    zoomIn: string;
    zoomOut: string;
    zoomReset: string;
}

/**
 * Moves `element` into a viewer that pans and zooms it, in the flow of the page. The element
 * stays the same node, so a script that draws into it, such as `mermaid.ts`, keeps drawing there.
 */
export default function mountZoomPan(element: HTMLElement, labels: ZoomPanLabels) {
    const host = document.createElement("div");
    element.replaceWith(host);
    render(<ZoomViewer labels={labels}><ElementSlot element={element} /></ZoomViewer>, host);
}

interface ZoomViewerProps {
    labels: ZoomPanLabels;
    /**
     * Whether the viewer takes the page, so that the wheel and dragging always zoom and pan it, as
     * there is no page around it to scroll.
     */
    fillsPage?: boolean;
    children: ComponentChildren;
}

/**
 * Pans and zooms its `children`, with the zoom steps and wheel handling of the app's diagram
 * preview. In the flow of a page, the wheel zooms only while the viewer has focus and dragging pans
 * only once the content is zoomed in, so that both scroll the page otherwise.
 */
export function ZoomViewer({ labels, fillsPage = false, children }: ZoomViewerProps) {
    const zoom = useZoomPanPinch({ minScale: MIN_ZOOM, maxScale: MAX_ZOOM });
    const [ viewport, setViewport ] = useState<HTMLDivElement | null>(null);
    useZoomPanWheel(zoom.ref, viewport, !fillsPage);

    return (
        <div className={fillsPage ? "zoom-viewer fills-page" : "zoom-viewer"}>
            <div
                ref={setViewport}
                className="zoom-viewer-viewport"
                tabIndex={0}
                role="group"
                aria-label={labels.label}
            >
                <TransformWrapper
                    ref={zoom.ref}
                    minScale={MIN_ZOOM}
                    maxScale={MAX_ZOOM}
                    centerZoomedOut
                    wheel={zoom.wheel}
                    panning={{ disabled: !fillsPage && zoom.scale <= 1 }}
                    doubleClick={{ mode: "reset" }}
                    onTransform={zoom.onTransform}
                >
                    <TransformComponent
                        wrapperClass="zoom-viewer-wrapper"
                        contentClass="zoom-viewer-content"
                    >
                        {children}
                    </TransformComponent>
                </TransformWrapper>
            </div>
            <div className="zoom-viewer-controls">
                <button
                    type="button"
                    title={labels.zoomOut}
                    aria-label={labels.zoomOut}
                    disabled={!zoom.canZoomOut}
                    onClick={zoom.zoomOut}
                >
                    <span className="tn-icon bx bx-minus-circle" aria-hidden="true" />
                </button>
                <button
                    type="button"
                    className="zoom-viewer-reset"
                    title={labels.zoomReset}
                    onClick={zoom.reset}
                >
                    {`${Math.round(zoom.scale * 100)}%`}
                </button>
                <button
                    type="button"
                    title={labels.zoomIn}
                    aria-label={labels.zoomIn}
                    disabled={!zoom.canZoomIn}
                    onClick={zoom.zoomIn}
                >
                    <span className="tn-icon bx bx-plus-circle" aria-hidden="true" />
                </button>
            </div>
        </div>
    );
}

/** Holds an element that something other than Preact renders. */
function ElementSlot({ element }: { element: HTMLElement }) {
    const ref = useRef<HTMLDivElement>(null);
    useLayoutEffect(() => {
        ref.current?.append(element);
    }, [ element ]);
    return <div ref={ref} />;
}

/** The zoom bounds of the app's diagram preview, as a multiple of the content's fitted width. */
const MIN_ZOOM = 0.5;
const MAX_ZOOM = 10;
