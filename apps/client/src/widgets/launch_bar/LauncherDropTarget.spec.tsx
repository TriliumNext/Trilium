import { render } from "preact";
import { useRef } from "preact/hooks";
import { act } from "preact/test-utils";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import branches from "../../services/branches";
import { buildNote } from "../../test/easy-froca";
import { TREE_CLIPBOARD_TYPE } from "../react/hooks";
import LauncherDropTarget, {
    dropNotesOnLaunchBar, findInsertionPoint, getDropAnchor
} from "./LauncherDropTarget";

vi.mock("../../services/branches", () => ({
    default: {
        cloneNoteBefore: vi.fn(async () => {}),
        cloneNoteAfter: vi.fn(async () => {}),
        cloneNoteToParentNote: vi.fn(async () => {}),
        moveBeforeBranch: vi.fn(async () => {}),
        moveAfterBranch: vi.fn(async () => {}),
        moveToParentNote: vi.fn(async () => {})
    }
}));

const VISIBLE = "_lbVisibleLaunchers";

beforeEach(() => {
    vi.clearAllMocks();
    buildNote({
        id: "_lbRoot",
        title: "Launch bar",
        children: [
            {
                id: VISIBLE,
                title: "Visible launchers",
                children: [
                    { id: "a", title: "A", type: "launcher" },
                    { id: "b", title: "B", type: "launcher" },
                    { id: "c", title: "C", type: "launcher" }
                ]
            },
            {
                id: "_lbAvailableLaunchers",
                title: "Available launchers",
                children: [ { id: "hidden", title: "Hidden", type: "launcher" } ]
            }
        ]
    });
    buildNote({
        id: "_lbMobileVisibleLaunchers",
        title: "Mobile launchers",
        children: [ { id: "mobile", title: "Mobile", type: "launcher" } ]
    });
    buildNote({ id: "n1", title: "First" });
    buildNote({ id: "n2", title: "Second" });
});

describe("findInsertionPoint", () => {
    /** Three items 40 long with gaps of 10. */
    const spans = [ { start: 0, end: 40 }, { start: 50, end: 90 }, { start: 100, end: 140 } ];
    const wide = { start: -100, end: 300 };

    it("inserts before the first item whose middle is past the pointer", () => {
        expect(findInsertionPoint(spans, 30, wide)).toEqual({ index: 1, position: 45 });
        expect(findInsertionPoint(spans, 119, wide)).toEqual({ index: 2, position: 95 });
    });

    it("draws the line half a gap out at either end, within the bounds", () => {
        expect(findInsertionPoint(spans, 10, wide)).toEqual({ index: 0, position: -5 });
        expect(findInsertionPoint(spans, 120, wide)).toEqual({ index: 3, position: 145 });

        const tight = { start: 0, end: 142 };
        expect(findInsertionPoint(spans, 10, tight)).toEqual({ index: 0, position: 0 });
        expect(findInsertionPoint(spans, 500, tight)).toEqual({ index: 3, position: 142 });
    });

    it("handles a bar with one item or none", () => {
        expect(findInsertionPoint([ { start: 0, end: 40 } ], 30, wide))
            .toEqual({ index: 1, position: 40 });
        expect(findInsertionPoint([], 30, wide)).toEqual({ index: 0, position: -100 });
    });
});

describe("getDropAnchor", () => {
    const shown = [ "a", "b", "c" ];

    it("places the notes before the launcher at the index, or after the last one", () => {
        expect(getDropAnchor(shown, 1, [ "n1" ])).toEqual({ side: "before", noteId: "b" });
        expect(getDropAnchor(shown, 3, [ "n1" ])).toEqual({ side: "after", noteId: "c" });
    });

    it("never anchors on a note being dropped", () => {
        expect(getDropAnchor(shown, 1, [ "b" ])).toEqual({ side: "before", noteId: "c" });
        expect(getDropAnchor(shown, 2, [ "c" ])).toEqual({ side: "after", noteId: "b" });
        expect(getDropAnchor([ "a" ], 0, [ "a" ])).toEqual({ side: "end" });
        expect(getDropAnchor([], 0, [ "n1" ])).toEqual({ side: "end" });
    });
});

