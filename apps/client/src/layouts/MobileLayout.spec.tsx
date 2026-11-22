import { act } from "preact/test-utils";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const bundles = vi.hoisted(() => ({ getWidgetBundlesByParent: vi.fn() }));
vi.mock("../services/bundle.js", async (importOriginal) => {
    const original = await importOriginal<typeof import("../services/bundle.js")>();
    bundles.getWidgetBundlesByParent.mockImplementation(async () => new original.WidgetsByParent());
    return { ...original, default: { ...original.default, getWidgetBundlesByParent: bundles.getWidgetBundlesByParent } };
});

// The sidebar loads them after the first paint, and the navigator then reads the tree from the server.
vi.mock("../widgets/mobile_widgets/MobileNoteNavigator.js", () => ({ default: () => null }));
vi.mock("../widgets/quick_search.js", () => ({ default: () => null }));
// The tablet's peek button shows its shortcut, and the test server lists no keyboard actions.
vi.mock("../services/keyboard_actions", () => ({
    default: { getAction: vi.fn().mockResolvedValue({ effectiveShortcuts: [] }), updateDisplayedShortcuts: vi.fn() }
}));

import appContext from "../components/app_context.js";
import NoteContext from "../components/note_context.js";
import LoadResults from "../services/load_results.js";
import options from "../services/options.js";
import server from "../services/server.js";
import { NARROW_LAYOUT, STACKED_TREE_LAYOUT } from "../services/utils.js";
import { buildNote } from "../test/easy-froca.js";
import { showNoteSplit } from "../test/note_splits.js";
import { renderInto } from "../test/render.js";
import { setCustomWidgets, useCustomWidgets } from "../widgets/react/hooks/custom_widgets.js";
import { ParentComponent } from "../widgets/react/react_utils.js";
import MobileLayout from "./MobileLayout.js";

