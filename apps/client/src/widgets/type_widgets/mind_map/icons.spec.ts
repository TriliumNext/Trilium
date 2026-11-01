import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { renderIconImage } from "../../../services/icon_glyphs";
import { LEAD_ICON_CLASS, renderExportedIcons, renderIconClasses } from "./icons";

// The drawing of a glyph needs a canvas and the browser's own style resolution, neither of which
// this environment has; the service has its own tests for that.
vi.mock("../../../services/icon_glyphs", () => ({ renderIconImage: vi.fn() }));

const uncheckedWindow = window as unknown as { glob: { iconRegistry?: unknown } };

/**
 * Renders what Mind Elixir makes of a node: its text, and after it the icons it was given as the
 * text they arrived as, one span each.
 */
function buildNode(...icons: string[]) {
    const container = document.createElement("div");
    container.innerHTML = `<me-tpc><span class="text">Topic</span>`
        + `<span class="icons">${icons.map((icon) => `<span>${icon}</span>`).join("")}</span></me-tpc>`;
    return container;
}

/** Every icon of the node, in the order they are worn — the one moved ahead of the text included. */
function icons(container: HTMLElement) {
    return [ ...container.querySelectorAll<HTMLElement>(`me-tpc > .${LEAD_ICON_CLASS}, me-tpc > .icons > span`) ];
}

describe("renderIconClasses", () => {
    beforeEach(() => {
        uncheckedWindow.glob.iconRegistry = { sources: [ { prefix: "bx" }, { prefix: "mdi" } ] };
    });

    afterEach(() => {
        delete uncheckedWindow.glob.iconRegistry;
    });

    it("dresses a Trilium icon class, whichever pack it belongs to", () => {
        const container = buildNode("bx bx-star", "mdi mdi-cube");

        expect(renderIconClasses(container)).toBe(true);

        const [ boxicon, mdi ] = icons(container);
        expect(boxicon.classList).toContain("bx-star");
        expect(boxicon.textContent).toBe("");
        expect(mdi.className).toBe("mdi mdi-cube");
    });

    it("leaves alone whatever is not one, so that a map made elsewhere keeps its icons", () => {
        // An emoji is an icon in its own right; a pack that is not installed names nothing that
        // could be drawn; and a sentence is a sentence. The first still leads the text, being the
        // node's first icon whether or not Trilium is the one drawing it.
        const container = buildNode("⭐", "phosphor ph-cube", "bx");

        renderIconClasses(container);

        expect(icons(container).map((icon) => [ icon.textContent, icon.classList.contains(LEAD_ICON_CLASS) ]))
            .toEqual([ [ "⭐", true ], [ "phosphor ph-cube", false ], [ "bx", false ] ]);
    });

    it("leaves a dressed icon something to read, for the exporter's sake", () => {
        // Mind Elixir's SVG exporter reads `childNodes[0].textContent` off every icon it finds, so
        // a span emptied down to nothing throws there — and the preview is rendered on every save.
        const container = buildNode("bx bx-star");

        renderIconClasses(container);

        const [ icon ] = icons(container);
        expect(icon?.childNodes).toHaveLength(1);
        expect(icon?.childNodes[0].textContent).toBe("");
    });

    it("can be run again over what it has already dressed, reporting that it changed nothing", () => {
        // It runs after every layout, and a layout does not always rebuild the node. Saying that
        // nothing was dressed is what stops the caller measuring the map over and over: it measures
        // again only where a node has just narrowed.
        const container = buildNode("bx bx-star");

        expect(renderIconClasses(container)).toBe(true);
        expect(renderIconClasses(container)).toBe(false);

        const [ icon ] = icons(container);
        expect(icon?.className).toBe(`bx bx-star ${LEAD_ICON_CLASS}`);
        expect(icon?.textContent).toBe("");
    });

    it("sets the first icon ahead of the node's text, leaving the rest after it", () => {
        const container = buildNode("bx bx-star", "mdi mdi-cube", "⭐");

        renderIconClasses(container);

        // The first is a child of the node itself now, standing before its text; the others stay in
        // the wrapper Mind Elixir put them in, which is where its exporter looks for them.
        expect([ ...(container.querySelector("me-tpc")?.children ?? []) ].map((child) => child.className))
            .toEqual([ `bx bx-star ${LEAD_ICON_CLASS}`, "text", "icons" ]);
        expect(container.querySelectorAll(".icons > span")).toHaveLength(2);
    });

    it("moves the first icon once, however often it is run", () => {
        // Run after every layout, and a layout does not always rebuild the node — moving again
        // would take the second icon to the front along with the first.
        const container = buildNode("bx bx-star", "mdi mdi-cube");

        expect(renderIconClasses(container)).toBe(true);
        expect(renderIconClasses(container)).toBe(false);

        expect(container.querySelectorAll(`.${LEAD_ICON_CLASS}`)).toHaveLength(1);
        expect(icons(container).map((icon) => icon.className.replace(` ${LEAD_ICON_CLASS}`, "")))
            .toEqual([ "bx bx-star", "mdi mdi-cube" ]);
    });

    it("leaves a node with no text of its own — nothing to lead — as it is", () => {
        const container = document.createElement("div");
        container.innerHTML = `<me-tpc><span class="icons"><span>bx bx-star</span></span></me-tpc>`;

        renderIconClasses(container);

        expect(container.querySelector(`.${LEAD_ICON_CLASS}`)).toBeNull();
        expect(container.querySelector(".icons > span")?.className).toBe("bx bx-star");
    });

    it("holds off until the icon packs are known", () => {
        delete uncheckedWindow.glob.iconRegistry;
        const container = buildNode("bx bx-star");

        renderIconClasses(container);

        expect(icons(container)[0]?.textContent).toBe("bx bx-star");
    });
});

