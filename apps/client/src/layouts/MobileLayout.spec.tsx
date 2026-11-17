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

import appContext from "../components/app_context.js";
import NoteContext from "../components/note_context.js";
import LoadResults from "../services/load_results.js";
import options from "../services/options.js";
import server from "../services/server.js";
import { buildNote } from "../test/easy-froca.js";
import { showNoteSplit } from "../test/note_splits.js";
import { renderInto } from "../test/render.js";
import { setCustomWidgets, useCustomWidgets } from "../widgets/react/hooks/custom_widgets.js";
import { ParentComponent } from "../widgets/react/react_utils.js";
import MobileLayout from "./MobileLayout.js";

describe("MobileLayout", () => {
    let device: typeof window.glob.device;
    beforeEach(() => {
        device = window.glob.device;
        window.glob.device = "mobile";
        buildNote({ id: "_lbMobileVisibleLaunchers", title: "Visible Launchers" });
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
    });

    it("gives each note split a title row, a scroller with the note and its search results, then the type bar, editor toolbar and find bar", async () => {
        let container: HTMLElement | undefined;
        act(() => { container = renderLayout(); });
        const splits = container?.querySelector("#mobile-rest-container > #detail-container > .split-note-container-widget");
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
        const container = renderLayout();
        const rest = container.querySelector("#mobile-rest-container");
        expect(rest?.firstElementChild?.id).toBe("mobile-sidebar-wrapper");
        expect(rest?.firstElementChild?.nextElementSibling?.id).toBe("detail-container");
    });

    it("puts the bottom bar under the panes, holding the launchers and then the global menu", () => {
        const container = renderLayout();
        const root = container.querySelector("#root-widget.mobile-layout");

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

function renderLayout() {
    return renderInto(
        <ParentComponent.Provider value={appContext}>
            <MobileLayout />
        </ParentComponent.Provider>
    );
}
