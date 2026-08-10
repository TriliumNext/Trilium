import { render } from "preact";
import { afterEach, beforeAll, describe, expect, it, vi } from "vitest";

import { enableMouseEventProperties } from "../../../test/dom_events";
import DonutChart, { type DonutRing } from "./DonutChart";

beforeAll(enableMouseEventProperties);

let container: HTMLDivElement | undefined;

function renderChart(rings: DonutRing<string>[], center?: preact.ComponentChildren) {
    container = document.body.appendChild(document.createElement("div"));
    render(<DonutChart<string> rings={rings}>{center}</DonutChart>, container);
    return container;
}

function chartOf(probe: HTMLElement) {
    const chart = probe.querySelector<HTMLElement>(".donut-chart");
    if (!chart) throw new Error("No chart rendered");
    return chart;
}

/** State set in an event handler renders on Preact's microtask, not synchronously. */
function flushRender() {
    return new Promise((resolve) => setTimeout(resolve));
}

function ring(overrides: Partial<DonutRing<string>> = {}): DonutRing<string> {
    return {
        id: "test-ring",
        radius: 100,
        thickness: 20,
        segments: [
            { id: "a", value: 75, tooltip: "A tip", hue: 10, data: "a" },
            { id: "b", value: 25, className: "seg-b", data: "b" },
            { id: "empty", value: 0, tooltip: "never shown" }
        ],
        ...overrides
    };
}

afterEach(() => {
    if (container) {
        render(null, container);
        container.remove();
        container = undefined;
    }
});

