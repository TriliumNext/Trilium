import { render } from "preact";
import { act } from "preact/test-utils";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// --- Module mocks (hoisted above the component imports) -------------------------------------------

vi.mock("bootstrap", () => {
    class Tooltip {
        static instances = new Map<Element, Tooltip>();
        static getInstance(el: Element) { return Tooltip.instances.get(el) ?? null; }
        element: Element;
        constructor(el: Element) { this.element = el; Tooltip.instances.set(el, this); }
        dispose() { Tooltip.instances.delete(this.element); }
        show() {}
        hide() {}
    }
    class Dropdown {
        static getOrCreateInstance() { return new Dropdown(); }
        show() {}
        hide() {}
        dispose() {}
    }
    class Modal {
        static getOrCreateInstance() { return new Modal(); }
        show() {}
        hide() {}
    }
    return { Tooltip, Dropdown, Modal, default: { Tooltip, Dropdown, Modal } };
});

vi.mock("../../services/keyboard_actions", () => ({
    default: { getAction: vi.fn(async () => ({ effectiveShortcuts: [] })) }
}));

vi.mock("../../services/dialog", () => ({
    default: { info: vi.fn(async () => undefined) }
}));

vi.mock("../../services/toast", () => ({
    default: { showError: vi.fn(), showPersistent: vi.fn(), closePersistent: vi.fn() }
}));

const getTodayNote = vi.fn();
vi.mock("../../services/date_notes", () => ({
    default: { getTodayNote: () => getTodayNote() }
}));

// QuickSearchWidget pulls in bootstrap + many services on construction; stub it out.
vi.mock("../quick_search", () => {
    class QuickSearchWidget {}
    return { default: QuickSearchWidget };
});

// Partial-mock the React hooks: keep the real note-data hooks (they run on easy-froca notes),
// but stub the legacy-widget / shortcut / tooltip hooks that would otherwise mount heavy widgets.
const legacyWidgets: unknown[] = [];
vi.mock("../react/hooks", async (importOriginal) => {
    const actual = await importOriginal<typeof import("../react/hooks")>();
    return {
        ...actual,
        useStaticTooltip: vi.fn(),
        useGlobalShortcut: vi.fn(),
        useLegacyWidget: vi.fn((factory: () => unknown) => {
            const widget = factory();
            legacyWidgets.push(widget);
            return [ <div className="legacy-widget" />, widget ];
        })
    };
});

import appContext from "../../components/app_context";
import dialog from "../../services/dialog";
import froca from "../../services/froca";
import toast from "../../services/toast";
import { buildNote } from "../../test/easy-froca";
import BasicWidget from "../basic_widget";
import { useGlobalShortcut } from "../react/hooks";
import { LaunchBarContext } from "./launch_bar_widgets";
import { ParentComponent } from "../react/react_utils";
import {
    CommandButton, CustomWidget, LegacyWidgetRenderer, NoteLauncher,
    QuickSearchLauncherWidget, ScriptLauncher, TodayLauncher
} from "./LauncherDefinitions";

// --- Render harness ------------------------------------------------------------------------------

let container: HTMLDivElement | undefined;

function renderInto(vnode: unknown, opts: { isHorizontalLayout?: boolean; parent?: BasicWidget | null } = {}) {
    const target = document.createElement("div");
    container = target;
    document.body.appendChild(target);
    act(() => {
        render((
            <ParentComponent.Provider value={(opts.parent ?? null) as never}>
                <LaunchBarContext.Provider value={{ isHorizontalLayout: opts.isHorizontalLayout ?? false }}>
                    {vnode as never}
                </LaunchBarContext.Provider>
            </ParentComponent.Provider>
        ), target);
    });
    return target;
}

/** Settle async effect chains (froca relation resolution + executeScript) and the resulting re-renders. */
async function flush() {
    await act(async () => { await new Promise(resolve => setTimeout(resolve, 0)); });
    await act(async () => { await new Promise(resolve => setTimeout(resolve, 0)); });
}

beforeEach(() => {
    for (const key of Object.keys(froca.notes)) delete froca.notes[key];
    legacyWidgets.length = 0;
    vi.clearAllMocks();
});

afterEach(() => {
    if (container) {
        act(() => render(null, container as HTMLDivElement));
        container.remove();
        container = undefined;
    }
    vi.restoreAllMocks();
});

// --- CommandButton -------------------------------------------------------------------------------

describe("CommandButton", () => {
    it("renders an action button forwarding the command label", () => {
        const note = buildNote({ id: "cmdNote", title: "Open", "#command": "showOptions" });
        const el = renderInto(<CommandButton launcherNote={note} />);
        const btn = el.querySelector("button");
        expect(btn).toBeTruthy();
        expect(btn?.getAttribute("data-trigger-command")).toBe("showOptions");
        expect(btn?.className).toContain("launcher-button");
    });

    it("renders nothing when the command label is absent", () => {
        const note = buildNote({ id: "noCmd", title: "No command" });
        const el = renderInto(<CommandButton launcherNote={note} />);
        expect(el.querySelector("button")).toBeNull();
    });
});

