import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import $ from "jquery";

import Split from "@triliumnext/split.js";

// Replace the Split.js library with a controllable test double so we can assert
// on the options passed and exercise the onDragEnd callbacks without needing
// real layout (happy-dom has none).
vi.mock("@triliumnext/split.js", () => ({
    default: vi.fn(() => ({ destroy: vi.fn() }))
}));

const SplitMock = Split as unknown as ReturnType<typeof vi.fn>;

// A manual requestAnimationFrame queue: callbacks are NOT run automatically, so
// we can flush them on demand and exercise the cancelAnimationFrame branch.
let rafCallbacks: Map<number, FrameRequestCallback>;
let rafNextId: number;
let cancelledRafIds: number[];

function flushRaf() {
    const pending = [...rafCallbacks.entries()];
    rafCallbacks.clear();
    for (const [, cb] of pending) {
        cb(0);
    }
}

/** Force `$("#right-pane").is(":visible")` to a chosen value (no layout in happy-dom). */
function setRightPaneVisible(visible: boolean) {
    const origIs = ($ as any).fn.is;
    return vi.spyOn(($ as any).fn, "is").mockImplementation(function (this: any, sel: any, ...rest: any[]) {
        if (sel === ":visible") {
            return visible;
        }
        return origIs.call(this, sel, ...rest);
    });
}

/**
 * Force `$("#launcher-pane").outerWidth()` to a chosen pixel value (happy-dom has
 * no layout, so it otherwise returns 0). Used to exercise the vertical-layout
 * reserved-width math, which is invisible when the reserved width collapses to 0.
 */
function setLauncherPaneWidth(px: number) {
    const origOuterWidth = ($ as any).fn.outerWidth;
    return vi.spyOn(($ as any).fn, "outerWidth").mockImplementation(function (this: any, ...args: any[]) {
        if (this[0]?.id === "launcher-pane") {
            return px;
        }
        return origOuterWidth.apply(this, args);
    });
}

/**
 * Load a fresh copy of resizer.ts (its module-level state is otherwise a
 * singleton that never resets) with options.get/getInt stubbed to the supplied
 * values.
 */
async function loadResizer(opts: { layoutOrientation?: string; leftPaneWidth?: number | null; rightPaneWidth?: number | null } = {}) {
    vi.resetModules();
    const optionsModule = (await import("./options.js")).default;
    optionsModule.get = vi.fn((key) => (key === "layoutOrientation" ? (opts.layoutOrientation ?? "horizontal") : "")) as typeof optionsModule.get;
    optionsModule.getInt = vi.fn((key) => {
        if (key === "leftPaneWidth") return opts.leftPaneWidth ?? null;
        if (key === "rightPaneWidth") return opts.rightPaneWidth ?? null;
        return null;
    }) as typeof optionsModule.getInt;
    optionsModule.save = vi.fn(async () => {}) as typeof optionsModule.save;
    const resizer = (await import("./resizer.js")).default;
    return { resizer, options: optionsModule };
}

beforeEach(() => {
    rafCallbacks = new Map();
    rafNextId = 0;
    cancelledRafIds = [];
    globalThis.requestAnimationFrame = ((cb: FrameRequestCallback) => {
        const id = ++rafNextId;
        rafCallbacks.set(id, cb);
        return id;
    }) as typeof globalThis.requestAnimationFrame;
    globalThis.cancelAnimationFrame = ((id: number) => {
        cancelledRafIds.push(id);
        rafCallbacks.delete(id);
    }) as typeof globalThis.cancelAnimationFrame;
    SplitMock.mockClear();
    SplitMock.mockImplementation(() => ({ destroy: vi.fn() }));
    document.body.innerHTML = `
        <div id="launcher-pane"></div>
        <div id="left-pane"></div>
        <div id="rest-pane"></div>
        <div id="center-pane">
            <div class="split-note-container-widget"></div>
        </div>
        <div id="right-pane"></div>`;
});

afterEach(() => {
    vi.restoreAllMocks();
});

