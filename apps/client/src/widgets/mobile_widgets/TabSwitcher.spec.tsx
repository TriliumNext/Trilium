import { render } from "preact";
import { useRef } from "preact/hooks";
import { act } from "preact/test-utils";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import appContext from "../../components/app_context";
import type NoteContext from "../../components/note_context";
import froca from "../../services/froca";
import { buildNotes } from "../../test/easy-froca";
import { renderInto } from "../../test/render";
import { setTabScreen, setTabTree } from "./tab_navigation";
import { getSwipeDirection, Tab, useLaunchBarTabSwipe } from "./TabSwitcher";

describe("Tab", () => {
    buildNotes([
        { id: "folder", title: "Folder", children: [
            { id: "first", title: "First" },
            { id: "second", title: "Second" }
        ] },
        { id: "collection", title: "Collection", "#subtreeHidden": "", children: [
            { id: "shown", title: "Shown" },
            { id: "spotlit", title: "Spotlit" }
        ] }
    ]);

    let isNarrow: boolean;

    beforeEach(() => {
        isNarrow = true;
        vi.spyOn(window, "matchMedia").mockImplementation((query) => ({
            matches: isNarrow && query === "(max-width: 991px)",
            media: query,
            addEventListener: vi.fn(),
            removeEventListener: vi.fn()
        }) as unknown as MediaQueryList);
    });

    afterEach(() => {
        vi.restoreAllMocks();
    });

    async function renderTab(ntxId: string) {
        const noteContext = {
            ntxId,
            note: froca.getNoteFromCache("second"),
            notePath: "root/folder/second",
            isMainContext: () => true,
            getNavigationTitle: async () => null
        } as unknown as NoteContext;
        noteContext.getSubContexts = () => [ noteContext ];

        const container = renderInto(<Tab noteContext={noteContext} containerRef={() => {}} selectTab={() => {}} activeNtxId={ntxId} />);
        await act(async () => {});
        return container;
    }

    it("shows the tree column a tab was left on, with the tab's note highlighted", async () => {
        setTabTree("on-tree", { notePath: "root/folder/second", hoistedNoteId: "root", stack: [ "root", "root/folder" ] });
        setTabScreen("on-tree", "tree");

        const card = await renderTab("on-tree");
        expect(card.querySelectorAll("header")).toHaveLength(1);
        expect(card.querySelector("header .title")?.textContent).toBe("Folder");
        const rows = await vi.waitFor(() => {
            const rows = [ ...card.querySelectorAll(".tab-preview.type-tree .tree-row") ];
            expect(rows).toHaveLength(2);
            return rows;
        });
        expect(rows.map((row) => row.textContent)).toEqual([ "First", "Second" ]);
        expect(rows.map((row) => row.classList.contains("active"))).toEqual([ false, true ]);
        expect(card.querySelector(".tab-preview-placeholder")).toBeNull();
    });

    it("lists only the child on the tab's note path in a column whose subtree is hidden", async () => {
        setTabTree("in-collection", { notePath: "root/collection/spotlit", hoistedNoteId: "root", stack: [ "root", "root/collection" ] });
        setTabScreen("in-collection", "tree");

        const card = await renderTab("in-collection");
        const rows = await vi.waitFor(() => {
            const rows = [ ...card.querySelectorAll(".tab-preview.type-tree .tree-row") ];
            expect(rows).toHaveLength(1);
            return rows;
        });
        expect(rows[0].textContent).toBe("Spotlit");
        expect(rows[0].classList.contains("active")).toBe(true);
        expect(card.querySelector(".tab-preview-placeholder")).toBeNull();

        setTabTree("off-collection", { notePath: "root/folder/second", hoistedNoteId: "root", stack: [ "root", "root/collection" ] });
        setTabScreen("off-collection", "tree");
        const offCard = await renderTab("off-collection");
        expect(offCard.querySelector(".tab-preview-placeholder")).not.toBeNull();
        expect(offCard.querySelectorAll(".tree-row")).toHaveLength(0);
    });

    it("shows the note of a tab left on it, and on a tablet whatever the tab was left on", async () => {
        setTabTree("on-note", { notePath: "root/folder/second", hoistedNoteId: "root", stack: [ "root", "root/folder" ] });
        setTabScreen("on-note", "detail");
        expect((await renderTab("on-note")).querySelector("header .title")?.textContent).toBe("Second");

        isNarrow = false;
        setTabScreen("on-note", "tree");
        const card = await renderTab("on-note");
        expect(card.querySelector("header .title")?.textContent).toBe("Second");
        expect(card.querySelector(".type-tree")).toBeNull();
    });
});

