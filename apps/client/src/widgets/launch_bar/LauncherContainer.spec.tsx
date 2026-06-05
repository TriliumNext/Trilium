import { NoteType } from "@triliumnext/commons";
import { render } from "preact";
import { act } from "preact/test-utils";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// --- Module mocks (hoisted above the component import) --------------------------------------------

// Replace every heavy launcher child with a light stub that renders an identifiable marker so we
// can assert which branch of the switch statements ran, without pulling in CKEditor/PDF/legacy widgets.
vi.mock("./BookmarkButtons", () => ({ default: () => <div data-widget="bookmarks" /> }));
vi.mock("./CalendarWidget", () => ({ default: () => <div data-widget="calendar" /> }));
vi.mock("./HistoryNavigation", () => ({ default: ({ command }: { command: string }) => <div data-widget="history" data-command={command} /> }));
vi.mock("./ProtectedSessionStatusWidget", () => ({ default: () => <div data-widget="protectedSession" /> }));
vi.mock("./SidebarChatButton", () => ({ default: () => <div data-widget="sidebarChat" /> }));
vi.mock("./SpacerWidget", () => ({ default: ({ baseSize, growthFactor }: { baseSize: number; growthFactor: number }) => <div data-widget="spacer" data-base-size={baseSize} data-growth-factor={growthFactor} /> }));
vi.mock("./SyncStatus", () => ({ default: () => <div data-widget="syncStatus" /> }));
vi.mock("../mobile_widgets/TabSwitcher", () => ({ default: () => <div data-widget="mobileTabSwitcher" /> }));
vi.mock("./LauncherDefinitions", () => ({
    CommandButton: () => <div data-widget="command" />,
    CustomWidget: () => <div data-widget="customWidget" />,
    NoteLauncher: () => <div data-widget="note" />,
    QuickSearchLauncherWidget: () => <div data-widget="quickSearch" />,
    ScriptLauncher: () => <div data-widget="script" />,
    TodayLauncher: () => <div data-widget="todayInJournal" />
}));

vi.mock("../../services/experimental_features", () => ({
    isExperimentalFeatureEnabled: vi.fn(() => false)
}));

vi.mock("../widget_utils", () => ({
    onWheelHorizontalScroll: vi.fn()
}));

vi.mock("../../services/utils", async (importOriginal) => ({
    ...(await importOriginal<typeof import("../../services/utils")>()),
    isDesktop: vi.fn(() => true),
    isMobile: vi.fn(() => false)
}));

import Component from "../../components/component";
import { isExperimentalFeatureEnabled } from "../../services/experimental_features";
import froca from "../../services/froca";
import server from "../../services/server";
import { isDesktop, isMobile } from "../../services/utils";
import { buildNote } from "../../test/easy-froca";
import { onWheelHorizontalScroll } from "../widget_utils";
import { ParentComponent } from "../react/react_utils";
import LauncherContainer from "./LauncherContainer";

// --- Helpers -------------------------------------------------------------------------------------

interface LauncherDef {
    id: string;
    type?: NoteType;
    launcherType?: string;
    builtinWidget?: string;
    desktopOnly?: boolean;
    baseSize?: string;
    growthFactor?: string;
}

let container: HTMLDivElement | undefined;
let parent: Component;

const VISIBLE_ROOT_ID = "_lbVisibleLaunchers";
const MOBILE_ROOT_ID = "_lbMobileVisibleLaunchers";

/** Builds the visible-launchers root note with the given launcher children injected into froca. */
function buildLaunchersRoot(launchers: LauncherDef[], rootId = VISIBLE_ROOT_ID) {
    const children = launchers.map((l) => {
        const def: Record<string, string> & { id: string; title: string; type?: NoteType } = {
            id: l.id,
            title: l.id,
            type: l.type ?? "launcher"
        };
        if (l.launcherType) def["#launcherType"] = l.launcherType;
        if (l.builtinWidget) def["#builtinWidget"] = l.builtinWidget;
        if (l.desktopOnly) def["#desktopOnly"] = "true";
        if (l.baseSize !== undefined) def["#baseSize"] = l.baseSize;
        if (l.growthFactor !== undefined) def["#growthFactor"] = l.growthFactor;
        return def;
    });
    return buildNote({ id: rootId, title: "Visible Launchers", type: "launcher", children });
}

async function renderContainer(isHorizontalLayout = true) {
    const root = document.createElement("div");
    container = root;
    document.body.appendChild(root);
    act(() => {
        render((
            <ParentComponent.Provider value={parent}>
                <LauncherContainer isHorizontalLayout={isHorizontalLayout} />
            </ParentComponent.Provider>
        ), root);
    });
    // The root-note load and the child-note load are two sequential async effects; drain several
    // microtask/render cycles so both settle.
    for (let i = 0; i < 4; i++) {
        await act(async () => { await new Promise(resolve => setTimeout(resolve, 0)); });
    }
    return root;
}

