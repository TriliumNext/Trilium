import { act } from "preact/test-utils";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("../services/keyboard_actions", () => ({
    default: { getAction: vi.fn().mockResolvedValue({ effectiveShortcuts: [] }), updateDisplayedShortcuts: vi.fn() }
}));
vi.mock("../services/resizer", () => ({ default: { setupLeftPaneResizer: vi.fn() } }));
// A Preact widget for each slot of the layout, and a legacy one for each note split.
vi.mock("../services/bundle.js", async (importOriginal) => {
    const original = await importOriginal<typeof import("../services/bundle.js")>();
    const { h } = await import("preact");
    const { default: BasicWidget } = await import("../widgets/basic_widget.js");
    class LegacyDetailWidget extends BasicWidget {
        static get parentWidget() {
            return "note-detail-pane";
        }

        doRender() {
            this.$widget = $("<div class=\"custom-legacy-detail\">");
        }
    }
    return {
        ...original,
        default: {
            ...original.default,
            getWidgetBundlesByParent: async () => {
                const widgets = new original.WidgetsByParent();
                for (const parent of [ "left-pane", "center-pane", "note-detail-pane" ] as const) {
                    widgets.add({ type: "preact-widget", parent, render: () => h("div", { className: `custom-${parent}` }), _noteId: parent } as never);
                }
                widgets.add(LegacyDetailWidget as never);
                return widgets;
            }
        }
    };
});