describe("tab swipe", () => {
    beforeEach(() => {
        glob.isRtl = false;
    });

    afterEach(() => {
        vi.restoreAllMocks();
    });

    it("takes a level swipe toward the start for the next tab", () => {
        expect(getSwipeDirection(-20, 5, false)).toBe("next");
        expect(getSwipeDirection(20, 5, false)).toBe("previous");
        expect(getSwipeDirection(20, 5, true)).toBe("next");
        expect(getSwipeDirection(-5, 0, false)).toBeUndefined();
        expect(getSwipeDirection(-40, 30, false)).toBeUndefined();
    });

    it("switches tabs on a swipe anywhere on a launch bar that fits, whose click then is not a tap", () => {
        const triggerCommand = vi.spyOn(appContext, "triggerCommand").mockResolvedValue(undefined);
        const tabManager = appContext.tabManager;
        const fakeContext = (ntxId: string) => ({ ntxId }) as NoteContext;
        appContext.tabManager = {
            getMainNoteContexts: () => [ fakeContext("a"), fakeContext("b") ]
        } as unknown as typeof appContext.tabManager;
        const onTap = vi.fn();
        function LaunchBar() {
            const containerRef = useRef<HTMLDivElement>(null);
            useLaunchBarTabSwipe(containerRef, true);
            return <div id="launcher-pane"><div ref={containerRef}><button onClick={onTap} /></div></div>;
        }
        // Each move is [ clientX, ms since the press ]; the finger lifts `liftAfter` ms after the last.
        const press = (button: HTMLButtonElement, startX: number, moves: [ number, number ][], liftAfter = 200) => {
            const send = (type: string, clientX: number, time: number) => {
                const event = new PointerEvent(type, { bubbles: true, isPrimary: true, pointerId: 1, clientX, clientY: 10 });
                Object.defineProperty(event, "timeStamp", { value: time });
                button.dispatchEvent(event);
            };
            send("pointerdown", startX, 0);
            for (const [ clientX, time ] of moves) send("pointermove", clientX, time);
            const [ lastX, lastTime ] = moves.at(-1) ?? [ startX, 0 ];
            send("pointerup", lastX, lastTime + liftAfter);
            button.click();
        };

        let bar = document.createElement("div");
        act(() => {
            bar = renderInto(<LaunchBar />);
        });
        const button = bar.querySelector("button");
        if (!button) throw new Error("No button");
        expect(bar.querySelector("#launcher-pane")?.classList.contains("tab-swipe")).toBe(true);

        // Without view transitions, the tab switches on release. The window is 1024px wide, and a
        // swipe has the room from where it starts to the edge it heads for.
        press(button, 600, [ [ 590, 200 ], [ 560, 400 ] ]);
        expect(triggerCommand).not.toHaveBeenCalled();
        press(button, 900, [ [ 910, 200 ], [ 960, 400 ] ]);
        expect(triggerCommand.mock.calls).toEqual([ [ "activatePreviousTab" ] ]);
        press(button, 600, [ [ 590, 200 ], [ 300, 400 ] ]);
        expect(triggerCommand).toHaveBeenLastCalledWith("activateNextTab");
        press(button, 600, [ [ 620, 16 ], [ 670, 32 ] ], 8);
        expect(triggerCommand).toHaveBeenLastCalledWith("activatePreviousTab");
        expect(triggerCommand).toHaveBeenCalledTimes(3);
        expect(onTap).not.toHaveBeenCalled();

        press(button, 600, []);
        expect(onTap).toHaveBeenCalledTimes(1);

        // A bar with more launchers than fit scrolls sideways instead.
        const scroller = button.parentElement;
        if (!scroller) throw new Error("No container");
        Object.defineProperty(scroller, "scrollWidth", { value: 500 });
        Object.defineProperty(scroller, "clientWidth", { value: 300 });
        press(button, 600, [ [ 590, 200 ], [ 300, 400 ] ]);
        expect(triggerCommand).toHaveBeenCalledTimes(3);
        expect(onTap).toHaveBeenCalledTimes(2);
        expect(bar.querySelector("#launcher-pane")?.classList.contains("tab-swipe")).toBe(false);

        appContext.tabManager = tabManager;
    });

    it("ends a swipe released off the launch bar, and one still running as the bar unmounts", () => {
        const triggerCommand = vi.spyOn(appContext, "triggerCommand").mockResolvedValue(undefined);
        const tabManager = appContext.tabManager;
        appContext.tabManager = {
            getMainNoteContexts: () => [ { ntxId: "a" }, { ntxId: "b" } ]
        } as unknown as typeof appContext.tabManager;
        function LaunchBar() {
            const containerRef = useRef<HTMLDivElement>(null);
            useLaunchBarTabSwipe(containerRef, true);
            return <div id="launcher-pane"><div ref={containerRef}><button /></div></div>;
        }
        const send = (target: EventTarget, type: string, clientX: number) => {
            target.dispatchEvent(new PointerEvent(type, { bubbles: true, isPrimary: true, pointerId: 1, clientX, clientY: 10 }));
        };

        let bar = document.createElement("div");
        act(() => {
            bar = renderInto(<LaunchBar />);
        });
        const button = bar.querySelector("button");
        if (!button) throw new Error("No button");

        send(button, "pointerdown", 600);
        send(button, "pointermove", 590);
        send(document.body, "pointermove", 300);
        send(document.body, "pointerup", 300);
        expect(triggerCommand.mock.calls).toEqual([ [ "activateNextTab" ] ]);

        send(button, "pointerdown", 600);
        send(button, "pointermove", 590);
        send(button, "pointermove", 300);
        act(() => render(null, bar));
        expect(triggerCommand.mock.calls).toEqual([ [ "activateNextTab" ], [ "activateNextTab" ] ]);

        appContext.tabManager = tabManager;
    });
});