describe("MobileLayout", () => {
    let device: typeof window.glob.device;
    let appChildren: typeof appContext.children;
    beforeEach(() => {
        device = window.glob.device;
        appChildren = [ ...appContext.children ];
        window.glob.device = "mobile";
        // A phone shows the mobile launchers, a tablet the desktop ones.
        buildNote({ id: "_lbMobileVisibleLaunchers", title: "Visible Launchers" });
        buildNote({ id: "_lbVisibleLaunchers", title: "Visible Launchers" });
        // A tablet's tab bar starts with the history buttons, which take these launchers' titles.
        buildNote({ id: "_lbBackInHistory", title: "Back" });
        buildNote({ id: "_lbForwardInHistory", title: "Forward" });
        // A phone unless the case says otherwise: happy-dom's window is a tablet's.
        stubLayoutWidth("phone");
        options.set("experimentalFeatures", "[]");
        // A split shows an empty note, whose view searches for the workspaces, also after the case.
        if (!vi.isMockFunction(server.get)) {
            const get = server.get.bind(server);
            vi.spyOn(server, "get").mockImplementation((async (url: string) =>
                (url.startsWith("search?") ? [] : get(url))) as typeof server.get);
        }
    });
    afterEach(() => {
        window.glob.device = device;
        // A lazy tab bar can render after the last `act()`, and a teardown before its effects run
        // leaves its `TabRowWidget` among the children of `appContext`, where later events reach it.
        appContext.children = appChildren;
        if (vi.isMockFunction(window.matchMedia)) window.matchMedia.mockRestore();
    });

    it("gives each note split a title row, a scroller with the note and its search results, then the type bar, editor toolbar and find bar", async () => {
        let container: HTMLElement | undefined;
        act(() => { container = renderLayout(); });
        const splits = container?.querySelector("#mobile-rest-container > #mobile-rest-pane > #detail-container > .split-note-container-widget");
        expect(splits).not.toBeNull();

        const noteContext = new NoteContext("main");
        const restoreTabManager = await showNoteSplit(container, noteContext);
        restoreTabManager();

        const split = container?.querySelector(".note-split[data-ntx-id=main]");
        const titleRow = split?.querySelector(":scope > .title-row");
        expect(titleRow?.firstElementChild?.classList.contains("toggle-sidebar-button")).toBe(true);
        expect(titleRow?.children[1]?.querySelector("button.note-icon")).toBeInstanceOf(HTMLElement);
        expect(titleRow?.children[2]?.classList.contains("note-title-widget")).toBe(true);
        expect(titleRow?.children[3]?.classList.contains("note-badges")).toBe(true);
        expect(titleRow?.children[4]?.classList.contains("mobile-note-panel-button")).toBe(true);
        // The note menu ends the row; with no note open, its place holds the button that closes the split.
        expect(titleRow?.children).toHaveLength(6);
        expect(titleRow?.lastElementChild?.querySelector("button.bx-x")).toBeInstanceOf(HTMLElement);
        const scroller = split?.querySelector(":scope > .scrolling-container");
        expect(scroller?.firstElementChild?.classList.contains("inline-title")).toBe(true);
        expect(scroller?.children[1]?.classList.contains("title-actions")).toBe(true);
        expect(scroller?.children[2]?.classList.contains("note-detail")).toBe(true);
        expect(scroller?.children[3]?.classList.contains("note-list-widget")).toBe(true);
        expect(scroller?.children[4]?.classList.contains("search-result-host")).toBe(true);
        // The scroll padding ends the scroller; with no note open, it is an empty element.
        expect(scroller?.children).toHaveLength(6);
        const typeBar = scroller?.nextElementSibling;
        expect(typeBar?.classList.contains("note-type-switcher-bar")).toBe(true);
        expect(typeBar?.nextElementSibling?.classList.contains("classic-toolbar-outer-container")).toBe(true);
        expect(typeBar?.nextElementSibling?.nextElementSibling?.classList.contains("find-replace-widget")).toBe(true);
    });

    it("loads the widgets of the `#widget` notes once it has rendered, for the note panel", async () => {
        setCustomWidgets(undefined);
        let loaded: unknown;
        function Probe() {
            loaded = useCustomWidgets();
            return null;
        }
        renderInto(<ParentComponent.Provider value={appContext}><MobileLayout /><Probe /></ParentComponent.Provider>);
        await vi.waitFor(() => expect(loaded).toBeDefined());
        expect(bundles.getWidgetBundlesByParent).toHaveBeenCalled();
    });

    it("puts the sidebar before the note splits, beside them as the stylesheets select it", () => {
        stubLayoutWidth("phone");
        const container = renderLayout();
        const rest = container.querySelector("#mobile-rest-container");
        expect(rest?.firstElementChild?.id).toBe("mobile-sidebar-wrapper");
        // `#mobile-rest-pane` lays out as its children on a phone; it holds no tab bar there.
        const restPane = rest?.firstElementChild?.nextElementSibling;
        expect(restPane?.id).toBe("mobile-rest-pane");
        expect(restPane?.children).toHaveLength(1);
        expect(restPane?.firstElementChild?.id).toBe("detail-container");
    });

    it("puts the bottom bar under the panes on a phone, holding the launchers and then the global menu", () => {
        stubLayoutWidth("phone");
        const container = renderLayout();
        const root = container.querySelector("#root-widget.mobile-layout.horizontal-layout");

        const bottomBar = root?.querySelector(":scope > #mobile-bottom-bar");
        expect(bottomBar).toBeInstanceOf(HTMLElement);
        const launcherPane = bottomBar?.querySelector(":scope > #launcher-pane.horizontal");
        expect(launcherPane?.firstElementChild?.id).toBe("launcher-container");
        expect(launcherPane?.lastElementChild?.classList.contains("global-menu")).toBe(true);
        // The panes above it fill the rest of the screen.
        expect(bottomBar?.previousElementSibling?.id).toBe("mobile-rest-container");
        // The zen mode exit, the button that hides the keyboard and the toasts follow it.
        expect(bottomBar?.nextElementSibling?.classList.contains("close-zen-container")).toBe(true);
        expect(bottomBar?.nextElementSibling?.nextElementSibling?.classList.contains("hide-keyboard-button")).toBe(true);
        expect(root?.querySelector("#toast-container")).toBeInstanceOf(HTMLElement);
        expect(root?.querySelector("#launcher-pane.vertical")).toBeNull();
        // A phone opens the note panel instead of the desktop's right pane.
        expect(root?.querySelector("#right-pane-host")).toBeNull();
        // A phone's tabs are in the tab switcher, not in a tab bar.
        expect(root?.classList.contains("tablet")).toBe(false);
    });

    it("turns into a tablet's layout as a foldable unfolds, and back as it folds", async () => {
        const layout = stubLayoutWidth("phone");
        let container: HTMLElement | undefined;
        act(() => { container = renderLayout(); });
        const root = container?.querySelector("#root-widget.mobile-layout");
        expect(root?.classList.contains("tablet")).toBe(false);

        act(() => layout.turnTo("portrait"));
        expect(root?.classList.contains("tablet")).toBe(true);
        await vi.waitFor(() => expect(root?.firstElementChild?.classList.contains("tab-row-container")).toBe(true));

        act(() => layout.turnTo("phone"));
        expect(root?.classList.contains("tablet")).toBe(false);
        expect(root?.querySelector(".tab-row-container")).toBeNull();
    });

    it("puts the launchers in a rail before the sidebar on a tablet and the tab bar above the notes, and in portrait the tab bar across the top", async () => {
        const layout = stubLayoutWidth("tablet");
        let container: HTMLElement | undefined;
        act(() => { container = renderLayout(); });
        const root = container?.querySelector("#root-widget.mobile-layout");
        expect(root?.classList.contains("vertical-layout")).toBe(true);
        expect(root?.querySelector("#mobile-bottom-bar")).toBeNull();

        const rail = root?.querySelector(":scope > #mobile-rest-container > #launcher-pane.vertical");
        expect(rail).toBeInstanceOf(HTMLElement);
        expect(rail?.firstElementChild?.classList.contains("global-menu")).toBe(true);
        expect(rail?.children[1]?.id).toBe("launcher-container");
        // The tree's toggle ends the rail, as in the desktop's vertical layout.
        await vi.waitFor(() => expect(rail?.lastElementChild?.classList.contains("left-pane-toggle-button")).toBe(true));
        expect(rail?.nextElementSibling?.id).toBe("mobile-sidebar-wrapper");
        const restPane = root?.querySelector(":scope > #mobile-rest-container > #mobile-rest-pane");
        await vi.waitFor(() => expect(restPane?.firstElementChild?.classList.contains("tab-row-container")).toBe(true));
        expect(restPane?.querySelector(".tab-row-widget")).toBeInstanceOf(HTMLElement);
        expect(restPane?.querySelector(".right-pane-toggle-button")).toBeNull();
        const detail = restPane?.lastElementChild;
        expect(detail?.id).toBe("detail-container");
        // The desktop's right pane follows the notes, with its peek button.
        const rest = root?.querySelector(":scope > #mobile-rest-container");
        await vi.waitFor(() => expect(rest?.querySelector(":scope > #mobile-rest-pane ~ .right-pane-peek-button")).toBeInstanceOf(HTMLElement));
        expect(rest?.querySelector(":scope > #right-pane-host")).toBeInstanceOf(HTMLElement);

        // In portrait, the tab bar runs across the top of the screen, over the tree and the note.
        act(() => layout.turnTo("portrait"));
        expect(root?.classList.contains("horizontal-layout")).toBe(true);
        expect(root?.classList.contains("tablet")).toBe(true);
        expect(root?.querySelector("#launcher-pane.vertical")).toBeNull();
        expect(restPane?.querySelector(".tab-row-container")).toBeNull();
        await vi.waitFor(() => expect(root?.firstElementChild?.classList.contains("tab-row-container")).toBe(true));
        expect(root?.querySelector(":scope > .tab-row-container .tab-row-widget.full-width")).toBeInstanceOf(HTMLElement);
        expect(root?.firstElementChild?.nextElementSibling?.id).toBe("mobile-rest-container");
        // The notes stay as they are, so turning the device does not rebuild them.
        expect(root?.querySelector("#detail-container")).toBe(detail);
        // The launch bar sits at the bottom, starting with the toggle of the tree, which stays docked.
        const bottomBar = root?.querySelector(":scope > #mobile-bottom-bar > #launcher-pane.horizontal");
        await vi.waitFor(() => expect(bottomBar?.firstElementChild?.classList.contains("left-pane-toggle-button")).toBe(true));
        expect(bottomBar?.firstElementChild?.classList.contains("bx-chevrons-left")).toBe(true);
        expect(bottomBar?.children[1]?.id).toBe("launcher-container");
    });

    it("applies the appearance options to the body before the first paint, and again as they change", async () => {
        options.set("motionEnabled", "false");
        act(() => { renderLayout(); });
        expect(document.body.classList.contains("motion-disabled")).toBe(true);

        options.set("motionEnabled", "true");
        const loadResults = new LoadResults([]);
        loadResults.addOption("motionEnabled");
        await act(async () => { await appContext.triggerEvent("entitiesReloaded", { loadResults }); });
        expect(document.body.classList.contains("motion-disabled")).toBe(false);
    });

    it("runs the command of a legacy widget's `data-trigger-command` element on a click", () => {
        let container: HTMLElement | undefined;
        act(() => { container = renderLayout(); });
        const splits = container?.querySelector<HTMLElement>(".split-note-container-widget");
        const component = $(splits as HTMLElement).prop("component");
        expect(component).toBeDefined();
        const triggerCommand = vi.spyOn(component, "triggerCommand").mockResolvedValue(undefined);
        const button = splits?.appendChild(document.createElement("button"));
        button?.setAttribute("data-trigger-command", "openNewTab");

        button?.click();
        expect(triggerCommand).toHaveBeenCalledWith("openNewTab", expect.objectContaining({ $el: expect.anything() }));

        triggerCommand.mockClear();
        button?.classList.add("disabled");
        button?.click();
        expect(triggerCommand).not.toHaveBeenCalled();
    });

    it("marks the root while the virtual keyboard covers part of the screen", () => {
        const visualViewport = Object.assign(new EventTarget(), { height: 800, width: 400 });
        Object.defineProperty(window, "visualViewport", { value: visualViewport, configurable: true });
        Object.defineProperty(window, "innerWidth", { value: 400, configurable: true });
        Object.defineProperty(window, "innerHeight", { value: 800, configurable: true });
        try {
            let container: HTMLElement | undefined;
            act(() => { container = renderLayout(); });
            const root = container?.querySelector("#root-widget");

            visualViewport.height = 450;
            visualViewport.dispatchEvent(new Event("resize"));
            expect(root?.classList.contains("virtual-keyboard-opened")).toBe(true);

            visualViewport.height = 800;
            visualViewport.dispatchEvent(new Event("resize"));
            expect(root?.classList.contains("virtual-keyboard-opened")).toBe(false);
        } finally {
            Object.defineProperty(window, "visualViewport", { value: undefined, configurable: true });
            for (const name of [ "--tn-keyboard-height", "--tn-layout-shrink", "--tn-layout-overhang" ]) {
                document.body.style.removeProperty(name);
            }
        }
    });
});

