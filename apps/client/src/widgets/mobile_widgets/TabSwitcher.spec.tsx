import { render } from "preact";
import { useRef } from "preact/hooks";
import { act } from "preact/test-utils";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const tabBarModal = vi.hoisted(() => ({ loaded: false }));
vi.mock("./TabBarModal", async (importOriginal) => {
    tabBarModal.loaded = true;
    return await importOriginal<typeof import("./TabBarModal")>();
});

import appContext from "../../components/app_context";
import type NoteContext from "../../components/note_context";
import { buildNote } from "../../test/easy-froca";
import { renderInto } from "../../test/render";
import { ParentComponent } from "../react/react_utils";
import TabSwitcher, { getSwipeDirection, useLaunchBarTabSwipe } from "./TabSwitcher";


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
        const tabs = [ "a", "b", "c" ].map((ntxId) => ({ ntxId }) as NoteContext);
        let activeNtxId = "b";
        appContext.tabManager = {
            getMainNoteContexts: () => tabs,
            getActiveMainContext: () => tabs.find((tab) => tab.ntxId === activeNtxId)
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

        // The first tab has no tab before it, and the swipe toward one is not a tap either.
        activeNtxId = "a";
        press(button, 900, [ [ 910, 200 ], [ 960, 400 ] ]);
        expect(triggerCommand).toHaveBeenCalledTimes(3);
        expect(onTap).toHaveBeenCalledTimes(1);
        activeNtxId = "b";

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
        const tabs = [ { ntxId: "a" }, { ntxId: "b" } ];
        appContext.tabManager = {
            getMainNoteContexts: () => tabs,
            getActiveMainContext: () => tabs[0]
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

describe("TabSwitcher", () => {
    afterEach(() => {
        vi.restoreAllMocks();
    });

    it("counts no tabs before the tab manager exists, and the tabs once they are created", () => {
        vi.spyOn(appContext, "tabManager", "get").mockReturnValue(undefined as never);
        const launcherNote = buildNote({ id: "_lbMobileTabSwitcher", title: "Tabs", type: "launcher" });
        const container = renderInto(
            <ParentComponent.Provider value={appContext}><TabSwitcher launcherNote={launcherNote} /></ParentComponent.Provider>
        );
        const button = container.querySelector(".mobile-tab-switcher");
        expect(button?.getAttribute("data-tab-count")).toBe("0");

        const noteContexts = [ {}, {} ] as NoteContext[];
        vi.spyOn(appContext, "tabManager", "get").mockReturnValue({ getMainNoteContexts: () => noteContexts } as never);
        act(() => { appContext.triggerEvent("newNoteContextCreated", { noteContext: noteContexts[1] }); });
        expect(button?.getAttribute("data-tab-count")).toBe("2");
    });

    it("loads the tab grid once the pointer enters the button, and shows it on a tap", async () => {
        const launcherNote = buildNote({ id: "_lbMobileTabSwitcher", title: "Tabs", type: "launcher" });
        const container = renderInto(
            <ParentComponent.Provider value={appContext}><TabSwitcher launcherNote={launcherNote} /></ParentComponent.Provider>
        );
        await act(async () => { await new Promise((resolve) => setTimeout(resolve)); });
        expect(tabBarModal.loaded).toBe(false);

        const button = container.querySelector<HTMLElement>(".mobile-tab-switcher");
        expect(button).not.toBeNull();
        button?.dispatchEvent(new PointerEvent("pointerenter"));
        await vi.waitFor(() => expect(tabBarModal.loaded).toBe(true));

        act(() => button?.click());
        await vi.waitFor(() => expect(document.querySelector(".modal.tab-bar-modal")).not.toBeNull());
    });
});