function widgetMarkers(root: HTMLElement) {
    return Array.from(root.querySelectorAll<HTMLElement>("[data-widget]")).map(el => el.getAttribute("data-widget"));
}

beforeEach(() => {
    parent = new Component();
    for (const key of Object.keys(froca.notes)) delete froca.notes[key];
    for (const key of Object.keys(froca.attributes)) delete froca.attributes[key];
    for (const key of Object.keys(froca.branches)) delete froca.branches[key];
    vi.clearAllMocks();
    Object.assign(server, { put: vi.fn(async () => undefined) });
    (isDesktop as ReturnType<typeof vi.fn>).mockReturnValue(true);
    (isMobile as ReturnType<typeof vi.fn>).mockReturnValue(false);
    (isExperimentalFeatureEnabled as ReturnType<typeof vi.fn>).mockReturnValue(false);
    const glob = (window as unknown as { glob: Record<string, unknown> }).glob;
    glob.TRILIUM_SAFE_MODE = false;
});

afterEach(() => {
    if (container) {
        act(() => { if (container) render(null, container); });
        container.remove();
        container = undefined;
    }
    const glob = (window as unknown as { glob: Record<string, unknown> }).glob;
    delete glob.TRILIUM_SAFE_MODE;
    vi.restoreAllMocks();
});

// --- Container structure --------------------------------------------------------------------------

describe("LauncherContainer layout", () => {
    it("renders a flex container in row direction for horizontal layout", async () => {
        buildLaunchersRoot([ { id: "c1", launcherType: "command" } ]);
        const root = await renderContainer(true);

        const containerEl = root.querySelector<HTMLElement>("#launcher-container");
        expect(containerEl).toBeTruthy();
        expect(containerEl?.style.flexDirection).toBe("row");
        expect(widgetMarkers(root)).toEqual([ "command" ]);
    });

    it("renders in column direction for vertical layout", async () => {
        buildLaunchersRoot([ { id: "c1", launcherType: "command" } ]);
        const root = await renderContainer(false);

        const containerEl = root.querySelector<HTMLElement>("#launcher-container");
        expect(containerEl?.style.flexDirection).toBe("column");
    });

    it("forwards horizontal wheel scrolling, but ignores scrolls inside dropdown menus", async () => {
        buildLaunchersRoot([ { id: "c1", launcherType: "command" } ]);
        const root = await renderContainer(true);
        const containerEl = root.querySelector<HTMLElement>("#launcher-container");
        expect(containerEl).toBeTruthy();

        // A wheel on the container forwards to the scroll helper.
        act(() => containerEl?.dispatchEvent(new WheelEvent("wheel", { bubbles: true })));
        expect(onWheelHorizontalScroll).toHaveBeenCalledTimes(1);

        // A wheel originating inside a `.dropdown-menu` is ignored.
        const menu = document.createElement("div");
        menu.className = "dropdown-menu";
        const inner = document.createElement("span");
        menu.appendChild(inner);
        containerEl?.appendChild(menu);
        act(() => inner.dispatchEvent(new WheelEvent("wheel", { bubbles: true })));
        expect(onWheelHorizontalScroll).toHaveBeenCalledTimes(1);
    });

    it("does not attach a wheel handler in vertical layout", async () => {
        buildLaunchersRoot([ { id: "c1", launcherType: "command" } ]);
        const root = await renderContainer(false);
        const containerEl = root.querySelector<HTMLElement>("#launcher-container");
        act(() => containerEl?.dispatchEvent(new WheelEvent("wheel", { bubbles: true })));
        expect(onWheelHorizontalScroll).not.toHaveBeenCalled();
    });
});

// --- launcherType dispatch ------------------------------------------------------------------------

