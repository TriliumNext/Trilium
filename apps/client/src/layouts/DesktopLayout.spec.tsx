import { act } from "preact/test-utils";
import { beforeEach, describe, expect, it, vi } from "vitest";

/** How many times each legacy custom widget class was constructed. */
const constructedWidgets = vi.hoisted(() => new Map<string, number>());
const electron = vi.hoisted(() => ({ isElectron: vi.fn(() => false), areWindowControlsOnLeft: vi.fn(() => false) }));

vi.mock("../services/utils.js", async (importOriginal) => ({
    ...(await importOriginal<typeof import("../services/utils.js")>()),
    isElectron: () => electron.isElectron(),
    areWindowControlsOnLeft: () => electron.areWindowControlsOnLeft()
}));
vi.mock("../services/keyboard_actions", () => ({
    default: { getAction: vi.fn().mockResolvedValue({ effectiveShortcuts: [] }), updateDisplayedShortcuts: vi.fn() }
}));
vi.mock("../services/resizer", () => ({ default: { setupLeftPaneResizer: vi.fn() } }));
// A Preact widget for each slot of the layout, and a legacy one for each note split.
vi.mock("../services/bundle.js", async (importOriginal) => {
    const original = await importOriginal<typeof import("../services/bundle.js")>();
    const { h } = await import("preact");
    const { default: BasicWidget } = await import("../widgets/basic_widget.js");
    const { default: NoteContextAwareWidget } = await import("../widgets/note_context_aware_widget.js");
    const countConstruction = (name: string) => constructedWidgets.set(name, (constructedWidgets.get(name) ?? 0) + 1);
    class LegacyCenterWidget extends NoteContextAwareWidget {
        constructor() {
            super();
            countConstruction(new.target.name);
        }

        static get parentWidget() {
            return "center-pane";
        }

        doRender() {
            this.$widget = $("<div class=\"custom-legacy-center\">");
        }
    }
    class LegacyDetailWidget extends BasicWidget {
        constructor() {
            super();
            countConstruction(new.target.name);
        }

        static get parentWidget() {
            return "note-detail-pane";
        }

        doRender() {
            this.$widget = $("<div class=\"custom-legacy-detail\">");
        }
    }
    class PositionedLegacyDetailWidget extends LegacyDetailWidget {
        get position() {
            return 25;
        }

        doRender() {
            this.$widget = $("<div class=\"custom-legacy-detail-25\">");
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
                // Positions among the built-in children, which the n-th takes at 10n.
                for (const [ parent, position ] of [ [ "left-pane", 15 ], [ "center-pane", 5 ], [ "note-detail-pane", 10 ] ] as const) {
                    widgets.add({
                        type: "preact-widget", parent, position, _noteId: parent,
                        render: () => h("div", { className: `custom-${parent}-${position}` })
                    } as never);
                }
                widgets.add(LegacyDetailWidget as never);
                widgets.add(PositionedLegacyDetailWidget as never);
                widgets.add(LegacyCenterWidget as never);
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
import { showNoteSplit } from "../test/note_splits.js";
import { renderInto } from "../test/render.js";
import type NoteContextAwareWidget from "../widgets/note_context_aware_widget.js";
import { ParentComponent } from "../widgets/react/react_utils.js";
import DesktopLayout from "./DesktopLayout.js";

describe("DesktopLayout", () => {
    beforeEach(() => {
        buildNote({ id: "_lbVisibleLaunchers", title: "Visible Launchers" });
        // The tab bar's history buttons follow these launchers.
        buildNote({ id: "_lbBackInHistory", title: "Back", type: "launcher" });
        buildNote({ id: "_lbForwardInHistory", title: "Forward", type: "launcher" });
        options.set("leftPaneVisible", "false");
        options.set("experimentalFeatures", "[]");
        // A split shows an empty note, whose view searches for the workspaces, and a search note,
        // whose view reads its attachments, also after their cases.
        if (!vi.isMockFunction(server.get)) {
            const get = server.get.bind(server);
            vi.spyOn(server, "get").mockImplementation((async (url: string) =>
                (url.startsWith("search?") || url.endsWith("/attachments") ? [] : get(url))) as typeof server.get);
        }
    });

    it("keeps a legacy widget outside the splits on the active note context as a background tab switches its note", async () => {
        options.set("layoutOrientation", "vertical");
        let container: HTMLElement | undefined;
        act(() => { container = renderInto(<Layout />); });
        const noteContext = new NoteContext("main");
        const restoreTabManager = await showNoteSplit(container, noteContext);
        await vi.waitFor(() => expect(container?.querySelector("#center-pane .custom-legacy-center")).not.toBeNull());
        const widget: NoteContextAwareWidget = $(".custom-legacy-center", container).prop("component");
        // The tab manager activates the restored tab, whether the widget has loaded by then or not.
        await act(async () => {
            await appContext.triggerEvent("activeContextChanged", { noteContext });
        });
        expect(widget.noteContext).toBe(noteContext);

        await act(async () => {
            await appContext.triggerEvent("noteSwitched", { noteContext: new NoteContext("background"), notePath: "root" });
        });
        expect(widget.noteContext).toBe(noteContext);
        restoreTabManager();
    });

    it("puts the launch bar beside the main container in the vertical layout", () => {
        options.set("layoutOrientation", "vertical");
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
        // The left pane toggle ends the bar, after the launchers, and the left pane follows the bar.
        expect(launcherPane?.lastElementChild?.classList.contains("left-pane-toggle-button")).toBe(true);
        expect(launcherPane?.lastElementChild?.previousElementSibling?.id).toBe("launcher-container");
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
        options.set("layoutOrientation", "horizontal");
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

    it("spans the window with the tab bar in the desktop app's vertical layout when the window controls are on the left", () => {
        options.set("layoutOrientation", "vertical");
        electron.isElectron.mockReturnValue(true);
        electron.areWindowControlsOnLeft.mockReturnValue(true);
        const hadNativeTitleBar = window.glob.hasNativeTitleBar;
        window.glob.hasNativeTitleBar = false;
        let container: HTMLElement | undefined;
        act(() => { container = renderInto(<Layout />); });
        electron.isElectron.mockReturnValue(false);
        electron.areWindowControlsOnLeft.mockReturnValue(false);
        window.glob.hasNativeTitleBar = hadNativeTitleBar;
        const root = container?.querySelector("#root-widget");

        const tabBar = root?.firstElementChild;
        expect(tabBar?.classList.contains("tab-row-container")).toBe(true);
        expect(tabBar?.querySelector(".tab-row-widget.full-width")).not.toBeNull();
        expect(root?.querySelector("#rest-pane .tab-row-container")).toBeNull();
        // The launch bar stays beside the main container, and keeps the left pane toggle.
        expect(tabBar?.nextElementSibling?.id).toBe("horizontal-main-container");
        expect(tabBar?.querySelector(".left-pane-toggle-button")).toBeNull();
        expect(root?.querySelector("#horizontal-main-container > #launcher-pane .left-pane-toggle-button")).not.toBeNull();
    });

    it("shows the results of a search note under its note list", async () => {
        options.set("layoutOrientation", "vertical");
        const searchNote = buildNote({ title: "Search", type: "search" });
        let container: HTMLElement | undefined;
        act(() => { container = renderInto(<Layout />); });
        const noteContext = new NoteContext("main");
        noteContext.noteId = searchNote.noteId;
        noteContext.notePath = searchNote.noteId;
        const restoreTabManager = await showNoteSplit(container, noteContext);

        const host = container?.querySelector(".note-split[data-ntx-id=main] .search-result-host");
        expect(host).toBeInstanceOf(HTMLElement);
        await vi.waitFor(() => expect(host?.querySelector(".search-result-widget")).not.toBeNull());
        restoreTabManager();
    });

    it("gives each note split a title row, and the inline title, title actions, content, note list, search results and scroll padding in its scroller", async () => {
        options.set("layoutOrientation", "vertical");
        let container: HTMLElement | undefined;
        act(() => { container = renderInto(<Layout />); });
        const noteContext = new NoteContext("main");
        const restoreTabManager = await showNoteSplit(container, noteContext);
        restoreTabManager();

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
        // Under the scroller, the note type switcher's bar, then the find bar. The hosts of the custom
        // widgets sit around each of them.
        const partClasses = [ "title-row", "scrolling-container", "note-type-switcher-bar", "find-replace-widget" ];
        const parts = [ ...split?.children ?? [] ].filter((child) => partClasses.some((name) => child.classList.contains(name)));
        expect(parts.map((part) => partClasses.find((name) => part.classList.contains(name)))).toEqual(partClasses);
    });

    it("adds the custom widgets of `#widget` notes to their slots once they have loaded", async () => {
        options.set("layoutOrientation", "vertical");
        constructedWidgets.clear();
        let container: HTMLElement | undefined;
        act(() => { container = renderInto(<Layout />); });
        const noteContext = new NoteContext("main");
        const restoreTabManager = await showNoteSplit(container, noteContext);
        const splits = container?.querySelector(".split-note-container-widget");

        const follows = (later: Element | null | undefined, earlier: Element | null | undefined) =>
            !!later && !!earlier && !!(earlier.compareDocumentPosition(later) & Node.DOCUMENT_POSITION_FOLLOWING);
        await vi.waitFor(() => expect(container?.querySelector("#left-pane .custom-left-pane")).not.toBeNull());
        // Without a position, after the note tree, in the pane that holds it.
        const showAllNotes = container?.querySelector("#left-pane .show-all-notes");
        expect(follows(container?.querySelector(".custom-left-pane"), showAllNotes)).toBe(true);
        // At 15, between the quick search (10) and the button that shows all notes (20).
        const positionedLeft = container?.querySelector("#left-pane .custom-left-pane-15");
        expect(follows(positionedLeft, container?.querySelector("#left-pane .quick-search"))).toBe(true);
        expect(follows(showAllNotes, positionedLeft)).toBe(true);
        // After the note splits, spanning them, and at 5 before them.
        const centerWidget = container?.querySelector("#center-pane .custom-center-pane");
        expect(follows(centerWidget, splits)).toBe(true);
        expect(splits?.contains(centerWidget ?? null)).toBe(false);
        expect(follows(splits, container?.querySelector("#center-pane .custom-center-pane-5"))).toBe(true);
        // At the end of each split, after the find bar.
        const split = container?.querySelector(".note-split[data-ntx-id=main]");
        const findBar = split?.querySelector(".find-replace-widget");
        await vi.waitFor(() => expect(split?.querySelector(".custom-legacy-detail")).not.toBeNull());
        expect(follows(split?.querySelector(".custom-note-detail-pane"), findBar)).toBe(true);
        expect(follows(split?.querySelector(".custom-legacy-detail"), findBar)).toBe(true);
        // At 10, after the title row (10) and above the scroller (20); at 25, between the scroller
        // and the note type switcher's bar (30).
        const scroller = split?.querySelector(":scope > .scrolling-container");
        const positionedDetail = split?.querySelector(".custom-note-detail-pane-10");
        expect(follows(positionedDetail, split?.querySelector(":scope > .title-row"))).toBe(true);
        expect(follows(scroller, positionedDetail)).toBe(true);
        const positionedLegacy = split?.querySelector(".custom-legacy-detail-25");
        expect(follows(positionedLegacy, scroller)).toBe(true);
        expect(follows(split?.querySelector(":scope > .note-type-switcher-bar"), positionedLegacy)).toBe(true);
        // A legacy widget class is built once for the center pane and once for the split, not once
        // for each gap among their parts.
        expect(Object.fromEntries(constructedWidgets)).toEqual({
            LegacyCenterWidget: 1,
            LegacyDetailWidget: 1,
            PositionedLegacyDetailWidget: 1
        });
        restoreTabManager();
    });

    it("runs the command of a legacy widget's `data-trigger-command` element on a click", () => {
        options.set("layoutOrientation", "horizontal");
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

    it("switches its orientation as the option changes, keeping the panes and moving the launch bar", async () => {
        options.set("layoutOrientation", "vertical");
        let container: HTMLElement | undefined;
        act(() => { container = renderInto(<Layout />); });
        const root = container?.querySelector("#root-widget");
        const restPane = root?.querySelector("#rest-pane");
        expect(root?.querySelector("#horizontal-main-container > #launcher-pane.vertical")).not.toBeNull();
        expect(document.body.classList.contains("layout-vertical")).toBe(true);

        // The tab row the move remounts asks for the tabs restored before it.
        const originalTabManager = appContext.tabManager;
        appContext.tabManager = {
            tabsRestored: true, noteContexts: [], getMainNoteContexts: () => [], getActiveContext: () => null
        } as unknown as typeof appContext.tabManager;
        options.set("layoutOrientation", "horizontal");
        const loadResults = new LoadResults([]);
        loadResults.addOption("layoutOrientation");
        await act(async () => { await appContext.triggerEvent("entitiesReloaded", { loadResults }); });
        appContext.tabManager = originalTabManager;

        expect(root?.classList.contains("horizontal-layout")).toBe(true);
        expect(root?.querySelector(":scope > #launcher-pane.horizontal")).not.toBeNull();
        expect(root?.querySelector("#horizontal-main-container > #launcher-pane")).toBeNull();
        expect(root?.querySelector(":scope > .tab-row-container.full-width .tab-row-widget")).not.toBeNull();
        // The panes stay mounted.
        expect(root?.querySelector("#rest-pane")).toBe(restPane);
        expect(document.body.classList.contains("layout-horizontal")).toBe(true);
        expect(document.body.classList.contains("layout-vertical")).toBe(false);
        document.body.classList.remove("layout-horizontal");
    });

    it("applies the appearance options to the body before the first paint, and again as they change", async () => {
        options.set("layoutOrientation", "vertical");
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
        options.set("layoutOrientation", "vertical");
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
