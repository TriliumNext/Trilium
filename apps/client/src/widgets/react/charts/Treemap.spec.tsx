import { render } from "preact";
import { afterEach, beforeAll, describe, expect, it, vi } from "vitest";

import { enableMouseEventProperties } from "../../../test/dom_events";

beforeAll(enableMouseEventProperties);

// The container never gets a real layout under happy-dom, so the size hook is stubbed to give the
// treemap a canvas; everything else renders for real.
const mocks = vi.hoisted(() => ({
    size: { width: 400, height: 300 } as { width: number, height: number } | undefined
}));
vi.mock("../hooks", () => ({
    useElementSize: () => mocks.size
}));

import Treemap, { type TreemapItem } from "./Treemap";

let container: HTMLDivElement | undefined;

function renderTreemap(root: TreemapItem<string>, onItemClick?: (item: TreemapItem<string>) => void) {
    container = document.body.appendChild(document.createElement("div"));
    render(<Treemap<string> root={root} onItemClick={onItemClick} />, container);
    return container;
}

afterEach(() => {
    if (container) {
        render(null, container);
        container.remove();
        container = undefined;
    }
    mocks.size = { width: 400, height: 300 };
});

const ROOT: TreemapItem<string> = {
    id: "root",
    children: [
        {
            id: "folder",
            children: [
                {
                    id: "big",
                    value: 300,
                    hue: 120,
                    icon: "tn-icon bx bx-file",
                    data: "big",
                    attributes: { "data-href": "#root/folder/big" }
                },
                { id: "small", value: 100, icon: "tn-icon bx bx-note", data: "small", attributes: { id: "cell-small" } }
            ]
        },
        { id: "bucket", value: 100, className: "bucket-cell", tooltip: "A crowd of notes" },
        { id: "empty", value: 0 },
        { id: "no-value" }
    ]
};