describe("Launcher launcherType dispatch", () => {
    it("maps each launcherType to its component", async () => {
        buildLaunchersRoot([
            { id: "cmd", launcherType: "command" },
            { id: "nte", launcherType: "note" },
            { id: "scr", launcherType: "script" },
            { id: "cw", launcherType: "customWidget" }
        ]);
        const root = await renderContainer();
        expect(widgetMarkers(root)).toEqual([ "command", "note", "script", "customWidget" ]);
    });

    it("warns and renders nothing for an unrecognized launcherType", async () => {
        const warn = vi.spyOn(console, "warn").mockImplementation(() => undefined);
        buildLaunchersRoot([ { id: "bad", launcherType: "bogus" } ]);
        const root = await renderContainer();
        expect(widgetMarkers(root)).toEqual([]);
        expect(warn).toHaveBeenCalled();
    });

    it("hides customWidget launchers in safe mode", async () => {
        const glob = (window as unknown as { glob: Record<string, unknown> }).glob;
        glob.TRILIUM_SAFE_MODE = true;
        buildLaunchersRoot([
            { id: "cw", launcherType: "customWidget" },
            { id: "cmd", launcherType: "command" }
        ]);
        const root = await renderContainer();
        // customWidget is suppressed; the command launcher still renders.
        expect(widgetMarkers(root)).toEqual([ "command" ]);
    });
});

// --- builtinWidget dispatch -----------------------------------------------------------------------

describe("initBuiltinWidget dispatch", () => {
    it("maps each builtin widget to its component", async () => {
        buildLaunchersRoot([
            { id: "cal", launcherType: "builtinWidget", builtinWidget: "calendar" },
            { id: "bm", launcherType: "builtinWidget", builtinWidget: "bookmarks" },
            { id: "ps", launcherType: "builtinWidget", builtinWidget: "protectedSession" },
            { id: "ss", launcherType: "builtinWidget", builtinWidget: "syncStatus" },
            { id: "today", launcherType: "builtinWidget", builtinWidget: "todayInJournal" },
            { id: "qs", launcherType: "builtinWidget", builtinWidget: "quickSearch" },
            { id: "mts", launcherType: "builtinWidget", builtinWidget: "mobileTabSwitcher" }
        ]);
        const root = await renderContainer();
        expect(widgetMarkers(root)).toEqual([
            "calendar", "bookmarks", "protectedSession", "syncStatus",
            "todayInJournal", "quickSearch", "mobileTabSwitcher"
        ]);
    });

    it("maps history buttons to the navigation widget with the right command", async () => {
        buildLaunchersRoot([
            { id: "back", launcherType: "builtinWidget", builtinWidget: "backInHistoryButton" },
            { id: "fwd", launcherType: "builtinWidget", builtinWidget: "forwardInHistoryButton" }
        ]);
        const root = await renderContainer();
        const histories = Array.from(root.querySelectorAll<HTMLElement>("[data-widget='history']"));
        expect(histories.map(el => el.getAttribute("data-command"))).toEqual([
            "backInNoteHistory", "forwardInNoteHistory"
        ]);
    });

    it("parses spacer sizes, applying defaults when labels are missing", async () => {
        buildLaunchersRoot([
            { id: "sp1", launcherType: "builtinWidget", builtinWidget: "spacer", baseSize: "20", growthFactor: "5" },
            { id: "sp2", launcherType: "builtinWidget", builtinWidget: "spacer" }
        ]);
        const root = await renderContainer();
        const spacers = Array.from(root.querySelectorAll<HTMLElement>("[data-widget='spacer']"));
        expect(spacers).toHaveLength(2);
        expect(spacers[0].getAttribute("data-base-size")).toBe("20");
        expect(spacers[0].getAttribute("data-growth-factor")).toBe("5");
        // Defaults: baseSize 40, growthFactor 100.
        expect(spacers[1].getAttribute("data-base-size")).toBe("40");
        expect(spacers[1].getAttribute("data-growth-factor")).toBe("100");
    });

    it("renders the sidebar chat only when the LLM experimental feature is enabled", async () => {
        buildLaunchersRoot([ { id: "chat", launcherType: "builtinWidget", builtinWidget: "sidebarChat" } ]);

        // Disabled → nothing.
        let root = await renderContainer();
        expect(widgetMarkers(root)).toEqual([]);
        act(() => { if (container) render(null, container); });
        container?.remove();
        container = undefined;

        // Enabled → sidebar chat.
        (isExperimentalFeatureEnabled as ReturnType<typeof vi.fn>).mockReturnValue(true);
        root = await renderContainer();
        expect(widgetMarkers(root)).toEqual([ "sidebarChat" ]);
    });

    it("warns and renders nothing for an unrecognized builtin widget", async () => {
        const warn = vi.spyOn(console, "warn").mockImplementation(() => undefined);
        buildLaunchersRoot([ { id: "x", launcherType: "builtinWidget", builtinWidget: "nope" } ]);
        const root = await renderContainer();
        expect(widgetMarkers(root)).toEqual([]);
        expect(warn).toHaveBeenCalled();
    });
});

// --- Child note filtering -------------------------------------------------------------------------

