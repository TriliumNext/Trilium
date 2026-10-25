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

            tree = document.body.appendChild(document.createElement("div"));
            tree.id = "mobile-sidebar-wrapper";
            detail = document.body.appendChild(document.createElement("div"));
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