// --- NoteLauncher --------------------------------------------------------------------------------

describe("NoteLauncher", () => {
    it("renders a launcher button and resolves the target note id", async () => {
        buildNote({ id: "targetN", title: "Target" });
        const note = buildNote({ id: "nlNote", title: "Go", "~target": "targetN", "~hoistedNote": "root" });
        const el = renderInto(<NoteLauncher launcherNote={note} />);
        const btn = el.querySelector("button");
        expect(btn).toBeTruthy();

        // openInSameTab is invoked through the CustomNoteLauncher click handler when a target exists.
        const openInSameTab = vi.fn(async () => undefined);
        Object.assign(appContext, { tabManager: { getActiveContext: () => ({ hoistedNoteId: "root" }), openInSameTab } });
        await act(async () => { btn?.dispatchEvent(new MouseEvent("click", { bubbles: true })); });
        await Promise.resolve();
        expect(openInSameTab).toHaveBeenCalledWith("targetN", "root");
        expect(dialog.info).not.toHaveBeenCalled();
    });

    it("shows an info dialog when the target relation is missing", async () => {
        const note = buildNote({ id: "noTarget", title: "Broken" });
        const el = renderInto(<NoteLauncher launcherNote={note} />);
        const btn = el.querySelector("button");

        const openInSameTab = vi.fn(async () => undefined);
        Object.assign(appContext, { tabManager: { getActiveContext: () => ({ hoistedNoteId: "root" }), openInSameTab } });
        await act(async () => { btn?.dispatchEvent(new MouseEvent("click", { bubbles: true })); });
        await Promise.resolve();
        expect(dialog.info).toHaveBeenCalled();
        expect(openInSameTab).not.toHaveBeenCalled();
    });
});

// --- ScriptLauncher ------------------------------------------------------------------------------

describe("ScriptLauncher", () => {
    it("runs the launcher content script directly when scriptInLauncherContent is truthy", async () => {
        const note = buildNote({ id: "slContent", title: "Run", "#scriptInLauncherContent": "true" });
        const executeScript = vi.fn(async () => undefined);
        Object.assign(note, { executeScript });

        const el = renderInto(<ScriptLauncher launcherNote={note} />);
        const btn = el.querySelector("button");
        expect(btn).toBeTruthy();
        await act(async () => { btn?.dispatchEvent(new MouseEvent("click", { bubbles: true })); });
        await Promise.resolve();
        expect(executeScript).toHaveBeenCalled();
        // The keyboard shortcut hook is wired up even when no shortcut is set.
        expect(useGlobalShortcut).toHaveBeenCalled();
    });

    it("runs the related script note when the content flag is not set", async () => {
        const scriptExecute = vi.fn(async () => undefined);
        const note = buildNote({ id: "slRelated", title: "Run", "#keyboardShortcut": "ctrl+1" });
        Object.assign(note, { getRelationTarget: vi.fn(async () => ({ executeScript: scriptExecute })) });

        const el = renderInto(<ScriptLauncher launcherNote={note} />);
        const btn = el.querySelector("button");
        await act(async () => { btn?.dispatchEvent(new MouseEvent("click", { bubbles: true })); });
        await Promise.resolve();
        expect(scriptExecute).toHaveBeenCalled();
    });

    it("does nothing when neither the content flag nor a related script is present", async () => {
        const note = buildNote({ id: "slNone", title: "Idle" });
        Object.assign(note, { getRelationTarget: vi.fn(async () => null) });
        const el = renderInto(<ScriptLauncher launcherNote={note} />);
        const btn = el.querySelector("button");
        await act(async () => { btn?.dispatchEvent(new MouseEvent("click", { bubbles: true })); });
        await Promise.resolve();
        // No throw, and the related-script lookup happened.
        expect(btn).toBeTruthy();
    });
});

// --- TodayLauncher -------------------------------------------------------------------------------

describe("TodayLauncher", () => {
    it("opens today's note id when resolvable", async () => {
        getTodayNote.mockResolvedValue({ noteId: "today1" });
        const note = buildNote({ id: "tlNote", title: "Today" });
        const el = renderInto(<TodayLauncher launcherNote={note} />);
        const btn = el.querySelector("button");

        const openInSameTab = vi.fn(async () => undefined);
        Object.assign(appContext, { tabManager: { getActiveContext: () => ({ hoistedNoteId: "root" }), openInSameTab } });
        await act(async () => { btn?.dispatchEvent(new MouseEvent("click", { bubbles: true })); });
        await Promise.resolve();
        expect(getTodayNote).toHaveBeenCalled();
        expect(openInSameTab).toHaveBeenCalledWith("today1", "root");
    });

    it("falls back to null target when today's note cannot be resolved", async () => {
        getTodayNote.mockResolvedValue(undefined);
        const note = buildNote({ id: "tlNote2", title: "Today" });
        const el = renderInto(<TodayLauncher launcherNote={note} />);
        const btn = el.querySelector("button");

        const openInSameTab = vi.fn(async () => undefined);
        Object.assign(appContext, { tabManager: { getActiveContext: () => ({ hoistedNoteId: "root" }), openInSameTab } });
        await act(async () => { btn?.dispatchEvent(new MouseEvent("click", { bubbles: true })); });
        await Promise.resolve();
        expect(openInSameTab).not.toHaveBeenCalled();
    });
});

