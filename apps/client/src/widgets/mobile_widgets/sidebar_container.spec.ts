import { afterEach, beforeEach, describe, expect, it, type MockInstance, vi } from "vitest";

import type NoteContext from "../../components/note_context";
import options from "../../services/options";
import { handleSystemBack } from "../../services/system_back";
import SidebarContainer from "./sidebar_container";
import { getTabNavigation } from "./tab_navigation";

describe("SidebarContainer", () => {
    let save: MockInstance<typeof options.save>;

    beforeEach(() => {
        save = vi.spyOn(options, "save").mockResolvedValue(undefined);
    });

    afterEach(() => {
        vi.restoreAllMocks();
    });

    function render(leftPaneVisible: boolean) {
        options.set("leftPaneVisible", leftPaneVisible.toString());
        const sidebar = new SidebarContainer("tree", "column");
        sidebar.render();
        return sidebar;
    }

    it("hides in tablet mode like the left pane, sharing its option", () => {
        expect(render(false).$widget.hasClass("left-pane-hidden")).toBe(true);

        const sidebar = render(true);
        expect(sidebar.$widget.hasClass("left-pane-hidden")).toBe(false);

        // The sidebar toggle in the title row.
        sidebar.setLeftPaneVisibilityEvent({ leftPaneVisible: null });
        expect(sidebar.$widget.hasClass("left-pane-hidden")).toBe(true);
        expect(save).toHaveBeenLastCalledWith("leftPaneVisible", "false");

        sidebar.setLeftPaneVisibilityEvent({ leftPaneVisible: null });
        expect(sidebar.$widget.hasClass("left-pane-hidden")).toBe(false);
        expect(save).toHaveBeenLastCalledWith("leftPaneVisible", "true");

        // The "hide/show panel" commands.
        sidebar.setLeftPaneVisibilityEvent({ leftPaneVisible: false });
        expect(sidebar.$widget.hasClass("left-pane-hidden")).toBe(true);
        sidebar.setLeftPaneVisibilityEvent({ leftPaneVisible: true });
        expect(sidebar.$widget.hasClass("left-pane-hidden")).toBe(false);

        // Showing an already visible sidebar leaves the option alone.
        save.mockClear();
        sidebar.setLeftPaneVisibilityEvent({ leftPaneVisible: true });
        expect(sidebar.$widget.hasClass("left-pane-hidden")).toBe(false);
        expect(save).not.toHaveBeenCalled();
    });

    describe("on a phone", () => {
        let tree: HTMLElement;
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

            const rest = document.body.appendChild(document.createElement("div"));
            rest.id = "mobile-rest-container";
            tree = rest.appendChild(document.createElement("div"));
            tree.id = "mobile-sidebar-wrapper";
            detail = rest.appendChild(document.createElement("div"));
            detail.id = "detail-container";
        });

        afterEach(() => {
            document.body.innerHTML = "";
        });

        // A transform on the note makes it a stacking context, which traps a dialog the note renders
        // under Bootstrap's backdrop.
        it("slides the note off the tree, which lies under it, and leaves no transform on it at rest", () => {
            const sidebar = render(true);

            sidebar.activeScreenChangedEvent({ activeScreen: "tree" });
            expect(detail.style.transform).toBe("translateX(100%)");
            expect(tree.style.transform).toBe("translateX(0%)");

            sidebar.activeScreenChangedEvent({ activeScreen: "detail" });
            expect(detail.style.transform).toBe("");
            expect(tree.style.transform).toBe("translateX(-30%)");
        });

        it("marks the body while the tree is open", () => {
            const sidebar = render(true);

            sidebar.activeScreenChangedEvent({ activeScreen: "tree" });
            expect(tree.classList.contains("show")).toBe(true);
            expect(document.body.classList.contains("mobile-sidebar-open")).toBe(true);

            sidebar.activeScreenChangedEvent({ activeScreen: "detail" });
            expect(document.body.classList.contains("mobile-sidebar-open")).toBe(false);
        });

        it("marks the tree as dragged while a swipe from the edge reveals it", () => {
            render(true);
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
            render(true);
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
            const sidebar = render(true);
            const triggerCommand = vi.spyOn(sidebar, "triggerCommand").mockImplementation(() => undefined);

            expect(handleSystemBack()).toBe(true);
            expect(triggerCommand).toHaveBeenCalledWith("setActiveScreen", { screen: "tree" });

            triggerCommand.mockClear();
            sidebar.activeScreenChangedEvent({ activeScreen: "tree" });
            handleSystemBack();
            expect(triggerCommand).not.toHaveBeenCalled();
        });

        it("shows each tab on the screen it was left on", () => {
            const sidebar = render(true);
            const triggerCommand = vi.spyOn(sidebar, "triggerCommand").mockImplementation(() => undefined);
            const switchTo = (ntxId: string) => sidebar.activeContextChangedEvent({
                noteContext: { getMainContext: () => ({ ntxId }) } as unknown as NoteContext
            });

            switchTo("first");
            sidebar.activeScreenChangedEvent({ activeScreen: "tree" });

            switchTo("second");
            expect(triggerCommand).toHaveBeenLastCalledWith("setActiveScreen", { screen: "detail" });
            sidebar.activeScreenChangedEvent({ activeScreen: "detail" });

            switchTo("first");
            expect(triggerCommand).toHaveBeenLastCalledWith("setActiveScreen", { screen: "tree" });

            // The tab switcher reads the screen of every tab, the active one included.
            sidebar.activeScreenChangedEvent({ activeScreen: "tree" });
            expect(getTabNavigation("first")?.screen).toBe("tree");
            expect(getTabNavigation("second")?.screen).toBe("detail");
            sidebar.noteContextRemovedEvent({ ntxIds: [ "first" ] });
            expect(getTabNavigation("first")).toBeUndefined();
        });

        // Restoring tabs at startup and opening a note in a new tab activate the tab without
        // `activeContextChanged`.
        it("follows a tab activated together with its note", () => {
            const sidebar = render(true);
            const triggerCommand = vi.spyOn(sidebar, "triggerCommand").mockImplementation(() => undefined);
            const noteContext = { getMainContext: () => ({ ntxId: "opened" }) } as unknown as NoteContext;

            sidebar.noteSwitchedAndActivatedEvent({ noteContext, notePath: "root/note" });
            expect(triggerCommand).toHaveBeenLastCalledWith("setActiveScreen", { screen: "detail" });
            sidebar.activeScreenChangedEvent({ activeScreen: "tree" });
            expect(getTabNavigation("opened")?.screen).toBe("tree");
        });

        it("shows the tree of a tab left without a note, but not of a split or a tab in the background", () => {
            const sidebar = render(true);
            const triggerCommand = vi.spyOn(sidebar, "triggerCommand").mockImplementation(() => undefined);
            const context = (ntxId: string, isMainContext = true) => ({
                ntxId,
                isMainContext: () => isMainContext,
                getMainContext: () => ({ ntxId: isMainContext ? ntxId : "blank" })
            }) as unknown as NoteContext;

            sidebar.activeContextChangedEvent({ noteContext: context("blank") });
            expect(triggerCommand).toHaveBeenLastCalledWith("setActiveScreen", { screen: "detail" });
            sidebar.activeScreenChangedEvent({ activeScreen: "detail" });

            // A tab opened in the background, and a split opened empty in the active tab.
            triggerCommand.mockClear();
            sidebar.noteSwitchedEvent({ noteContext: context("background"), notePath: null });
            sidebar.noteSwitchedEvent({ noteContext: context("split", false), notePath: null });
            sidebar.noteSwitchedEvent({ noteContext: context("blank"), notePath: "root/note" });
            expect(triggerCommand).not.toHaveBeenCalled();

            sidebar.noteSwitchedEvent({ noteContext: context("blank"), notePath: null });
            expect(triggerCommand).toHaveBeenLastCalledWith("setActiveScreen", { screen: "tree" });
            expect(tree.classList.contains("show")).toBe(true);
        });

        it("swaps the screen in place on a tab switch, and slides it within a tab", () => {
            const sidebar = render(true);
            vi.spyOn(sidebar, "triggerCommand").mockImplementation(() => undefined);
            const rest = tree.parentElement;
            if (!rest) throw new Error("No container");
            const flushes: { instant: boolean, transform: string }[] = [];
            Object.defineProperty(rest, "offsetWidth", { get: () => {
                flushes.push({ instant: rest.classList.contains("instant-screen-change"), transform: detail.style.transform });
                return 0;
            } });
            const switchTo = (ntxId: string) => sidebar.activeContextChangedEvent({
                noteContext: { getMainContext: () => ({ ntxId }) } as unknown as NoteContext
            });

            switchTo("swap-tree");
            sidebar.activeScreenChangedEvent({ activeScreen: "tree" });
            switchTo("swap-note");
            sidebar.activeScreenChangedEvent({ activeScreen: "detail" });
            flushes.length = 0;

            switchTo("swap-tree");
            expect(flushes).toEqual([ { instant: true, transform: "translateX(100%)" } ]);
            expect(rest.classList.contains("instant-screen-change")).toBe(false);

            flushes.length = 0;
            sidebar.activeScreenChangedEvent({ activeScreen: "detail" });
            expect(flushes).toEqual([]);
            expect(detail.style.transform).toBe("");
        });

        it("puts the tree back beside the note once the screen widens to a tablet", () => {
            const sidebar = render(true);
            sidebar.activeScreenChangedEvent({ activeScreen: "tree" });
            expect(detail.style.transform).toBe("translateX(100%)");

            isNarrow = false;
            onLayoutChange();
            expect(detail.style.transform).toBe("");
            expect(tree.style.transform).toBe("");
        });
    });
});