describe("setupLeftPaneResizer", () => {
    it("when left pane is hidden, stretches rest pane to full width (horizontal layout, no reserved width)", async () => {
        const { resizer } = await loadResizer({ layoutOrientation: "horizontal" });

        resizer.setupLeftPaneResizer(false);

        expect($("#left-pane").is(":hidden") || $("#left-pane").css("display") === "none").toBe(true);
        expect($("#rest-pane").css("width")).toBe("100%");
        expect(SplitMock).not.toHaveBeenCalled();
    });

    it("when left pane is hidden in vertical layout, reserves launcher-pane width", async () => {
        // Give the launcher pane a real width so the vertical reservation math
        // produces a value distinguishable from the horizontal 100% case.
        setLauncherPaneWidth(120);
        const { resizer } = await loadResizer({ layoutOrientation: "vertical" });

        resizer.setupLeftPaneResizer(false);

        // reservedWidth = 120 / window.innerWidth * 100; rest-pane = (100 - reservedWidth)%.
        const reservedWidth = (120 / window.innerWidth) * 100;
        expect(reservedWidth).toBeGreaterThan(0);
        expect($("#rest-pane").css("width")).toBe(`${100 - reservedWidth}%`);
        // Must be strictly less than the horizontal 100% so a broken reservation is caught.
        const restPaneWidthValue = parseFloat($("#rest-pane").css("width"));
        expect(restPaneWidthValue).toBeLessThan(100);
    });

    it("when left pane is hidden in vertical layout with no launcher width, falls back to 100%", async () => {
        // launcher-pane outerWidth() is 0 in happy-dom (no layout) -> the `|| 0`
        // fallback yields reservedWidth 0 -> rest-pane 100%.
        const { resizer } = await loadResizer({ layoutOrientation: "vertical" });

        resizer.setupLeftPaneResizer(false);

        expect($("#rest-pane").css("width")).toBe("100%");
    });

    it("when left pane is hidden in horizontal layout, does NOT reserve launcher-pane width", async () => {
        // Even with a non-zero launcher width, the horizontal branch ignores it.
        setLauncherPaneWidth(120);
        const { resizer } = await loadResizer({ layoutOrientation: "horizontal" });

        resizer.setupLeftPaneResizer(false);

        expect($("#rest-pane").css("width")).toBe("100%");
    });

    it("when left pane is visible, creates a Split via requestAnimationFrame and persists drag results", async () => {
        const destroy = vi.fn();
        SplitMock.mockImplementation(() => ({ destroy }));
        const { resizer, options } = await loadResizer({ layoutOrientation: "horizontal", leftPaneWidth: 30 });

        resizer.setupLeftPaneResizer(true);
        // Split is only created once the rAF callback runs.
        expect(SplitMock).not.toHaveBeenCalled();
        flushRaf();

        expect(SplitMock).toHaveBeenCalledTimes(1);
        const [elements, config] = SplitMock.mock.calls[0];
        expect(elements).toEqual(["#left-pane", "#rest-pane"]);
        expect(config.sizes).toEqual([30, 70]);
        expect(config.gutterSize).toBe(5);
        expect(config.minSize).toEqual([150, 300]);

        // onDragEnd rounds and saves the new left pane width.
        config.onDragEnd([42.6, 57.4]);
        expect(options.save).toHaveBeenCalledWith("leftPaneWidth", 43);

        // onDragEnd also mutates the module-level cache: a subsequent rebuild must use
        // the NEW (dragged + rounded) width 43, not the original 30 -> sizes [43, 57].
        resizer.setupLeftPaneResizer(true);
        flushRaf();
        expect(SplitMock).toHaveBeenCalledTimes(2);
        expect(SplitMock.mock.calls[1][1].sizes).toEqual([43, 57]);
    });

    it("clamps a missing stored width (getInt -> null) up to the minimum of 5", async () => {
        const { resizer } = await loadResizer({ layoutOrientation: "horizontal", leftPaneWidth: null });

        resizer.setupLeftPaneResizer(true);
        flushRaf();

        // getInt returns null -> falls back to 0 -> clamped to the 5 minimum.
        expect(SplitMock.mock.calls[0][1].sizes).toEqual([5, 95]);
    });

    it("clamps a too-small stored width (e.g. 2) up to the minimum of 5", async () => {
        const { resizer } = await loadResizer({ layoutOrientation: "horizontal", leftPaneWidth: 2 });

        resizer.setupLeftPaneResizer(true);
        flushRaf();

        expect(SplitMock.mock.calls[0][1].sizes).toEqual([5, 95]);
    });

    it("destroys the previous Split instance when re-invoked", async () => {
        const destroy = vi.fn();
        SplitMock.mockImplementation(() => ({ destroy }));
        const { resizer } = await loadResizer({ layoutOrientation: "horizontal", leftPaneWidth: 30 });

        resizer.setupLeftPaneResizer(true);
        flushRaf();
        expect(destroy).not.toHaveBeenCalled();

        // Second invocation must tear down the existing instance before rebuilding.
        resizer.setupLeftPaneResizer(true);
        expect(destroy).toHaveBeenCalledTimes(1);
        flushRaf();
        expect(SplitMock).toHaveBeenCalledTimes(2);
    });

    it("reuses cached layout/width state on subsequent calls instead of re-reading options", async () => {
        const { resizer, options } = await loadResizer({ layoutOrientation: "horizontal", leftPaneWidth: 30 });

        resizer.setupLeftPaneResizer(true);
        flushRaf();
        const getCallsAfterFirst = (options.get as ReturnType<typeof vi.fn>).mock.calls.length;
        const getIntCallsAfterFirst = (options.getInt as ReturnType<typeof vi.fn>).mock.calls.length;

        resizer.setupLeftPaneResizer(true);
        flushRaf();

        // layoutOrientation / leftPaneWidth are cached after the first call (?? short-circuits).
        expect((options.get as ReturnType<typeof vi.fn>).mock.calls.length).toBe(getCallsAfterFirst);
        expect((options.getInt as ReturnType<typeof vi.fn>).mock.calls.length).toBe(getIntCallsAfterFirst);
    });
});

