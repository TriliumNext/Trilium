import { render as renderPreact } from "preact";
import { act } from "preact/test-utils";
import { afterEach, beforeEach, describe, expect, it, type MockInstance, vi } from "vitest";

vi.mock("./MobileNoteNavigator", () => ({ default: () => <div className="note-navigator-stub" /> }));
vi.mock("../LazyQuickSearch", () => ({ default: () => <div className="quick-search-stub" /> }));
// The peek button shows its shortcut, and the test server lists no keyboard actions.
vi.mock("../../services/keyboard_actions", () => ({
    default: { getAction: vi.fn().mockResolvedValue({ effectiveShortcuts: [] }), updateDisplayedShortcuts: vi.fn() }
}));

import appContext, { type EventData, type EventNames } from "../../components/app_context";
import type NoteContext from "../../components/note_context";
import options from "../../services/options";
import { handleSystemBack } from "../../services/system_back";
import { NARROW_LAYOUT, STACKED_TREE_LAYOUT } from "../../services/utils";
import { ParentComponent } from "../react/react_utils";
import MobileSidebar from "./MobileSidebar";
import { getTabNavigation } from "./tab_navigation";

describe("MobileSidebar", () => {
    let save: MockInstance<typeof options.save>;
    let rest: HTMLElement;
    let tree: HTMLElement;
    let triggerCommand: MockInstance<typeof appContext.triggerCommand>;

    beforeEach(() => {
        save = vi.spyOn(options, "save").mockResolvedValue(undefined);
        triggerCommand = vi.spyOn(appContext, "triggerCommand").mockImplementation(async () => undefined);
    });

    afterEach(() => {
        act(() => renderPreact(null, rest));
        document.body.innerHTML = "";
        vi.restoreAllMocks();
    });

    /** Renders the sidebar first in `#mobile-rest-container`, as the layout does. */
    function render(leftPaneVisible: boolean) {
        options.set("leftPaneVisible", leftPaneVisible.toString());
        rest = document.body.appendChild(document.createElement("div"));
        rest.id = "mobile-rest-container";
        act(() => renderPreact(<ParentComponent.Provider value={appContext}><MobileSidebar /></ParentComponent.Provider>, rest));
        const sidebar = rest.querySelector<HTMLElement>("#mobile-sidebar-wrapper");
        if (!sidebar) throw new Error("No sidebar");
        tree = sidebar;
        return sidebar;
    }

    function trigger<T extends EventNames>(name: T, data: EventData<T>) {
        act(() => { void appContext.triggerEvent(name, data); });
    }

    it("renders the quick search with the layout, and the note navigator after the first paint", async () => {
        render(true);
        expect(tree.querySelector(".quick-search-stub")).toBeInstanceOf(HTMLElement);
        expect(tree.querySelector(".note-navigator-stub")).toBeNull();
        await vi.waitFor(() => expect(tree.querySelector(".note-navigator-stub")).toBeInstanceOf(HTMLElement));
    });

    it("hides in tablet mode like the left pane, sharing its option", () => {
        expect(render(false).classList.contains("left-pane-hidden")).toBe(true);
        act(() => renderPreact(null, rest));

        const sidebar = render(true);
        expect(sidebar.classList.contains("left-pane-hidden")).toBe(false);

        // The launch bar's toggle follows the sidebar, as it follows the left pane on desktop.
        const modes: string[] = [];
        const triggerEvent = appContext.triggerEvent.bind(appContext);
        vi.spyOn(appContext, "triggerEvent").mockImplementation(async (name, data) => {
            if (name === "paneModeChanged") modes.push(`${(data as EventData<"paneModeChanged">).pane}:${(data as EventData<"paneModeChanged">).mode}`);
            return triggerEvent(name, data);
        });

        trigger("setLeftPaneVisibility", { leftPaneVisible: null });
        expect(sidebar.classList.contains("left-pane-hidden")).toBe(true);
        expect(save).toHaveBeenLastCalledWith("leftPaneVisible", "false");
        expect(modes).toEqual([ "left:closed" ]);

        trigger("setLeftPaneVisibility", { leftPaneVisible: null });
        expect(sidebar.classList.contains("left-pane-hidden")).toBe(false);
        expect(save).toHaveBeenLastCalledWith("leftPaneVisible", "true");
        expect(modes).toEqual([ "left:closed", "left:docked" ]);

        // The "hide/show panel" commands.
        trigger("setLeftPaneVisibility", { leftPaneVisible: false });
        expect(sidebar.classList.contains("left-pane-hidden")).toBe(true);
        trigger("setLeftPaneVisibility", { leftPaneVisible: true });
        expect(sidebar.classList.contains("left-pane-hidden")).toBe(false);

        // Showing an already visible sidebar leaves the option alone.
        save.mockClear();
        trigger("setLeftPaneVisibility", { leftPaneVisible: true });
        expect(sidebar.classList.contains("left-pane-hidden")).toBe(false);
        expect(save).not.toHaveBeenCalled();
    });

    it("resizes the docked tree by its gutter, keeping the width the tree takes, and has none while hidden", () => {
        options.set("mobileLeftPaneWidth", "320");
        const sidebar = render(true);
        expect(sidebar.style.getPropertyValue("--mobile-sidebar-width")).toBe("320px");
        const gutter = sidebar.nextElementSibling;
        if (!(gutter instanceof HTMLElement)) throw new Error("No gutter");
        expect(gutter.classList.contains("mobile-sidebar-gutter")).toBe(true);
        gutter.setPointerCapture = vi.fn();

        // The stylesheet caps the width the drag asks for; the tree's own width is the one kept.
        vi.spyOn(sidebar, "getBoundingClientRect").mockReturnValue(new DOMRect(0, 0, 320, 600));
        act(() => { gutter.dispatchEvent(new PointerEvent("pointerdown", { pointerId: 1, bubbles: true })); });
        gutter.dispatchEvent(new PointerEvent("pointermove", { pointerId: 1, clientX: 412.4 }));
        expect(sidebar.style.getPropertyValue("--mobile-sidebar-width")).toBe("412px");
        vi.spyOn(sidebar, "getBoundingClientRect").mockReturnValue(new DOMRect(0, 0, 400, 600));
        act(() => { gutter.dispatchEvent(new PointerEvent("pointerup", { pointerId: 1 })); });
        expect(save).toHaveBeenLastCalledWith("mobileLeftPaneWidth", 400);
        expect(sidebar.style.getPropertyValue("--mobile-sidebar-width")).toBe("400px");

        // A tap without a drag keeps the width.
        save.mockClear();
        act(() => { gutter.dispatchEvent(new PointerEvent("pointerdown", { pointerId: 1, bubbles: true })); });
        act(() => { gutter.dispatchEvent(new PointerEvent("pointerup", { pointerId: 1 })); });
        expect(save).not.toHaveBeenCalled();

        trigger("setLeftPaneVisibility", { leftPaneVisible: false });
        expect(rest.querySelector(".mobile-sidebar-gutter")).toBeNull();
    });

    it("widens the docked tree towards the left in a right-to-left layout", () => {
        const sidebar = render(true);
        const gutter = sidebar.nextElementSibling;
        if (!(gutter instanceof HTMLElement)) throw new Error("No gutter");
        gutter.setPointerCapture = vi.fn();
        vi.spyOn(sidebar, "getBoundingClientRect").mockReturnValue(new DOMRect(600, 0, 320, 600));

        glob.isRtl = true;
        try {
            act(() => { gutter.dispatchEvent(new PointerEvent("pointerdown", { pointerId: 1, bubbles: true })); });
            gutter.dispatchEvent(new PointerEvent("pointermove", { pointerId: 1, clientX: 520 }));
            expect(sidebar.style.getPropertyValue("--mobile-sidebar-width")).toBe("400px");
        } finally {
            delete (glob as Partial<typeof glob>).isRtl;
        }
    });

    it("keeps the docked tree and the note in place as tabs switch", () => {
        render(true);
        triggerCommand.mockClear();
        trigger("activeContextChanged", {
            noteContext: { getMainContext: () => ({ ntxId: "docked-tab" }) } as unknown as NoteContext
        });
        expect(triggerCommand).not.toHaveBeenCalledWith("setActiveScreen", expect.anything());
    });

    it("peeks the closed tree over the note from the edge button, until a press outside, and docks it from the launch bar", async () => {
        const sidebar = render(false);
        expect(sidebar.classList.contains("left-pane-hidden")).toBe(true);
        await vi.waitFor(() => expect(sidebar.nextElementSibling?.classList.contains("left-pane-peek-button")).toBe(true));

        trigger("peekLeftPane", {});
        expect(sidebar.classList.contains("peek")).toBe(true);
        expect(sidebar.classList.contains("left-pane-hidden")).toBe(false);
        // A press inside the tree keeps it; one on the note dismisses it, which leaves the option alone.
        act(() => { sidebar.dispatchEvent(new PointerEvent("pointerdown", { bubbles: true })); });
        expect(sidebar.classList.contains("peek")).toBe(true);
        act(() => { document.body.dispatchEvent(new PointerEvent("pointerdown", { bubbles: true })); });
        expect(sidebar.classList.contains("left-pane-hidden")).toBe(true);
        expect(save).not.toHaveBeenCalledWith("leftPaneVisible", expect.anything());

        // The launch bar's toggle docks a peeked tree, which then has its gutter instead of the button.
        trigger("peekLeftPane", {});
        trigger("setLeftPaneVisibility", { leftPaneVisible: true });
        expect(sidebar.classList.contains("peek")).toBe(false);
        expect(sidebar.classList.contains("left-pane-hidden")).toBe(false);
        expect(save).toHaveBeenLastCalledWith("leftPaneVisible", "true");
        expect(rest.querySelector(".left-pane-peek-button")).toBeNull();
        expect(sidebar.nextElementSibling?.classList.contains("mobile-sidebar-gutter")).toBe(true);

        // A docked tree does not peek.
        trigger("peekLeftPane", {});
        expect(sidebar.classList.contains("peek")).toBe(false);
    });

    describe("on a phone", () => {
        let detail: HTMLElement;
        let isNarrow: boolean;
        let layoutListeners: Set<() => void>;

        beforeEach(() => {
            isNarrow = true;
            layoutListeners = new Set();
            vi.spyOn(window, "matchMedia").mockImplementation((query) => ({
                matches: isNarrow && (query === NARROW_LAYOUT || query === STACKED_TREE_LAYOUT),
                media: query,
                addEventListener: (_type: string, listener: () => void) => { layoutListeners.add(listener); },
                removeEventListener: vi.fn()
            }) as unknown as MediaQueryList);

        });

        function renderPhone() {
            const sidebar = render(true);
            detail = rest.appendChild(document.createElement("div"));
            detail.id = "detail-container";
            return sidebar;
        }

        // A transform on the note makes it a stacking context, which traps a dialog the note renders
        // under Bootstrap's backdrop.
        it("slides the note off the tree, which lies under it, and leaves no transform on it at rest", () => {
            renderPhone();

            trigger("activeScreenChanged", { activeScreen: "tree" });
            expect(detail.style.transform).toBe("translateX(100%)");
            expect(tree.style.transform).toBe("translateX(0%)");

            trigger("activeScreenChanged", { activeScreen: "detail" });
            expect(detail.style.transform).toBe("");
            expect(tree.style.transform).toBe("translateX(-30%)");
        });

        it("marks the body while the tree is open", () => {
            renderPhone();
            // A stacked tree has no gutter to resize it.
            expect(rest.querySelector(".mobile-sidebar-gutter")).toBeNull();

            trigger("activeScreenChanged", { activeScreen: "tree" });
            expect(tree.classList.contains("show")).toBe(true);
            expect(document.body.classList.contains("mobile-sidebar-open")).toBe(true);

            trigger("activeScreenChanged", { activeScreen: "detail" });
            expect(document.body.classList.contains("mobile-sidebar-open")).toBe(false);
        });

        it("marks the tree as dragged while a swipe from the edge reveals it", () => {
            renderPhone();
            const touch = (type: string, clientX: number) => document.dispatchEvent(
                Object.assign(new Event(type, { cancelable: true }), { touches: [ { clientX } ] }));

            touch("touchstart", 5);
            touch("touchmove", 40);
            expect(tree.classList.contains("dragging")).toBe(true);

            touch("touchmove", 80);
            touch("touchend", 80);
            expect(tree.classList.contains("dragging")).toBe(false);
        });

        it("leaves a swipe from the edge of a swipeable launch bar to the tabs", () => {
            renderPhone();
            const bar = document.body.appendChild(document.createElement("div"));
            bar.id = "launcher-pane";
            bar.className = "tab-swipe";
            const launcher = bar.appendChild(document.createElement("button"));
            const touch = (type: string, clientX: number) => launcher.dispatchEvent(
                Object.assign(new Event(type, { bubbles: true, cancelable: true }), { touches: [ { clientX } ] }));

            touch("touchstart", 5);
            touch("touchmove", 40);
            expect(tree.classList.contains("dragging")).toBe(false);
            touch("touchend", 40);

            bar.className = "";
            touch("touchstart", 5);
            touch("touchmove", 40);
            expect(tree.classList.contains("dragging")).toBe(true);
            touch("touchend", 40);
        });

        it("goes back from the note to the tree on the system back, and not from the tree", () => {
            renderPhone();

            expect(handleSystemBack()).toBe(true);
            expect(triggerCommand).toHaveBeenCalledWith("setActiveScreen", { screen: "tree" });

            triggerCommand.mockClear();
            trigger("activeScreenChanged", { activeScreen: "tree" });
            handleSystemBack();
            expect(triggerCommand).not.toHaveBeenCalled();
        });

        it("shows each tab on the screen it was left on", () => {
            renderPhone();
            const switchTo = (ntxId: string) => trigger("activeContextChanged", {
                noteContext: { getMainContext: () => ({ ntxId }) } as unknown as NoteContext
            });

            switchTo("first");
            trigger("activeScreenChanged", { activeScreen: "tree" });

            switchTo("second");
            expect(triggerCommand).toHaveBeenLastCalledWith("setActiveScreen", { screen: "detail" });
            trigger("activeScreenChanged", { activeScreen: "detail" });

            switchTo("first");
            expect(triggerCommand).toHaveBeenLastCalledWith("setActiveScreen", { screen: "tree" });

            // The tab switcher reads the screen of every tab, the active one included.
            trigger("activeScreenChanged", { activeScreen: "tree" });
            expect(getTabNavigation("first")?.screen).toBe("tree");
            expect(getTabNavigation("second")?.screen).toBe("detail");
            trigger("noteContextRemoved", { ntxIds: [ "first" ] });
            expect(getTabNavigation("first")).toBeUndefined();
        });

        // Restoring tabs at startup and opening a note in a new tab activate the tab without
        // `activeContextChanged`.
        it("follows a tab activated together with its note", () => {
            renderPhone();
            const noteContext = { getMainContext: () => ({ ntxId: "opened" }) } as unknown as NoteContext;

            trigger("noteSwitchedAndActivated", { noteContext, notePath: "root/note" });
            expect(triggerCommand).toHaveBeenLastCalledWith("setActiveScreen", { screen: "detail" });
            trigger("activeScreenChanged", { activeScreen: "tree" });
            expect(getTabNavigation("opened")?.screen).toBe("tree");
        });

        it("shows the tree of a tab left without a note, but not of a split or a tab in the background", () => {
            renderPhone();
            const context = (ntxId: string, isMainContext = true) => ({
                ntxId,
                isMainContext: () => isMainContext,
                getMainContext: () => ({ ntxId: isMainContext ? ntxId : "blank" })
            }) as unknown as NoteContext;

            trigger("activeContextChanged", { noteContext: context("blank") });
            expect(triggerCommand).toHaveBeenLastCalledWith("setActiveScreen", { screen: "detail" });
            trigger("activeScreenChanged", { activeScreen: "detail" });

            // A tab opened in the background, and a split opened empty in the active tab.
            triggerCommand.mockClear();
            trigger("noteSwitched", { noteContext: context("background"), notePath: null });
            trigger("noteSwitched", { noteContext: context("split", false), notePath: null });
            trigger("noteSwitched", { noteContext: context("blank"), notePath: "root/note" });
            expect(triggerCommand).not.toHaveBeenCalled();

            trigger("noteSwitched", { noteContext: context("blank"), notePath: null });
            expect(triggerCommand).toHaveBeenLastCalledWith("setActiveScreen", { screen: "tree" });
            expect(tree.classList.contains("show")).toBe(true);
        });

        it("swaps the screen in place on a tab switch, and slides it within a tab", () => {
            renderPhone();
            const rest = tree.parentElement;
            if (!rest) throw new Error("No container");
            const flushes: { instant: boolean, transform: string }[] = [];
            Object.defineProperty(rest, "offsetWidth", { get: () => {
                flushes.push({ instant: rest.classList.contains("instant-screen-change"), transform: detail.style.transform });
                return 0;
            } });
            const switchTo = (ntxId: string) => trigger("activeContextChanged", {
                noteContext: { getMainContext: () => ({ ntxId }) } as unknown as NoteContext
            });

            switchTo("swap-tree");
            trigger("activeScreenChanged", { activeScreen: "tree" });
            switchTo("swap-note");
            trigger("activeScreenChanged", { activeScreen: "detail" });
            flushes.length = 0;

            switchTo("swap-tree");
            expect(flushes).toEqual([ { instant: true, transform: "translateX(100%)" } ]);
            expect(rest.classList.contains("instant-screen-change")).toBe(false);

            flushes.length = 0;
            trigger("activeScreenChanged", { activeScreen: "detail" });
            expect(flushes).toEqual([]);
            expect(detail.style.transform).toBe("");
        });

        it("puts the tree back beside the note once the screen widens to a tablet", () => {
            renderPhone();
            trigger("activeScreenChanged", { activeScreen: "tree" });
            expect(detail.style.transform).toBe("translateX(100%)");

            isNarrow = false;
            act(() => { for (const listener of layoutListeners) listener(); });
            expect(detail.style.transform).toBe("");
            expect(tree.style.transform).toBe("");
        });
    });
});