import appContext from "../components/app_context.js";
import NoteContext from "../components/note_context.js";
import LoadResults from "../services/load_results.js";
import options from "../services/options.js";
import server from "../services/server.js";
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
        options.set("experimentalFeatures", "[]");
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
        // The fixed formatting toolbar sits between the tab bar and the main container.
        const toolbar = tabBar?.nextElementSibling;
        expect(toolbar?.classList.contains("classic-toolbar-widget")).toBe(true);
        expect(toolbar?.nextElementSibling?.id).toBe("vertical-main-container");
        // The right pane and its peek button follow the center pane.
        const rightPaneHost = root?.querySelector("#vertical-main-container > #right-pane-host");
        expect(rightPaneHost).toBeInstanceOf(HTMLElement);
        expect(rightPaneHost?.previousElementSibling?.classList.contains("right-pane-peek-button")).toBe(true);
        expect(rightPaneHost?.previousElementSibling?.previousElementSibling).toBe(centerPane);
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

    it("gives each note split a title row, and the inline title, title actions, content, note list, search results and scroll padding in its scroller", async () => {
        window.glob.layoutOrientation = "vertical";
        let container: HTMLElement | undefined;
        act(() => { container = renderInto(<Layout />); });
        const noteContext = new NoteContext("main");
        const originalTabManager = appContext.tabManager;
        appContext.tabManager = {
            noteContexts: [ noteContext ],
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
        // The badges follow the title, and the actions end the row after a spacer.
        const badges = titleRow?.querySelector(":scope > .note-badges");
        expect(badges).toBeInstanceOf(HTMLElement);
        expect(badges?.previousElementSibling?.classList.contains("note-title-widget")).toBe(true);
        const actions = titleRow?.querySelector(":scope > .note-actions-bar");
        expect(actions).toBeInstanceOf(HTMLElement);
        expect(actions?.previousElementSibling?.classList.contains("spacer")).toBe(true);
        const scroller = split?.querySelector(":scope > .scrolling-container");
        expect(scroller?.firstElementChild?.classList.contains("inline-title")).toBe(true);
        expect(scroller?.children[1]?.classList.contains("title-actions")).toBe(true);
        const detail = scroller?.querySelector(":scope > .note-detail");
        expect(detail).toBeInstanceOf(HTMLElement);
        expect(detail?.previousElementSibling?.classList.contains("title-actions")).toBe(true);
        expect(detail?.nextElementSibling?.classList.contains("note-list-widget")).toBe(true);
        // The search results follow the note list, and the scroll padding ends the scroller.
        const searchResults = detail?.nextElementSibling?.nextElementSibling;
        expect(searchResults?.classList.contains("search-result-host")).toBe(true);
        expect(searchResults?.nextElementSibling).toBe(scroller?.lastElementChild);
        // The note type switcher's bar ends the split, under the scroller.
        expect(scroller?.nextElementSibling?.classList.contains("note-type-switcher-bar")).toBe(true);
        // The find bar follows it.
        expect(scroller?.nextElementSibling?.nextElementSibling?.classList.contains("find-replace-widget")).toBe(true);
    });

    it("adds the custom widgets of `#widget` notes to their slots once they have loaded", async () => {
        window.glob.layoutOrientation = "vertical";
        // The split shows an empty note, whose view searches for the workspaces.
        const get = server.get.bind(server);
        const serverGet = vi.spyOn(server, "get").mockImplementation((async (url: string) =>
            (url.startsWith("search?") ? [] : get(url))) as typeof server.get);
        let container: HTMLElement | undefined;
        act(() => { container = renderInto(<Layout />); });
        const noteContext = new NoteContext("main");
        const originalTabManager = appContext.tabManager;
        appContext.tabManager = {
            noteContexts: [ noteContext ],
            getActiveMainContext: () => noteContext,
            getActiveContext: () => noteContext
        } as unknown as typeof appContext.tabManager;
        const splits = container?.querySelector(".split-note-container-widget");
        expect(splits).not.toBeNull();
        await act(async () => {
            await $(splits as HTMLElement).prop("component").handleEvent("newNoteContextCreated", { noteContext });
        });

        const follows = (later: Element | null | undefined, earlier: Element | null | undefined) =>
            !!later && !!earlier && !!(earlier.compareDocumentPosition(later) & Node.DOCUMENT_POSITION_FOLLOWING);
        await vi.waitFor(() => expect(container?.querySelector("#left-pane .custom-left-pane")).not.toBeNull());
        // After the note tree, in the pane that holds it.
        expect(follows(container?.querySelector(".custom-left-pane"), container?.querySelector("#left-pane .show-all-notes"))).toBe(true);
        // After the note splits, spanning them.
        const centerWidget = container?.querySelector("#center-pane .custom-center-pane");
        expect(follows(centerWidget, splits)).toBe(true);
        expect(splits?.contains(centerWidget ?? null)).toBe(false);
        // At the end of each split, after the find bar.
        const split = container?.querySelector(".note-split[data-ntx-id=main]");
        const findBar = split?.querySelector(".find-replace-widget");
        await vi.waitFor(() => expect(split?.querySelector(".custom-legacy-detail")).not.toBeNull());
        expect(follows(split?.querySelector(".custom-note-detail-pane"), findBar)).toBe(true);
        expect(follows(split?.querySelector(".custom-legacy-detail"), findBar)).toBe(true);
        appContext.tabManager = originalTabManager;
        serverGet.mockRestore();
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

    it("applies the appearance options to the body before the first paint, and again as they change", async () => {
        window.glob.layoutOrientation = "vertical";
        options.set("motionEnabled", "false");
        options.set("maxContentWidth", "900");
        options.set("centerContent", "true");
        act(() => { renderInto(<Layout />); });

        const body = document.body;
        expect(body.classList.contains("motion-disabled")).toBe(true);
        expect(body.style.getPropertyValue("--preferred-max-content-width")).toBe("900px");
        expect(body.classList.contains("prefers-centered-content")).toBe(true);

        // The tab row hears the reload as well, and reads the tabs.
        const originalTabManager = appContext.tabManager;
        appContext.tabManager = { noteContexts: [] } as unknown as typeof appContext.tabManager;
        options.set("motionEnabled", "true");
        const loadResults = new LoadResults([]);
        loadResults.addOption("motionEnabled");
        await act(async () => { await appContext.triggerEvent("entitiesReloaded", { loadResults }); });
        expect(body.classList.contains("motion-disabled")).toBe(false);
        appContext.tabManager = originalTabManager;

        body.classList.remove("prefers-centered-content");
        body.style.removeProperty("--preferred-max-content-width");
    });

    it("ends with the zen mode button and the toasts, and opens a dialog on its first summons for it alone", async () => {
        window.glob.layoutOrientation = "vertical";
        let container: HTMLElement | undefined;
        act(() => { container = renderInto(<Layout />); });
        const root = container?.querySelector("#root-widget");
        expect(root?.querySelector(":scope > .close-zen-container")).not.toBeNull();
        expect(root?.querySelector("#toast-container")).not.toBeNull();
        expect(document.querySelector(".password-not-set-dialog")).toBeNull();

        // The dialog loads on the summons and hears it once loaded; nothing else hears it twice.
        const heard = vi.fn();
        appContext.registerHandler("showPasswordNotSet", heard);
        await act(async () => { await appContext.triggerEvent("showPasswordNotSet", {}); });
        await vi.waitFor(() => expect(document.querySelector(".password-not-set-dialog")).not.toBeNull());
        await act(async () => { await new Promise((resolve) => setTimeout(resolve)); });
        expect(heard).toHaveBeenCalledTimes(1);
        appContext.removeHandler("showPasswordNotSet", heard);
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