describe("setupRightPaneResizer", () => {
    it("when right pane is hidden, stretches center pane to full width", async () => {
        const isSpy = setRightPaneVisible(false);
        const { resizer } = await loadResizer();

        resizer.setupRightPaneResizer();

        expect($("#center-pane").css("width")).toBe("100%");
        expect(SplitMock).not.toHaveBeenCalled();
        isSpy.mockRestore();
    });

    it("when right pane is visible, creates a Split and persists drag results", async () => {
        const isSpy = setRightPaneVisible(true);
        const { resizer, options } = await loadResizer({ rightPaneWidth: 25 });

        resizer.setupRightPaneResizer();

        expect(SplitMock).toHaveBeenCalledTimes(1);
        const [elements, config] = SplitMock.mock.calls[0];
        expect(elements).toEqual(["#center-pane", "#right-pane"]);
        expect(config.sizes).toEqual([75, 25]);
        expect(config.minSize).toEqual([300, 180]);

        config.onDragEnd([60.2, 39.8]);
        expect(options.save).toHaveBeenCalledWith("rightPaneWidth", 40);

        // onDragEnd also mutates the module-level cache: a subsequent rebuild must use
        // the NEW (dragged + rounded) width 40, not the original 25 -> sizes [60, 40].
        resizer.setupRightPaneResizer();
        expect(SplitMock).toHaveBeenCalledTimes(2);
        expect(SplitMock.mock.calls[1][1].sizes).toEqual([60, 40]);
        isSpy.mockRestore();
    });

    it("clamps an undefined/too-small right pane width up to 5 and destroys a previous instance", async () => {
        const isSpy = setRightPaneVisible(true);
        const destroy = vi.fn();
        SplitMock.mockImplementation(() => ({ destroy }));
        const { resizer } = await loadResizer({ rightPaneWidth: null });

        resizer.setupRightPaneResizer();
        expect(SplitMock.mock.calls[0][1].sizes).toEqual([95, 5]);
        expect(destroy).not.toHaveBeenCalled();

        resizer.setupRightPaneResizer();
        expect(destroy).toHaveBeenCalledTimes(1);
        expect(SplitMock).toHaveBeenCalledTimes(2);
        isSpy.mockRestore();
    });
});