describe("Treemap", () => {
    it("draws only the leaves: parents shape the layout, zero-weight cells disappear", () => {
        const probe = renderTreemap(ROOT);
        const cells = [ ...probe.querySelectorAll(".treemap-cell") ];

        // big, small and the bucket — no cell for the folder, none for the empty leaf.
        expect(cells.length).toBe(3);

        for (const cell of cells) {
            const { left, top, width, height } = (cell as HTMLElement).style;
            expect(parseFloat(width)).toBeGreaterThan(0);
            expect(parseFloat(height)).toBeGreaterThan(0);
            expect(left).not.toBe("");
            expect(top).not.toBe("");
        }
    });

    it("tints a cell through its hue variable and forwards attributes and classes", () => {
        const probe = renderTreemap(ROOT);

        const big = probe.querySelector<HTMLElement>('[data-href="#root/folder/big"]');
        expect(big?.classList.contains("treemap-colored")).toBe(true);
        expect(big?.style.getPropertyValue("--treemap-hue")).toBe("120");

        const bucket = probe.querySelector<HTMLElement>(".bucket-cell");
        expect(bucket?.classList.contains("treemap-colored")).toBe(false);
        expect(bucket?.style.getPropertyValue("--treemap-hue")).toBe("");
    });

    it("hands the clicked item back to the consumer", () => {
        const onItemClick = vi.fn();
        const probe = renderTreemap(ROOT, onItemClick);

        probe.querySelector('[data-href="#root/folder/big"]')
            ?.dispatchEvent(new MouseEvent("click", { bubbles: true }));

        expect(onItemClick).toHaveBeenCalledTimes(1);
        expect(onItemClick.mock.calls[0][0]).toMatchObject({ id: "big", data: "big" });
    });

    it("draws nothing until the container has a usable size", () => {
        mocks.size = undefined;
        expect(renderTreemap(ROOT).querySelectorAll(".treemap-cell").length).toBe(0);

        render(null, container as HTMLDivElement);
        mocks.size = { width: 5, height: 5 };
        expect(renderTreemap(ROOT).querySelectorAll(".treemap-cell").length).toBe(0);
    });

    it("shows the app's own tooltip for a cell that carries one, and none for the others", async () => {
        const probe = renderTreemap(ROOT);
        const flushRender = () => new Promise((resolve) => setTimeout(resolve));

        probe.querySelector('[data-href="#root/folder/big"]')
            ?.dispatchEvent(new MouseEvent("mouseenter", { clientX: 10, clientY: 10 }));
        await flushRender();
        // A note cell is described by the note preview tooltip instead, via its data-href.
        expect(probe.querySelector(".chart-tooltip")).toBeNull();

        probe.querySelector(".bucket-cell")
            ?.dispatchEvent(new MouseEvent("mouseenter", { clientX: 10, clientY: 10 }));
        await flushRender();
        const tooltip = probe.querySelector<HTMLElement>(".chart-tooltip");
        expect(tooltip?.textContent).toBe("A crowd of notes");
        expect(tooltip?.classList.contains("tooltip")).toBe(true);

        // No native tooltip anywhere: the browser's own bubble is never what the app shows.
        for (const cell of probe.querySelectorAll(".treemap-cell")) {
            expect(cell.getAttribute("title")).toBeNull();
        }

        probe.querySelector(".bucket-cell")?.dispatchEvent(new MouseEvent("mouseleave"));
        await flushRender();
        expect(probe.querySelector(".chart-tooltip")).toBeNull();
    });

    it("insets the whole map, so an edge cell's hover outline has room", () => {
        const probe = renderTreemap(ROOT);

        for (const cell of probe.querySelectorAll<HTMLElement>(".treemap-cell")) {
            const { left, top, width, height } = cell.style;
            expect(parseFloat(left)).toBeGreaterThanOrEqual(2);
            expect(parseFloat(top)).toBeGreaterThanOrEqual(2);
            // The stubbed container is 400×300.
            expect(parseFloat(left) + parseFloat(width)).toBeLessThanOrEqual(398);
            expect(parseFloat(top) + parseFloat(height)).toBeLessThanOrEqual(298);
        }
    });

    it("rounds each block's own corners, leaving the cuts inside a block square", () => {
        const probe = renderTreemap(ROOT);
        // Read as longhands: the shorthand collapses "4px 4px 4px 4px" down to "4px".
        const cornersOf = (selector: string) => {
            const style = probe.querySelector<HTMLElement>(selector)?.style;
            return [
                style?.borderTopLeftRadius, style?.borderTopRightRadius,
                style?.borderBottomRightRadius, style?.borderBottomLeftRadius
            ];
        };

        // A cell that is a block by itself owns all four corners.
        expect(cornersOf(".bucket-cell")).toEqual([ "4px", "4px", "4px", "4px" ]);

        // The two cells sharing a block split it, so between them they own its four corners while
        // the edge where they meet stays square.
        const grouped = [ '[data-href="#root/folder/big"]', "#cell-small" ].map(cornersOf);
        expect(grouped.flat().filter((corner) => corner === "4px").length).toBe(4);
        for (const corners of grouped) {
            expect(corners.filter((corner) => corner === "0px").length).toBeGreaterThan(0);
        }
    });

    it("fits each cell's icon to its shorter side, capped, and drops it when illegibly small", () => {
        const probe = renderTreemap(ROOT);
        const iconIn = (selector: string) =>
            probe.querySelector<HTMLElement>(`${selector} > .treemap-cell-icon`);

        // A cell with room gets the icon it was given, at the capped size.
        const big = iconIn('[data-href="#root/folder/big"]');
        expect(big?.classList.contains("bx-file")).toBe(true);
        expect(parseFloat(big?.style.fontSize ?? "")).toBe(24);

        // 80% of the shorter side — a tenth left clear on either edge — until the cap takes over.
        const small = probe.querySelector<HTMLElement>("#cell-small");
        const shorterSide = Math.min(parseFloat(small?.style.width ?? ""), parseFloat(small?.style.height ?? ""));
        expect(parseFloat(iconIn("#cell-small")?.style.fontSize ?? ""))
            .toBeCloseTo(Math.min(shorterSide * 0.8, 24), 5);

        // A cell that was given no icon shows none.
        expect(iconIn(".bucket-cell")).toBeNull();

        // Squeeze the map until the icons no longer read, and they go rather than turn into smudges
        // — the cells themselves stay, so this is the icons dropping out and not an empty map.
        render(null, container as HTMLDivElement);
        mocks.size = { width: 20, height: 20 };
        const squeezed = renderTreemap(ROOT);
        expect(squeezed.querySelectorAll(".treemap-cell").length).toBeGreaterThan(0);
        expect(squeezed.querySelectorAll(".treemap-cell-icon").length).toBe(0);
    });

    it("gives bigger values proportionally bigger areas", () => {
        const probe = renderTreemap(ROOT);
        const areaOf = (selector: string) => {
            const cell = probe.querySelector<HTMLElement>(selector);
            if (!cell) throw new Error(`No cell for '${selector}'`);
            return parseFloat(cell.style.width) * parseFloat(cell.style.height);
        };

        // 300 vs 100: padding shaves a little off, so demand a clear factor rather than exactness.
        expect(areaOf('[data-href="#root/folder/big"]') / areaOf(".bucket-cell")).toBeGreaterThan(2);
    });
});
