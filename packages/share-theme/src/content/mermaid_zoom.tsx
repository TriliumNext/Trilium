import "./mermaid_zoom.css";

import {
    useZoomPanPinch, useZoomPanWheel
} from "@triliumnext/client/src/widgets/react/zoom_pan.js";
import { render } from "preact";
import { useLayoutEffect, useRef, useState } from "preact/hooks";
import { TransformComponent, TransformWrapper } from "react-zoom-pan-pinch";

/** The texts of a viewer, which the page carries on the Mermaid note it shows. */
export interface ZoomPanLabels {
    label: string;
    zoomIn: string;
    zoomOut: string;
    zoomReset: string;
}

/**
 * Moves `diagram` into a viewer that pans and zooms it, with the zoom steps and wheel handling of
 * the app's diagram preview. The wheel zooms only while the viewer has focus, and dragging pans
 * only once the diagram is zoomed in, so that both scroll the page otherwise.
 */
export default function mountZoomPan(diagram: HTMLElement, labels: ZoomPanLabels) {
    const container = document.createElement("div");
    container.className = "mermaid-zoom";
    diagram.replaceWith(container);
    render(<ZoomPanViewer diagram={diagram} labels={labels} />, container);
}

function ZoomPanViewer({ diagram, labels }: { diagram: HTMLElement; labels: ZoomPanLabels }) {
    const zoom = useZoomPanPinch({ minScale: MIN_ZOOM, maxScale: MAX_ZOOM });
    const [ viewport, setViewport ] = useState<HTMLDivElement | null>(null);
    const contentRef = useRef<HTMLDivElement>(null);
    useZoomPanWheel(zoom.ref, viewport, true);

    // The diagram stays the element `mermaid.ts` draws into, so a theme change redraws it in place.
    useLayoutEffect(() => {
        contentRef.current?.append(diagram);
    }, [ diagram ]);

    return (
        <>
            <div
                ref={setViewport}
                className="mermaid-zoom-viewport"
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
                    panning={{ disabled: zoom.scale <= 1 }}
                    doubleClick={{ mode: "reset" }}
                    onTransform={zoom.onTransform}
                >
                    <TransformComponent
                        wrapperClass="mermaid-zoom-wrapper"
                        contentClass="mermaid-zoom-content"
                    >
                        <div ref={contentRef} />
                    </TransformComponent>
                </TransformWrapper>
            </div>
            <div className="mermaid-zoom-controls">
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
                    className="mermaid-zoom-reset"
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
        </>
    );
}

/** The zoom bounds of the app's diagram preview, as a multiple of the diagram's fitted width. */
const MIN_ZOOM = 0.5;
const MAX_ZOOM = 10;