describe("DonutChart rendering", () => {
    it("draws one dash-arc circle per non-empty segment, proportional to its value", () => {
        const probe = renderChart([ ring() ]);
        const circles = [ ...probe.querySelectorAll<SVGCircleElement>("circle") ];

        expect(circles.length).toBe(2);

        const arcLength = (circle: SVGCircleElement) => parseFloat(circle.style.strokeDasharray);
        // 75 vs 25 — the shared gap shaving keeps it just off exactly 3.
        expect(arcLength(circles[0]) / arcLength(circles[1])).toBeGreaterThan(2.5);
        expect(circles[0].style.strokeWidth).toContain("20");
    });

    it("lays the segments on a track when asked, and keeps it when they add up to nothing", () => {
        const probe = renderChart([ ring({ track: true }) ]);
        const tracks = probe.querySelectorAll<SVGCircleElement>(".donut-track");

        expect(tracks.length).toBe(1);
        // Drawn first, so every segment paints over it, and at the band's own width.
        expect(probe.querySelector("circle")).toBe(tracks[0]);
        expect(tracks[0].style.strokeWidth).toContain("20");

        // The case it is there for: nothing to draw, and the ring still reads as a ring.
        render(null, probe);
        const empty = renderChart([ ring({ track: true, segments: [ { id: "none", value: 0 } ] }) ]);
        expect(empty.querySelectorAll(".donut-track").length).toBe(1);
        expect(empty.querySelectorAll(".donut-segment").length).toBe(0);
    });

    it("leaves the band bare unless a track is asked for", () => {
        expect(renderChart([ ring() ]).querySelector(".donut-track")).toBeNull();
    });

    it("tints by hue variable, forwards classes, and renders the center content", () => {
        const probe = renderChart([ ring() ], <span className="center-probe">middle</span>);
        const [ a, b ] = [ ...probe.querySelectorAll<SVGCircleElement>("circle") ];

        expect(a.classList.contains("donut-colored")).toBe(true);
        expect(a.style.getPropertyValue("--donut-hue")).toBe("10");
        expect(b.classList.contains("donut-colored")).toBe(false);
        expect(b.classList.contains("seg-b")).toBe(true);

        expect(probe.querySelector(".donut-chart-center .center-probe")?.textContent).toBe("middle");
    });

    it("hands the clicked segment back and marks the ring clickable", () => {
        const onSegmentClick = vi.fn();
        const probe = renderChart([ ring({ onSegmentClick }) ]);
        const [ , b ] = [ ...probe.querySelectorAll<SVGCircleElement>("circle") ];

        expect(b.classList.contains("donut-clickable")).toBe(true);
        b.dispatchEvent(new MouseEvent("click", { bubbles: true }));

        expect(onSegmentClick).toHaveBeenCalledTimes(1);
        expect(onSegmentClick.mock.calls[0][0]).toMatchObject({ id: "b", data: "b" });
    });

    it("shows the cursor-following tooltip on hover, moves it, and hides it on leave", async () => {
        const probe = renderChart([ ring() ]);
        const chart = chartOf(probe);
        const [ a ] = [ ...probe.querySelectorAll<SVGCircleElement>("circle") ];

        a.dispatchEvent(new MouseEvent("mouseenter", { clientX: 30, clientY: 40 }));
        await flushRender();
        const tooltip = probe.querySelector<HTMLElement>(".chart-tooltip");
        expect(tooltip?.textContent).toBe("A tip");
        // The Trilium look depends on riding the real tooltip classes; `tooltip-top` is what keeps
        // the bubble above the hovered mark, which lifts itself to draw its outline.
        expect(tooltip?.classList.contains("tooltip")).toBe(true);
        expect(tooltip?.classList.contains("show")).toBe(true);
        expect(tooltip?.classList.contains("tooltip-top")).toBe(true);
        // Positioned fixed, straight from the viewport coordinates, so no clipping ancestor cuts it.
        expect(tooltip?.style.left).toBe("30px");
        expect(tooltip?.style.top).toBe("40px");

        chart.dispatchEvent(new MouseEvent("mousemove", { clientX: 50, clientY: 60 }));
        await flushRender();
        const moved = probe.querySelector<HTMLElement>(".chart-tooltip");
        expect(moved?.style.left).toBe("50px");
        expect(moved?.style.top).toBe("60px");

        a.dispatchEvent(new MouseEvent("mouseleave"));
        await flushRender();
        expect(probe.querySelector(".chart-tooltip")).toBeNull();
    });

    it("flips the bubble at the viewport's midlines so it never runs off-screen", async () => {
        const probe = renderChart([ ring() ]);
        const [ a ] = [ ...probe.querySelectorAll<SVGCircleElement>("circle") ];
        const flipsOf = (x: number, y: number) => {
            a.dispatchEvent(new MouseEvent("mouseenter", { clientX: x, clientY: y }));
            return flushRender().then(() => {
                const classes = probe.querySelector(".chart-tooltip")?.classList;
                return {
                    x: classes?.contains("chart-tooltip-flip-x"),
                    y: classes?.contains("chart-tooltip-flip-y")
                };
            });
        };

        const nearOrigin = { x: window.innerWidth * 0.25, y: window.innerHeight * 0.25 };
        const nearCorner = { x: window.innerWidth * 0.75, y: window.innerHeight * 0.75 };

        expect(await flipsOf(nearOrigin.x, nearOrigin.y)).toEqual({ x: false, y: false });
        expect(await flipsOf(nearCorner.x, nearOrigin.y)).toEqual({ x: true, y: false });
        expect(await flipsOf(nearOrigin.x, nearCorner.y)).toEqual({ x: false, y: true });
        expect(await flipsOf(nearCorner.x, nearCorner.y)).toEqual({ x: true, y: true });
    });

    it("shows no tooltip for a segment without one, and clears on leaving the chart", async () => {
        const probe = renderChart([ ring() ]);
        const [ a, b ] = [ ...probe.querySelectorAll<SVGCircleElement>("circle") ];

        b.dispatchEvent(new MouseEvent("mouseenter", { clientX: 10, clientY: 10 }));
        await flushRender();
        expect(probe.querySelector(".chart-tooltip")).toBeNull();

        a.dispatchEvent(new MouseEvent("mouseenter", { clientX: 10, clientY: 10 }));
        await flushRender();
        expect(probe.querySelector(".chart-tooltip")).not.toBeNull();
        probe.querySelector(".donut-chart")?.dispatchEvent(new MouseEvent("mouseleave"));
        await flushRender();
        expect(probe.querySelector(".chart-tooltip")).toBeNull();
    });
});
