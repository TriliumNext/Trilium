import { render as renderPreact } from "preact";
import { act } from "preact/test-utils";
import { afterEach, beforeEach, describe, expect, it, type MockInstance, vi } from "vitest";

vi.mock("./MobileNoteNavigator", () => ({ default: () => <div className="note-navigator-stub" /> }));
vi.mock("../LazyQuickSearch", () => ({ default: () => <div className="quick-search-stub" /> }));

import appContext, { type EventData, type EventNames } from "../../components/app_context";
import type NoteContext from "../../components/note_context";
import options from "../../services/options";
import { handleSystemBack } from "../../services/system_back";
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

        // The sidebar toggle in the title row.
        trigger("setLeftPaneVisibility", { leftPaneVisible: null });
        expect(sidebar.classList.contains("left-pane-hidden")).toBe(true);
        expect(save).toHaveBeenLastCalledWith("leftPaneVisible", "false");

        trigger("setLeftPaneVisibility", { leftPaneVisible: null });
        expect(sidebar.classList.contains("left-pane-hidden")).toBe(false);
        expect(save).toHaveBeenLastCalledWith("leftPaneVisible", "true");

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

    describe("on a phone", () => {
        let detail: HTMLElement;
        let isNarrow: boolean;
        let onLayoutChange: () => void;

        beforeEach(() => {
            isNarrow = true;
            onLayoutChange = () => {};
            vi.spyOn(window, "matchMedia").mockImplementation((query) => ({
                matches: isNarrow && query === "(max-width: 991px)",
                media: query,
                addEventListener: (_type: string, listener: () => void) => { onLayoutChange = listener; },
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
            onLayoutChange();
            expect(detail.style.transform).toBe("");
            expect(tree.style.transform).toBe("");
        });
    });
});
