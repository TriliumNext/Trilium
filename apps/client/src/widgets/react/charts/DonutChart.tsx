import "./DonutChart.css";

import clsx from "clsx";
import type { ComponentChildren } from "preact";

import { useChartTooltip } from "./chart_tooltip";

export interface DonutSegment<T = unknown> {
    /** Stable identity for reconciliation; unique within the ring. */
    id: string;
    value: number;
    /** Tooltip text, shown in the chart's own cursor-following tooltip while the segment is hovered. */
    tooltip?: string;
    /**
     * The mark's plain name, for whatever names it away from the chart: a selection strip, a legend,
     * an accessible name. The {@link tooltip} is this name with its figure worked into a sentence,
     * which is why the two are not the same string. Left unset by a mark standing for several things
     * at once, which has no one name to give.
     */
    label?: string;
    /**
     * Categorical tint (0–359), mixed into the theme surface exactly like the treemap cells.
     * Absent = the plain surface color, unless a {@link className} paints its own.
     */
    hue?: number;
    /** Extra class on the segment, e.g. to give it a semantic color. */
    className?: string;
    /** The consumer's payload, handed back on click. */
    data?: T;
}

export interface DonutRing<T = unknown> {
    /** Stable identity for reconciliation; unique within the chart. */
    id: string;
    /** Distance from the center to the middle of the band, in viewBox units (see {@link DONUT_VIEW_SIZE}). */
    radius: number;
    thickness: number;
    segments: DonutSegment<T>[];
    /**
     * Draws a full circle under the segments, so the band reads as a ring whatever is on it — and
     * still reads as one when every value is zero and no segment is drawn at all.
     */
    track?: boolean;
    onSegmentClick?: (segment: DonutSegment<T>) => void;
    onSegmentContextMenu?: (segment: DonutSegment<T>, event: MouseEvent) => void;
}

interface DonutChartProps<T> {
    rings: DonutRing<T>[];
    /**
     * The segment drawn as the chosen one, by {@link DonutSegment.id}, which is why those must be
     * unique across the chart's rings rather than only within one. For a consumer that keeps a
     * selection rather than leaving identity to the hover, as a touch screen has to.
     */
    selectedSegmentId?: string;
    className?: string;
    /**
     * SVG paint servers (gradients, patterns) for segments whose class points `--space-usage-donut-segment-color`
     * at one: a stroke can only reference them through `url(#id)`, so they must live in this chart's
     * own `<defs>`.
     */
    defs?: ComponentChildren;
    /** Rendered centered in the hole, above the rings. */
    children?: ComponentChildren;
}

/** The square viewBox rings are laid out in; radii and thicknesses are expressed in these units. */
export const DONUT_VIEW_SIZE = 420;

const SEGMENT_GAP = 3;

/**
 * One or more concentric donut rings, drawn as circle strokes: each segment is a `stroke-dasharray`
 * arc, which is what makes navigation animate — dash geometry is plain CSS, so segments sweep in on
 * mount and transition on change, with no path morphing. The chart stretches to its container's
 * height and keeps a square aspect where the width allows; center content overlays the hole as
 * regular HTML.
 *
 * Segment tooltips are the shared cursor-following chart bubble rather than anything anchored to
 * the element: a dashed circle's extent is the whole ring, so an anchored tooltip would hover far
 * from the segment it describes.
 */
export default function DonutChart<T>({ rings, selectedSegmentId, className, defs, children }: DonutChartProps<T>) {
    const half = DONUT_VIEW_SIZE / 2;
    const { containerRef, containerProps, showTooltip, hideTooltip, tooltipNode } = useChartTooltip<HTMLDivElement>();

    return (
        // Mouse events rather than pointer events: hover has no meaning on touch anyway, and
        // pointer handlers don't register correctly under the test DOM (see the render spec).
        <div ref={containerRef} className={clsx("donut-chart", className)} {...containerProps}>
            <svg viewBox={`${-half} ${-half} ${DONUT_VIEW_SIZE} ${DONUT_VIEW_SIZE}`}>
                {defs && <defs>{defs}</defs>}
                {/* Rotated so every ring starts at 12 o'clock. */}
                <g transform="rotate(-90)">
                    {rings.map((ring) => (
                        <Ring
                            key={ring.id}
                            ring={ring}
                            selectedSegmentId={selectedSegmentId}
                            onSegmentHover={(segment, event) => segment && event
                                ? showTooltip(segment.tooltip, event)
                                : hideTooltip()}
                        />
                    ))}
                </g>
            </svg>
            {children && <div className="donut-chart-center">{children}</div>}
            {tooltipNode}
        </div>
    );
}

function Ring<T>({ ring, selectedSegmentId, onSegmentHover }: {
    ring: DonutRing<T>,
    selectedSegmentId?: string,
    onSegmentHover: (segment: DonutSegment<T> | null, event?: { clientX: number, clientY: number }) => void
}) {
    const circumference = 2 * Math.PI * ring.radius;
    const layout = computeDonutLayout(ring.segments.map((segment) => segment.value), circumference, SEGMENT_GAP);

    return (
        <g>
            {/* First, so every segment paints over it. */}
            {ring.track && (
                <circle className="donut-track" r={ring.radius} fill="none" style={{ strokeWidth: ring.thickness }} />
            )}
            {ring.segments.map((segment, index) => {
                const arc = layout[index];

                if (!arc) {
                    return null;
                }

                return (
                    <circle
                        key={segment.id}
                        className={clsx(
                            "donut-segment",
                            segment.hue !== undefined && "donut-colored",
                            ring.onSegmentClick && "donut-clickable",
                            segment.id === selectedSegmentId && "donut-segment-selected",
                            segment.className
                        )}
                        r={ring.radius}
                        fill="none"
                        onClick={ring.onSegmentClick && (() => ring.onSegmentClick?.(segment))}
                        onContextMenu={ring.onSegmentContextMenu && ((event) => ring.onSegmentContextMenu?.(segment, event))}
                        onMouseEnter={(event) => onSegmentHover(segment, event)}
                        onMouseLeave={() => onSegmentHover(null)}
                        // Arc geometry is data-driven; as inline *style* (not attributes) it stays
                        // animatable by the stylesheet's transition and sweep keyframes.
                        style={{
                            strokeWidth: ring.thickness,
                            strokeDasharray: `${arc.length} ${Math.max(circumference - arc.length, 0)}`,
                            strokeDashoffset: -arc.offset,
                            "--donut-circumference": `${circumference}px`,
                            ...(segment.hue !== undefined && { "--donut-hue": String(segment.hue) })
                        }}
                    />
                );
            })}
        </g>
    );
}

export interface DonutArc {
    /** Arc length along the circumference. */
    length: number;
    /** Distance from the ring's start to the arc's start. */
    offset: number;
}

/**
 * Distributes values proportionally along a ring's circumference, `null` where a value paints
 * nothing. The gap is shaved off a segment only where it fits: slivers keep their full span so
 * they don't vanish, and a lone segment stays a closed circle.
 */
export function computeDonutLayout(values: number[], circumference: number, gap: number): (DonutArc | null)[] {
    const total = values.reduce((sum, value) => sum + Math.max(value, 0), 0);

    if (total <= 0) {
        return values.map(() => null);
    }

    const visibleCount = values.filter((value) => value > 0).length;
    let position = 0;

    return values.map((value) => {
        if (value <= 0) {
            return null;
        }

        const span = (value / total) * circumference;
        const start = position;
        position += span;

        if (visibleCount > 1 && span > gap * 2) {
            return { length: span - gap, offset: start + gap / 2 };
        }

        return { length: span, offset: start };
    });
}