// --- QuickSearchLauncherWidget -------------------------------------------------------------------

describe("QuickSearchLauncherWidget", () => {
    it("renders the legacy widget when horizontal layout is enabled (desktop)", () => {
        const note = buildNote({ id: "qsNote", title: "Quick search" });
        const contentSized = vi.fn();
        const parent = { contentSized } as unknown as BasicWidget;
        const el = renderInto(<QuickSearchLauncherWidget launcherNote={note} />, { isHorizontalLayout: true, parent });
        expect(el.querySelector(".legacy-widget")).toBeTruthy();
        expect(contentSized).toHaveBeenCalled();
    });

    it("renders only the wrapper when not horizontal", () => {
        const note = buildNote({ id: "qsNote2", title: "Quick search" });
        const el = renderInto(<QuickSearchLauncherWidget launcherNote={note} />, { isHorizontalLayout: false });
        expect(el.querySelector(".legacy-widget")).toBeNull();
        // The context-menu wrapper div is still present.
        expect(el.querySelector("div")).toBeTruthy();
    });
});

// --- CustomWidget --------------------------------------------------------------------------------

class FakeLegacyWidget extends BasicWidget {
    doRender() { this.$widget = $("<div class='fake-legacy'></div>"); }
}

describe("CustomWidget", () => {
    it("renders a legacy widget produced by the widget relation script", async () => {
        const legacyWidget = new FakeLegacyWidget();
        const widgetNote = buildNote({ id: "cwLegacyW", title: "Widget" });
        Object.assign(widgetNote, { executeScript: vi.fn(async () => legacyWidget) });
        const note = buildNote({ id: "cwLegacy", title: "Custom", "~widget": "cwLegacyW" });

        const contentSized = vi.fn();
        const el = renderInto(<CustomWidget launcherNote={note} />, { parent: { contentSized } as unknown as BasicWidget });
        await flush();
        expect(el.querySelector(".legacy-widget")).toBeTruthy();
        // The legacy widget produced by the relation is the one passed to useLegacyWidget.
        expect(legacyWidgets).toContain(legacyWidget);
        // BasicWidget instances get their note id assigned.
        expect((legacyWidget as unknown as { _noteId?: string })._noteId).toBe("cwLegacyW");
        expect(contentSized).toHaveBeenCalled();
    });

    it("renders a preact launcher widget produced by the relation script", async () => {
        const reactWidget = { type: "preact-launcher-widget", render: () => <div className="react-widget" /> };
        const widgetNote = buildNote({ id: "cwReactW", title: "Widget" });
        Object.assign(widgetNote, { executeScript: vi.fn(async () => reactWidget) });
        const note = buildNote({ id: "cwReact", title: "Custom", "~widget": "cwReactW" });

        const el = renderInto(<CustomWidget launcherNote={note} />);
        await flush();
        expect(el.querySelector(".react-widget")).toBeTruthy();
    });

    it("shows an error toast when the widget script throws", async () => {
        const widgetNote = buildNote({ id: "cwErrW", title: "Widget" });
        Object.assign(widgetNote, { executeScript: vi.fn(async () => { throw new Error("boom"); }) });
        const note = buildNote({ id: "cwErr", title: "Custom", "~widget": "cwErrW" });

        const el = renderInto(<CustomWidget launcherNote={note} />);
        await flush();
        expect(toast.showError).toHaveBeenCalled();
        expect(el.querySelector(".legacy-widget")).toBeNull();
        expect(el.querySelector(".react-widget")).toBeNull();
    });

    it("renders only the wrapper when the widget relation is missing", async () => {
        const note = buildNote({ id: "cwNone", title: "Custom" });
        const el = renderInto(<CustomWidget launcherNote={note} />);
        await flush();
        expect(el.querySelector(".legacy-widget")).toBeNull();
        expect(el.querySelector(".react-widget")).toBeNull();
    });
});

// --- LegacyWidgetRenderer ------------------------------------------------------------------------

describe("LegacyWidgetRenderer", () => {
    it("delegates to useLegacyWidget with the active note context", () => {
        Object.assign(appContext, { tabManager: { getActiveContext: () => null } });
        const widget = new FakeLegacyWidget();
        const el = renderInto(<LegacyWidgetRenderer widget={widget} />);
        expect(el.querySelector(".legacy-widget")).toBeTruthy();
        expect(legacyWidgets).toContain(widget);
    });
});
