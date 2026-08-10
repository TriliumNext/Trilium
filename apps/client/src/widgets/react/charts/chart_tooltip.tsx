import "./chart_tooltip.css";

import clsx from "clsx";
import { useRef, useState } from "preact/hooks";

interface ChartTooltipState {
    text: string;
    /** Viewport coordinates: the bubble is positioned fixed, so it escapes any clipping ancestor. */
    x: number;
    y: number;
    /** Past the middle of the viewport the bubble sits before the cursor rather than running off. */
    flipX: boolean;
    flipY: boolean;
}

/**
 * The tooltip a chart shows for the mark under the cursor: the app's own tooltip look, following
 * the pointer.
 *
 * Charts can't use the anchored tooltips the rest of the UI uses. A donut segment is a dashed
 * circle whose element extent is the whole ring, so an anchored bubble would float far from the arc
 * it describes; a treemap can hold hundreds of cells, and giving each one its own tooltip instance
 * would be wasteful. One pointer-positioned bubble per chart solves both.
 */
export function useChartTooltip<T extends HTMLElement>() {
    const containerRef = useRef<T>(null);
    const [ tooltip, setTooltip ] = useState<ChartTooltipState | null>(null);

    const positionOf = (event: { clientX: number, clientY: number }) => ({
        x: event.clientX,
        y: event.clientY,
        flipX: event.clientX > window.innerWidth / 2,
        flipY: event.clientY > window.innerHeight / 2
    });

    return {
        containerRef,
        /** Spread on the chart's own element, so the bubble tracks the pointer and leaves with it. */
        containerProps: {
            onMouseMove: (event: { clientX: number, clientY: number }) =>
                setTooltip((current) => current && { ...current, ...positionOf(event) }),
            onMouseLeave: () => setTooltip(null)
        },
        /** Called by a mark on hover; a mark without tooltip text shows nothing. */
        showTooltip: (text: string | undefined, event: { clientX: number, clientY: number }) =>
            setTooltip(text ? { text, ...positionOf(event) } : null),
        hideTooltip: () => setTooltip(null),
        /** Render inside the chart, after its marks. */
        tooltipNode: tooltip && (
            // The `tooltip show` classes matter: the themes set the colours on `.tooltip` and scope
            // the text colour to `.tooltip .tooltip-inner`, so a bare inner would inherit the page's.
            // `tooltip-top` is the app's "raise above everything" class. Unlike a Bootstrap tooltip,
            // this bubble is rendered inside the chart rather than appended to `<body>`, so it is
            // stacked against the chart's own marks — and the hovered one lifts itself to draw its
            // outline, which the base tooltip layer would not clear.
            <div
                className={clsx(
                    "tooltip", "show", "tooltip-top", "chart-tooltip",
                    tooltip.flipX && "chart-tooltip-flip-x",
                    tooltip.flipY && "chart-tooltip-flip-y"
                )}
                style={{ left: tooltip.x, top: tooltip.y }}
            >
                <div className="tooltip-inner">{tooltip.text}</div>
            </div>
        )
    };
}
