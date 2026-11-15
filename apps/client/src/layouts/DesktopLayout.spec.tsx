import { act } from "preact/test-utils";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("../services/keyboard_actions", () => ({
    default: { getAction: vi.fn().mockResolvedValue({ effectiveShortcuts: [] }) }
}));
vi.mock("../services/resizer", () => ({ default: { setupLeftPaneResizer: vi.fn() } }));

import appContext from "../components/app_context.js";
import NoteContext from "../components/note_context.js";
import options from "../services/options.js";
import { buildNote } from "../test/easy-froca.js";
import { renderInto } from "../test/render.js";
import { ParentComponent } from "../widgets/react/react_utils.js";
import DesktopLayout from "./DesktopLayout.js";

describe("DesktopLayout", () => {
    const originalOrientation = window.glob.layoutOrientation;

    beforeEach(() => {
        buildNote({ id: "_lbVisibleLaunchers", title: "Visible Launchers" });
        // The tab bar's history buttons follow these launchers.
        buildNote({ id: "_lbBackInHistory", title: "Back", type: "launcher" });
        buildNote({ id: "_lbForwardInHistory", title: "Forward", type: "launcher" });
        options.set("leftPaneVisible", "false");
    });

    afterEach(() => {
        window.glob.layoutOrientation = originalOrientation;
    });

    it("puts the launch bar beside the main container in the vertical layout", () => {
        window.glob.layoutOrientation = "vertical";
        let container: HTMLElement | undefined;
        // In `act()`, so the tab row widget is attached by its effect.
        act(() => { container = renderInto(<Layout />); });
        const root = container?.querySelector("#root-widget");

        expect(root?.classList.contains("vertical-layout")).toBe(true);
        const launcherPane = root?.querySelector("#launcher-pane");
        expect(launcherPane?.classList.contains("vertical")).toBe(true);
        expect(launcherPane?.parentElement?.id).toBe("horizontal-main-container");
        expect(launcherPane?.querySelector("#launcher-container")).not.toBeNull();
        // The menu heads the bar.
        expect(launcherPane?.firstElementChild?.classList.contains("global-menu")).toBe(true);
        // Outside the desktop app, the tab bar heads the pane beside the launch bar.
        const tabBar = root?.querySelector(".tab-row-container");
        expect(tabBar?.parentElement?.id).toBe("rest-pane");
        expect(tabBar?.querySelector(".tab-row-widget.full-width")).toBeNull();
        expect(tabBar?.querySelector(".tab-row-widget")).not.toBeNull();
        // The left pane toggle follows the menu, and the left pane follows the launch bar.
        expect(launcherPane?.children[1]?.classList.contains("left-pane-toggle-button")).toBe(true);
        expect(launcherPane?.nextElementSibling?.classList.contains("left-pane-peek-button")).toBe(true);
        const leftPaneHost = root?.querySelector("#left-pane-host");
        expect(leftPaneHost?.previousElementSibling?.classList.contains("left-pane-peek-button")).toBe(true);
        expect(leftPaneHost?.nextElementSibling?.id).toBe("rest-pane");
        expect(root?.querySelector("#horizontal-main-container.left-pane-hidden")).not.toBeNull();
        // The note splits fill the center pane, under the tab bar.
        const centerPane = root?.querySelector("#rest-pane > #vertical-main-container > #center-pane");
        expect(centerPane?.querySelector(".split-note-container-widget")).not.toBeNull();
        expect(tabBar?.nextElementSibling?.id).toBe("vertical-main-container");
        // The status bar ends the pane beside the launch bar.
        const statusBar = root?.querySelector(".status-bar");
        expect(statusBar).toBeInstanceOf(HTMLElement);
        expect(statusBar?.parentElement?.id).toBe("rest-pane");
        expect(statusBar?.previousElementSibling?.id).toBe("vertical-main-container");
    });

    it("puts the launch bar above the main container in the horizontal layout", () => {
        window.glob.layoutOrientation = "horizontal";
        let container: HTMLElement | undefined;
        // In `act()`, so the tab row widget is attached by its effect.
        act(() => { container = renderInto(<Layout />); });
        const root = container?.querySelector("#root-widget");

        expect(root?.classList.contains("horizontal-layout")).toBe(true);
        const launcherPane = root?.querySelector("#launcher-pane");
        expect(launcherPane?.classList.contains("horizontal")).toBe(true);
        expect(launcherPane?.parentElement).toBe(root);
        expect(launcherPane?.nextElementSibling?.id).toBe("horizontal-main-container");
        // The menu ends the bar.
        expect(launcherPane?.lastElementChild?.classList.contains("global-menu")).toBe(true);
        // The tab bar spans the window above the launch bar.
        const tabBar = root?.firstElementChild;
        expect(tabBar?.classList.contains("tab-row-container")).toBe(true);
        expect(tabBar?.nextElementSibling).toBe(launcherPane);
        expect(tabBar?.querySelector(".tab-row-widget.full-width")).not.toBeNull();
        expect(root?.querySelector("#rest-pane .tab-row-container")).toBeNull();
        // The left pane toggle follows the spacer of the tab bar, and the left pane starts the main container.
        expect(tabBar?.children[1]?.classList.contains("left-pane-toggle-button")).toBe(true);
        expect(launcherPane?.querySelector(".left-pane-toggle-button")).toBeNull();
        const mainContainer = root?.querySelector("#horizontal-main-container");
        expect(mainContainer?.firstElementChild?.classList.contains("left-pane-peek-button")).toBe(true);
        expect(mainContainer?.children[1]?.id).toBe("left-pane-host");
        // The status bar spans the window under the main container.
        const statusBar = root?.querySelector(".status-bar");
        expect(statusBar).toBeInstanceOf(HTMLElement);
        expect(statusBar?.parentElement).toBe(root);
        expect(statusBar?.previousElementSibling).toBe(mainContainer);
    });

    it("gives each note split a title row, and the inline title, title actions, content and note list in its scroller", async () => {
        window.glob.layoutOrientation = "vertical";
        let container: HTMLElement | undefined;
        act(() => { container = renderInto(<Layout />); });
        const noteContext = new NoteContext("main");
        const originalTabManager = appContext.tabManager;
        appContext.tabManager = {
            getActiveMainContext: () => noteContext,
            getActiveContext: () => noteContext
        } as unknown as typeof appContext.tabManager;
        const splits = container?.querySelector(".split-note-container-widget");
        expect(splits).not.toBeNull();
        await act(async () => {
            await $(splits as HTMLElement).prop("component").handleEvent("newNoteContextCreated", { noteContext });
        });
        appContext.tabManager = originalTabManager;

        const split = container?.querySelector(".note-split[data-ntx-id=main]");
        expect(split).not.toBeNull();
        const titleRow = split?.querySelector(":scope > .title-row");
        expect(titleRow).toBeInstanceOf(HTMLElement);
        expect(titleRow?.querySelector(".note-icon-widget button.note-icon")).toBeInstanceOf(HTMLElement);
        expect(titleRow?.querySelector(".note-title-widget")).toBeInstanceOf(HTMLElement);
        const scroller = split?.querySelector(":scope > .scrolling-container");
        expect(scroller?.firstElementChild?.classList.contains("inline-title")).toBe(true);
        expect(scroller?.children[1]?.classList.contains("title-actions")).toBe(true);
        const detail = scroller?.querySelector(":scope > .note-detail");
        expect(detail).toBeInstanceOf(HTMLElement);
        expect(detail?.previousElementSibling?.classList.contains("title-actions")).toBe(true);
        expect(detail?.nextElementSibling?.classList.contains("note-list-widget")).toBe(true);
        // The note type switcher's bar ends the split, under the scroller.
        expect(scroller?.nextElementSibling?.classList.contains("note-type-switcher-bar")).toBe(true);
    });

    it("runs the command of a legacy widget's `data-trigger-command` element on a click", () => {
        window.glob.layoutOrientation = "horizontal";
        const triggerCommand = vi.spyOn(appContext, "triggerCommand").mockResolvedValue(undefined);
        let container: HTMLElement | undefined;
        act(() => { container = renderInto(<Layout />); });

        const newTabButton = container?.querySelector<HTMLElement>(".note-new-tab[data-trigger-command]");
        expect(newTabButton).toBeInstanceOf(HTMLElement);
        newTabButton?.click();
        expect(triggerCommand).toHaveBeenCalledWith("openNewTab", expect.objectContaining({ $el: expect.anything() }));

        triggerCommand.mockClear();
        newTabButton?.classList.add("disabled");
        newTabButton?.click();
        expect(triggerCommand).not.toHaveBeenCalled();
        triggerCommand.mockRestore();
    });
});

/** `desktop.ts` renders the layout with `appContext` as its parent component. */
function Layout() {
    return (
        <ParentComponent.Provider value={appContext}>
            <DesktopLayout />
        </ParentComponent.Provider>
    );
}