describe("dropNotesOnLaunchBar", () => {
    it("clones the notes next to the anchor, keeping their order", async () => {
        await dropNotesOnLaunchBar([ "n1", "n2" ], VISIBLE, { side: "before", noteId: "b" });
        expect(vi.mocked(branches.cloneNoteBefore).mock.calls).toEqual([
            [ "n1", `${VISIBLE}_b` ],
            [ "n2", `${VISIBLE}_b` ]
        ]);

        await dropNotesOnLaunchBar([ "n1", "n2" ], VISIBLE, { side: "after", noteId: "c" });
        expect(vi.mocked(branches.cloneNoteAfter).mock.calls).toEqual([
            [ "n2", `${VISIBLE}_c` ],
            [ "n1", `${VISIBLE}_c` ]
        ]);

        await dropNotesOnLaunchBar([ "n1" ], VISIBLE, { side: "end" });
        expect(branches.cloneNoteToParentNote).toHaveBeenCalledWith("n1", VISIBLE);
    });

    it("moves a launcher of this bar, shown or hidden, and skips one of another bar", async () => {
        const beforeC = { side: "before", noteId: "c" } as const;
        await dropNotesOnLaunchBar([ "a", "hidden", "mobile" ], VISIBLE, beforeC);
        expect(vi.mocked(branches.moveBeforeBranch).mock.calls).toEqual([
            [ [ `${VISIBLE}_a` ], `${VISIBLE}_c` ],
            [ [ "_lbAvailableLaunchers_hidden" ], `${VISIBLE}_c` ]
        ]);

        await dropNotesOnLaunchBar([ "hidden" ], VISIBLE, { side: "end" });
        expect(branches.moveToParentNote)
            .toHaveBeenCalledWith([ "_lbAvailableLaunchers_hidden" ], `_lbRoot_${VISIBLE}`);

        expect(branches.cloneNoteBefore).not.toHaveBeenCalled();
        expect(branches.cloneNoteToParentNote).not.toHaveBeenCalled();
    });
});