/**
 * Answers `NARROW_LAYOUT` and `STACKED_TREE_LAYOUT` as a phone, a tablet in portrait or a tablet in
 * landscape would, and every other query as the test window does. `turnTo()` changes the answers
 * and notifies the listeners, as turning the device does.
 */
function stubLayoutWidth(initial: "phone" | "portrait" | "tablet") {
    if (vi.isMockFunction(window.matchMedia)) window.matchMedia.mockRestore();
    let layout = initial;
    const listeners = new Set<() => void>();
    const original = window.matchMedia.bind(window);
    vi.spyOn(window, "matchMedia").mockImplementation((query) => {
        if (query !== NARROW_LAYOUT && query !== STACKED_TREE_LAYOUT) return original(query);
        return {
            get matches() {
                return query === NARROW_LAYOUT ? layout !== "tablet" : layout === "phone";
            },
            media: query,
            addEventListener: (_type: string, listener: () => void) => listeners.add(listener),
            removeEventListener: (_type: string, listener: () => void) => listeners.delete(listener)
        } as unknown as MediaQueryList;
    });
    return {
        turnTo(newLayout: "phone" | "portrait" | "tablet") {
            layout = newLayout;
            for (const listener of listeners) listener();
        }
    };
}

function renderLayout() {
    return renderInto(
        <ParentComponent.Provider value={appContext}>
            <MobileLayout />
        </ParentComponent.Provider>
    );
}