describe("note split resizers", () => {
    function panel(ntxId: string) {
        const el = document.createElement("div");
        el.className = "note-split";
        el.setAttribute("data-ntx-id", ntxId);
        return el;
    }

    function seedPanels(container: Element, ...ntxIds: string[]) {
        for (const id of ntxIds) {
            container.appendChild(panel(id));
        }
    }

    it("setupNoteSplitResizer creates a Split for a brand-new group of ntx ids", async () => {
        const { resizer } = await loadResizer();
        const container = document.querySelector(".split-note-container-widget")!;
        seedPanels(container, "a1", "a2");
        // A stray .note-split without a data-ntx-id attribute must be ignored (the
        // null attribute falls back to "" and fails the includes() filter).
        const stray = document.createElement("div");
        stray.className = "note-split";
        container.appendChild(stray);

        resizer.setupNoteSplitResizer(["a1", "a2"]);
        flushRaf();

        expect(SplitMock).toHaveBeenCalledTimes(1);
        const [panels, config] = SplitMock.mock.calls[0];
        expect(panels.map((p: HTMLElement) => p.getAttribute("data-ntx-id"))).toEqual(["a1", "a2"]);
        expect(config.minSize).toBe(150);
        expect(config.gutterSize).toBe(5);
    });

    it("setupNoteSplitResizer merges new ntx ids into an existing matching group and rebuilds", async () => {
        const destroy = vi.fn();
        SplitMock.mockImplementation(() => ({ destroy }));
        const { resizer } = await loadResizer();
        const container = document.querySelector(".split-note-container-widget")!;
        seedPanels(container, "b1", "b2", "b3");

        resizer.setupNoteSplitResizer(["b1", "b2"]);
        flushRaf();
        expect(SplitMock).toHaveBeenCalledTimes(1);

        // "b1" already belongs to a group; "b3" is new and should be appended to it.
        resizer.setupNoteSplitResizer(["b1", "b3"]);
        // Previous instance for the group is destroyed before rebuilding.
        expect(destroy).toHaveBeenCalledTimes(1);
        flushRaf();
        expect(SplitMock).toHaveBeenCalledTimes(2);
        expect(SplitMock.mock.calls[1][0].map((p: HTMLElement) => p.getAttribute("data-ntx-id"))).toEqual(["b1", "b2", "b3"]);
    });

    it("createSplitInstance cancels a still-pending rAF for the same group before scheduling a new one", async () => {
        const { resizer } = await loadResizer();
        const container = document.querySelector(".split-note-container-widget")!;
        seedPanels(container, "c1", "c2");

        // First scheduling leaves a pending rAF (we don't flush).
        resizer.setupNoteSplitResizer(["c1", "c2"]);
        // Second scheduling for the overlapping group should cancel the first rAF.
        resizer.setupNoteSplitResizer(["c1"]);
        expect(cancelledRafIds.length).toBe(1);

        flushRaf();
        expect(SplitMock).toHaveBeenCalledTimes(1);
    });

    it("moveNoteSplitResizer rebuilds an existing group and is a no-op for an unknown ntx id", async () => {
        const destroy = vi.fn();
        SplitMock.mockImplementation(() => ({ destroy }));
        const { resizer } = await loadResizer();
        const container = document.querySelector(".split-note-container-widget")!;
        seedPanels(container, "d1", "d2");

        resizer.setupNoteSplitResizer(["d1", "d2"]);
        flushRaf();

        resizer.moveNoteSplitResizer("d1");
        expect(destroy).toHaveBeenCalledTimes(1);
        flushRaf();
        expect(SplitMock).toHaveBeenCalledTimes(2);

        // Unknown ntx id -> early return, no extra Split / destroy.
        resizer.moveNoteSplitResizer("does-not-exist");
        flushRaf();
        expect(SplitMock).toHaveBeenCalledTimes(2);
        expect(destroy).toHaveBeenCalledTimes(1);
    });

    it("delNoteSplitResizer removes ids, rebuilds when >= 2 remain, drops the group otherwise, and ignores unknown ids", async () => {
        const destroy = vi.fn();
        SplitMock.mockImplementation(() => ({ destroy }));
        const { resizer } = await loadResizer();
        const container = document.querySelector(".split-note-container-widget")!;
        seedPanels(container, "e1", "e2", "e3");

        resizer.setupNoteSplitResizer(["e1", "e2", "e3"]);
        flushRaf();
        expect(SplitMock).toHaveBeenCalledTimes(1);

        // Removing one id from a 3-member group leaves 2 -> rebuild.
        resizer.delNoteSplitResizer(["e3"]);
        expect(destroy).toHaveBeenCalledTimes(1);
        flushRaf();
        expect(SplitMock).toHaveBeenCalledTimes(2);
        expect(SplitMock.mock.calls[1][0].map((p: HTMLElement) => p.getAttribute("data-ntx-id"))).toEqual(["e1", "e2"]);

        // Removing another leaves only 1 -> group is dropped, no rebuild.
        resizer.delNoteSplitResizer(["e2"]);
        expect(destroy).toHaveBeenCalledTimes(2);
        flushRaf();
        expect(SplitMock).toHaveBeenCalledTimes(2);

        // Unknown id -> early return.
        resizer.delNoteSplitResizer(["totally-unknown"]);
        flushRaf();
        expect(SplitMock).toHaveBeenCalledTimes(2);
    });
});