describe("LauncherContainer child filtering", () => {
    it("warns about and skips non-launcher children", async () => {
        const warn = vi.spyOn(console, "warn").mockImplementation(() => undefined);
        buildLaunchersRoot([
            { id: "real", launcherType: "command" },
            { id: "notLauncher", type: "text", launcherType: "command" }
        ]);
        const root = await renderContainer();
        expect(widgetMarkers(root)).toEqual([ "command" ]);
        expect(warn).toHaveBeenCalled();
    });

    it("hides desktopOnly launchers on non-desktop platforms", async () => {
        (isDesktop as ReturnType<typeof vi.fn>).mockReturnValue(false);
        buildLaunchersRoot([
            { id: "desk", launcherType: "command", desktopOnly: true },
            { id: "any", launcherType: "note" }
        ]);
        const root = await renderContainer();
        expect(widgetMarkers(root)).toEqual([ "note" ]);
    });

    it("shows desktopOnly launchers on desktop", async () => {
        (isDesktop as ReturnType<typeof vi.fn>).mockReturnValue(true);
        buildLaunchersRoot([ { id: "desk", launcherType: "command", desktopOnly: true } ]);
        const root = await renderContainer();
        expect(widgetMarkers(root)).toEqual([ "command" ]);
    });
});

// --- Root resolution & refresh --------------------------------------------------------------------

describe("useLauncherChildNotes", () => {
    it("uses the mobile visible-launchers root on mobile", async () => {
        (isMobile as ReturnType<typeof vi.fn>).mockReturnValue(true);
        buildLaunchersRoot([ { id: "m1", launcherType: "command" } ], MOBILE_ROOT_ID);
        const root = await renderContainer();
        expect(widgetMarkers(root)).toEqual([ "command" ]);
    });

    it("renders nothing when the visible-launchers root is absent", async () => {
        // No root note built → froca.getNote resolves to null (silently, via cache miss → server),
        // so spy getNote to avoid the throwing mock server.
        vi.spyOn(froca, "getNote").mockResolvedValue(null);
        const root = await renderContainer();
        expect(widgetMarkers(root)).toEqual([]);
    });

    it("refreshes children when a launch-bar branch is reloaded", async () => {
        const rootNote = buildLaunchersRoot([ { id: "first", launcherType: "command" } ]);
        const root = await renderContainer();
        expect(widgetMarkers(root)).toEqual([ "command" ]);

        // Add a second launcher to the root, then fire an entitiesReloaded event whose branch
        // parent is a launch-bar-config note so the refresh path runs.
        const extra = buildNote({ id: "second", title: "second", type: "launcher", "#launcherType": "note" });
        const branchId = `${rootNote.noteId}_second`;
        rootNote.addChild(extra.noteId, branchId, false);

        const loadResults = {
            getBranchRows: () => [ { parentNoteId: rootNote.noteId } ]
        };
        await act(async () => {
            (parent.handleEventInChildren as (n: string, d: unknown) => void)("entitiesReloaded", { loadResults });
            await new Promise(resolve => setTimeout(resolve, 0));
        });
        expect(widgetMarkers(root)).toEqual([ "command", "note" ]);
    });

    it("ignores entitiesReloaded events unrelated to launch-bar config", async () => {
        const rootNote = buildLaunchersRoot([ { id: "only", launcherType: "command" } ]);
        const root = await renderContainer();

        // Add a child but fire an event with a non-launch-bar parent branch → no refresh.
        const extra = buildNote({ id: "ignored", title: "ignored", type: "launcher", "#launcherType": "note" });
        rootNote.addChild(extra.noteId, `${rootNote.noteId}_ignored`, false);

        const unrelated = buildNote({ id: "unrelatedParent", title: "Unrelated", type: "text" });
        const loadResults = {
            getBranchRows: () => [ { parentNoteId: unrelated.noteId } ]
        };
        await act(async () => {
            (parent.handleEventInChildren as (n: string, d: unknown) => void)("entitiesReloaded", { loadResults });
            await new Promise(resolve => setTimeout(resolve, 0));
        });
        // Still only the original launcher (refresh did not run).
        expect(widgetMarkers(root)).toEqual([ "command" ]);
    });

    it("ignores branch rows without a parent note id", async () => {
        buildLaunchersRoot([ { id: "solo", launcherType: "command" } ]);
        const root = await renderContainer();
        const loadResults = {
            getBranchRows: () => [ { parentNoteId: null } ]
        };
        await act(async () => {
            (parent.handleEventInChildren as (n: string, d: unknown) => void)("entitiesReloaded", { loadResults });
            await new Promise(resolve => setTimeout(resolve, 0));
        });
        expect(widgetMarkers(root)).toEqual([ "command" ]);
    });
});
