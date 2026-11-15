import { render } from "preact";
import { act } from "preact/test-utils";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import type FNote from "../../entities/fnote";
import { buildNote } from "../../test/easy-froca";
import { LaunchBarContext } from "./launch_bar_widgets";
import { QuickSearchLauncherWidget, useCommandLauncherContextMenu } from "./LauncherDefinitions";

const mocks = vi.hoisted(() => ({
    quickSearchLoaded: false,
    showLauncherContextMenu: vi.fn(),
    getRecentlyChangedNotesMenuItems: vi.fn()
}));

vi.mock("../../menus/launcher_button_context_menu", () => ({
    showLauncherContextMenu: mocks.showLauncherContextMenu
}));
vi.mock("../quick_search", () => {
    mocks.quickSearchLoaded = true;
    return { default: () => <div className="quick-search-stub" /> };
});
vi.mock("../../menus/recent_changes_menu_items", () => ({
    getRecentlyChangedNotesMenuItems: mocks.getRecentlyChangedNotesMenuItems
}));

const SECTION = [ { kind: "header", title: "Recently changed notes" } ];

describe("useCommandLauncherContextMenu", () => {
    let container: HTMLElement;
    let launcherNote: FNote;

    beforeEach(() => {
        vi.clearAllMocks();
        mocks.getRecentlyChangedNotesMenuItems.mockResolvedValue(SECTION);
        launcherNote = buildNote({ id: "_lbRecentChanges", title: "Recent Changes" });
        container = document.createElement("div");
        document.body.append(container);
    });

    afterEach(() => {
        act(() => render(null, container));
        container.remove();
        vi.useRealTimers();
    });

    it("adds the recently changed notes to the launcher menu on a right-click", async () => {
        const button = renderProbe("showRecentChanges");

        const event = new MouseEvent("contextmenu", { bubbles: true, cancelable: true });
        button.dispatchEvent(event);
        expect(event.defaultPrevented).toBe(true);

        await vi.waitFor(() => expect(mocks.showLauncherContextMenu).toHaveBeenCalledOnce());
        expect(mocks.showLauncherContextMenu)
            .toHaveBeenCalledWith(launcherNote, event, { extraItems: SECTION });
    });

    it("opens the same menu on a held press", async () => {
        vi.useFakeTimers();
        const button = renderProbe("showRecentChanges");

        button.dispatchEvent(new PointerEvent("pointerdown", { bubbles: true, button: 0 }));
        vi.advanceTimersByTime(500);

        await vi.waitFor(() => expect(mocks.showLauncherContextMenu).toHaveBeenCalledOnce());
        const [ note, event, options ] = mocks.showLauncherContextMenu.mock.calls[0];
        expect(note).toBe(launcherNote);
        expect(event).toMatchObject({ type: "pointerdown" });
        expect(options).toEqual({ extraItems: SECTION });
    });

    it("holds through a jitter, but not through a press that moves on, as a swipe across the bar does", async () => {
        vi.useFakeTimers();
        const button = renderProbe("showRecentChanges");
        const press = (type: string, clientX: number) => button.dispatchEvent(
            new PointerEvent(type, { bubbles: true, button: 0, clientX, clientY: 10 }));

        press("pointerdown", 100);
        press("pointermove", 130);
        vi.advanceTimersByTime(500);
        await Promise.resolve();
        expect(mocks.showLauncherContextMenu).not.toHaveBeenCalled();
        press("pointerup", 130);

        press("pointerdown", 100);
        press("pointermove", 104);
        vi.advanceTimersByTime(500);
        await vi.waitFor(() => expect(mocks.showLauncherContextMenu).toHaveBeenCalledOnce());
    });

    it("leaves a command without a section to the default launcher menu", () => {
        const button = renderProbe("showDeletedNotes");

        const event = new MouseEvent("contextmenu", { bubbles: true, cancelable: true });
        button.dispatchEvent(event);

        expect(event.defaultPrevented).toBe(false);
        expect(mocks.getRecentlyChangedNotesMenuItems).not.toHaveBeenCalled();
        expect(mocks.showLauncherContextMenu).not.toHaveBeenCalled();
    });

    function renderProbe(command: string) {
        function Probe() {
            const menuProps = useCommandLauncherContextMenu(command, launcherNote);
            return <button type="button" {...menuProps} />;
        }

        act(() => render(<Probe />, container));
        const button = container.querySelector("button");
        if (!button) throw new Error("The probe did not render its button.");
        return button;
    }
});

describe("QuickSearchLauncherWidget", () => {
    it("loads the search field only for the horizontal launch bar, which shows it", async () => {
        const launcherNote = buildNote({ id: "_lbQuickSearch", title: "Quick search" });
        const container = document.createElement("div");
        document.body.append(container);
        const draw = (isHorizontalLayout: boolean) => act(() => render(
            <LaunchBarContext.Provider value={{ isHorizontalLayout }}>
                <QuickSearchLauncherWidget launcherNote={launcherNote} />
            </LaunchBarContext.Provider>, container));

        draw(false);
        await act(async () => { await new Promise((resolve) => setTimeout(resolve)); });
        expect(mocks.quickSearchLoaded).toBe(false);

        draw(true);
        await vi.waitFor(() => expect(container.querySelector(".quick-search-stub")).not.toBeNull());
        expect(mocks.quickSearchLoaded).toBe(true);

        act(() => render(null, container));
        container.remove();
    });
});