describe("LauncherDropTarget", () => {
    let container: HTMLDivElement | undefined;

    afterEach(() => {
        const mounted = container;
        if (mounted) {
            act(() => render(null, mounted));
            mounted.remove();
            container = undefined;
        }
        vi.useRealTimers();
    });

    /**
     * Mounts a bar of the given launchers, each slot holding one element measured at its rect. An
     * element without a rect measures zero, like a launcher that renders an empty element.
     */
    function mountBar(
        launchers: Record<string, DOMRect | null>,
        barRect: DOMRect,
        isHorizontalLayout = false
    ) {
        function Harness() {
            const ref = useRef<HTMLDivElement>(null);
            return (
                <div ref={ref} className="bar">
                    {Object.keys(launchers).map((noteId) => (
                        <div key={noteId} className="launcher-slot" data-launcher-id={noteId}>
                            <button type="button" />
                        </div>
                    ))}
                    <LauncherDropTarget
                        containerRef={ref}
                        parentNoteId={VISIBLE}
                        isHorizontalLayout={isHorizontalLayout}
                    />
                </div>
            );
        }

        const host = document.createElement("div");
        container = host;
        document.body.appendChild(host);
        act(() => render(<Harness />, host));

        const bar = host.querySelector<HTMLElement>(".bar");
        if (!bar) throw new Error("The bar did not render.");
        bar.getBoundingClientRect = () => barRect;
        for (const [ noteId, rect ] of Object.entries(launchers)) {
            const button = bar.querySelector(`[data-launcher-id="${noteId}"] button`);
            if (button && rect) {
                button.getBoundingClientRect = () => rect;
            }
        }
        return bar;
    }

    /** A vertical bar 53 wide with launchers 40 tall and gaps of 10, and one of zero size. */
    function mountVerticalBar() {
        return mountBar({
            a: new DOMRect(6, 10, 41, 40),
            empty: null,
            b: new DOMRect(6, 60, 41, 40),
            c: new DOMRect(6, 110, 41, 40)
        }, new DOMRect(0, 0, 53, 400));
    }

    function drag(target: Element, type: string, init: {
        x?: number,
        y?: number,
        types?: string[],
        text?: string,
        relatedTarget?: EventTarget | null
    } = {}) {
        const event = new Event(type, { bubbles: true, cancelable: true });
        for (const [ name, value ] of Object.entries({
            clientX: init.x ?? 0,
            clientY: init.y ?? 0,
            relatedTarget: init.relatedTarget ?? null,
            dataTransfer: {
                types: init.types ?? [ TREE_CLIPBOARD_TYPE ],
                dropEffect: "none",
                getData: (format: string) => (format === "text" ? init.text ?? "" : "")
            }
        })) {
            Object.defineProperty(event, name, { value, configurable: true });
        }
        act(() => {
            target.dispatchEvent(event);
        });
        return event;
    }

    function indicator() {
        return document.body.querySelector<HTMLElement>(".launcher-drop-indicator");
    }

    it("draws the line where a dragged note goes, outside the bar's own layout", () => {
        const bar = mountVerticalBar();

        // Above the middle of B, so between A and B.
        const event = drag(bar, "dragover", { y: 70 });
        expect(event.defaultPrevented).toBe(true);
        const line = indicator();
        expect(line).not.toBeNull();
        expect(bar.contains(line)).toBe(false);
        expect(line?.dataset.axis).toBe("y");
        expect(line?.style.top).toBe("55px");
        expect(line?.style.left).toBe("0px");
        expect(line?.style.width).toBe("53px");
        expect(line?.style.height).toBe("0px");

        // Past the middle of C, so after the last launcher.
        drag(bar, "dragover", { y: 140 });
        expect(indicator()?.style.top).toBe("155px");
    });

    it("ignores a drag that holds no notes", () => {
        const bar = mountVerticalBar();

        const event = drag(bar, "dragover", { y: 70, types: [ "Files" ] });
        expect(event.defaultPrevented).toBe(false);
        expect(indicator()).toBeNull();
    });

    it("removes the line once the drag leaves the bar or stops arriving", () => {
        vi.useFakeTimers();
        const bar = mountVerticalBar();
        const launcher = bar.querySelector("button");
        expect(launcher).not.toBeNull();

        drag(bar, "dragover", { y: 70 });
        drag(bar, "dragleave", { relatedTarget: launcher });
        expect(indicator()).not.toBeNull();
        drag(bar, "dragleave", { relatedTarget: document.body });
        expect(indicator()).toBeNull();

        drag(bar, "dragover", { y: 70 });
        act(() => {
            vi.advanceTimersByTime(500);
        });
        expect(indicator()).not.toBeNull();
        act(() => {
            vi.advanceTimersByTime(600);
        });
        expect(indicator()).toBeNull();
    });

    it("drops the notes where the line is, skipping launchers that render nothing", async () => {
        const bar = mountVerticalBar();
        const text = JSON.stringify([ { noteId: "n1", branchId: "root_n1", title: "First" } ]);

        drag(bar, "dragover", { y: 70 });
        const event = drag(bar, "drop", { y: 70, text });
        await act(async () => {
            await new Promise((resolve) => setTimeout(resolve));
        });

        expect(event.defaultPrevented).toBe(true);
        expect(indicator()).toBeNull();
        expect(branches.cloneNoteBefore).toHaveBeenCalledWith("n1", `${VISIBLE}_b`);

        drag(bar, "drop", { y: 70, text: "not json" });
        await act(async () => {
            await new Promise((resolve) => setTimeout(resolve));
        });
        expect(branches.cloneNoteBefore).toHaveBeenCalledTimes(1);
    });

    it("follows a right-to-left horizontal bar in its reading order", () => {
        // The launchers run leftwards from the right end.
        const bar = mountBar({
            a: new DOMRect(300, 6, 40, 41),
            b: new DOMRect(250, 6, 40, 41),
            c: new DOMRect(200, 6, 40, 41)
        }, new DOMRect(0, 0, 400, 53), true);
        bar.style.direction = "rtl";

        // Right of the middle of B, so between A and B.
        drag(bar, "dragover", { x: 285 });
        expect(indicator()?.dataset.axis).toBe("x");
        expect(indicator()?.style.left).toBe("295px");
        expect(indicator()?.style.height).toBe("53px");

        drag(bar, "dragover", { x: 255 });
        expect(indicator()?.style.left).toBe("245px");
    });

    it("scrolls the bar while a note is held near its end, and moves the line with it", () => {
        vi.useFakeTimers();
        const bar = mountVerticalBar();
        for (const [ name, value ] of Object.entries({ clientHeight: 400, scrollHeight: 1000 })) {
            Object.defineProperty(bar, name, { value, configurable: true });
        }

        drag(bar, "dragover", { y: 395 });
        act(() => {
            vi.advanceTimersByTime(200);
        });
        expect(bar.scrollTop).toBeGreaterThan(0);

        // The launchers moved up under a still pointer.
        const lineBefore = indicator()?.style.top;
        for (const [ index, button ] of [ ...bar.querySelectorAll("button") ].entries()) {
            button.getBoundingClientRect = () => new DOMRect(6, 300 + index * 50, 41, 40);
        }
        act(() => {
            bar.dispatchEvent(new Event("scroll"));
        });
        expect(indicator()?.style.top).not.toBe(lineBefore);

        // Leaving the bar stops the scrolling.
        drag(bar, "dragleave", { relatedTarget: document.body });
        const scrolled = bar.scrollTop;
        act(() => {
            vi.advanceTimersByTime(200);
        });
        expect(bar.scrollTop).toBe(scrolled);
    });
});
