import "./zoom_viewer.css";

import OverlayControlGroup, {
    ZoomControls
} from "@triliumnext/client/src/widgets/react/OverlayControlGroup.js";
import {
    useZoomPanPinch, useZoomPanWheel
} from "@triliumnext/client/src/widgets/react/zoom_pan.js";
import type { ComponentChildren } from "preact";
import { useState } from "preact/hooks";
import { TransformComponent, TransformWrapper } from "react-zoom-pan-pinch";

interface ZoomViewerProps {
    /** What the viewer shows, as its accessible name. */
    label: string;
    children: ComponentChildren;
}

/**
 * Pans and zooms its `children` across the page, with the zoom steps, wheel handling and
 * `ZoomControls` of the app's diagram preview.
 */
export function ZoomViewer({ label, children }: ZoomViewerProps) {
    const zoom = useZoomPanPinch({ minScale: MIN_ZOOM, maxScale: MAX_ZOOM });
    const [ viewport, setViewport ] = useState<HTMLDivElement | null>(null);
    useZoomPanWheel(zoom.ref, viewport);

    return (
        <div className="zoom-viewer">
            <div
                ref={setViewport}
                className="zoom-viewer-viewport"
                tabIndex={0}
                role="group"
                aria-label={label}
            >
                <TransformWrapper
                    ref={zoom.ref}
                    minScale={MIN_ZOOM}
                    maxScale={MAX_ZOOM}
                    centerZoomedOut
                    wheel={zoom.wheel}
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
            <OverlayControlGroup className="zoom-viewer-controls" placement="bottom-end">
                <ZoomControls
                    percent={zoom.scale * 100}
                    canZoomIn={zoom.canZoomIn}
                    canZoomOut={zoom.canZoomOut}
                    onZoomIn={zoom.zoomIn}
                    onZoomOut={zoom.zoomOut}
                    onReset={zoom.reset}
                />
            </OverlayControlGroup>
        </div>
    );
}

/** The zoom bounds of the app's diagram preview, as a multiple of the content's fitted width. */
const MIN_ZOOM = 0.5;
const MAX_ZOOM = 10;