describe("renderExportedIcons", () => {
    beforeEach(() => {
        uncheckedWindow.glob.iconRegistry = { sources: [ { prefix: "bx" } ] };
        vi.mocked(renderIconImage).mockReset();
        vi.mocked(renderIconImage).mockImplementation(async (iconClass) => `data:image/png;drawn-${iconClass}`);
    });

    afterEach(() => {
        delete uncheckedWindow.glob.iconRegistry;
        vi.restoreAllMocks();
    });

    /**
     * A node dressed as the map dresses it, laid out as the browser would lay it out — neither of
     * which the test environment does of its own accord.
     */
    function buildLaidOutNode(...iconTexts: string[]) {
        const nodes = document.createElement("me-nodes");
        const container = buildNode(...iconTexts);
        nodes.appendChild(container);
        renderIconClasses(container);

        // Each icon 12 wide on a line of 20, the node itself 100 across the map and 40 down it. The
        // walk out to the map adds the two up, so the icons hang off the node and the node off the
        // map, as they would be laid out.
        const topic = container.querySelector("me-tpc");
        lay(topic, nodes, { offsetLeft: 100, offsetTop: 40 });
        for (const [ index, icon ] of icons(container).entries()) {
            lay(icon, topic, { offsetLeft: index * 12, offsetTop: 0, offsetWidth: 12, offsetHeight: 20 });
        }

        // The size and the colour are read off the styles, which resolve to nothing here.
        vi.spyOn(window, "getComputedStyle")
            .mockReturnValue({ fontSize: "16px", color: "rgb(20, 20, 20)" } as CSSStyleDeclaration);

        return nodes;
    }

    /** Puts an element where it would have been laid out, and off the element it was laid out in. */
    function lay(element: Element | null, offsetParent: Element | null, offsets: Record<string, number>) {
        for (const [ name, value ] of Object.entries({ ...offsets, offsetParent })) {
            Object.defineProperty(element, name, { configurable: true, value });
        }
    }

    it("draws every icon a pack draws, centred in the room the text left it", async () => {
        const nodes = buildLaidOutNode("bx bx-star", "bx bx-cube");

        const drawn = await renderExportedIcons(nodes);

        expect(drawn).toEqual([
            // The node sits at (100, 40) and each icon within it, so the two are added up; the icon
            // is drawn at the size of the text, centred in the 12 by 20 it was given.
            { x: 100 + (12 - 16) / 2, y: 40 + (20 - 16) / 2, size: 16, color: "rgb(20, 20, 20)", image: "data:image/png;drawn-bx bx-star" },
            { x: 112 + (12 - 16) / 2, y: 40 + (20 - 16) / 2, size: 16, color: "rgb(20, 20, 20)", image: "data:image/png;drawn-bx bx-cube" }
        ]);
        // Drawn at one size whatever size it is shown at, the drawing being scaled to each place it
        // is stamped — so the same icon on a large node and a small one is drawn once between them.
        expect(renderIconImage).toHaveBeenCalledWith("bx bx-star", { size: 48, color: "rgb(20, 20, 20)", scale: 1 });
    });

    it("draws only the leading one of the icons that are characters, the rest being drawn already", async () => {
        // An emoji leads the text, where the exporter no longer finds it; the one that follows it
        // stays in the wrapper the exporter reads, and is left to it.
        const nodes = buildLaidOutNode("⭐", "\u{1f9ca}");

        const drawn = await renderExportedIcons(nodes);

        expect(drawn).toEqual([
            { x: 100 + (12 - 16) / 2, y: 40 + (20 - 16) / 2, size: 16, color: "rgb(20, 20, 20)", text: "⭐" }
        ]);
        expect(renderIconImage).not.toHaveBeenCalled();
    });

    it("passes over an icon that could not be drawn at all", async () => {
        vi.mocked(renderIconImage).mockResolvedValue(null);
        const nodes = buildLaidOutNode("bx bx-star");

        await expect(renderExportedIcons(nodes)).resolves.toEqual([]);
    });
});
