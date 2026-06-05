import { render } from "preact";
import { act } from "preact/test-utils";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// --- Module mocks (hoisted above the component import) --------------------------------------------

vi.mock("bootstrap", () => {
    class Tooltip {
        static instances = new Map<Element, Tooltip>();
        static getInstance(el: Element) { return Tooltip.instances.get(el) ?? null; }
        element: Element;
        config: unknown;
        constructor(el: Element, config?: unknown) { this.element = el; this.config = config; Tooltip.instances.set(el, this); }
        dispose() { Tooltip.instances.delete(this.element); }
        show() {}
        hide() {}
    }
    return { Tooltip, default: { Tooltip } };
});
vi.mock("../../services/keyboard_actions", () => ({
    default: {
        getAction: vi.fn(async () => ({ effectiveShortcuts: [] })),
        setupActionsForElement: vi.fn(async () => [])
    }
}));
vi.mock("../../services/shortcuts", () => ({
    default: { bindGlobalShortcut: vi.fn(), removeGlobalShortcut: vi.fn() },
    removeIndividualBinding: vi.fn()
}));
vi.mock("../../menus/launcher_button_context_menu", () => ({
    showLauncherContextMenu: vi.fn(async () => undefined),
    canRemoveFromLaunchBar: vi.fn(() => false)
}));
vi.mock("../../menus/link_context_menu", () => ({
    default: {
        getItems: vi.fn(() => [ { title: "Open", command: "openNoteInNewTab" } ]),
        handleLinkContextMenuItem: vi.fn(() => true)
    }
}));

import appContext from "../../components/app_context";
import Component from "../../components/component";
import { showLauncherContextMenu } from "../../menus/launcher_button_context_menu";
import link_context_menu from "../../menus/link_context_menu";
import shortcuts from "../../services/shortcuts";
import { buildNote } from "../../test/easy-froca";
import { flush } from "../../test/render-hook";
import { ParentComponent } from "../react/react_utils";
import { CustomNoteLauncher, launchCustomNoteLauncher } from "./GenericButtons";

// --- Render helper (mirrors react_utils' ParentComponent.Provider) --------------------------------

let container: HTMLDivElement | undefined;
let parent: Component;

function renderLauncher(vnode: preact.VNode) {
    const localContainer = document.createElement("div");
    container = localContainer;
    document.body.appendChild(localContainer);
    act(() => {
        render(<ParentComponent.Provider value={parent}>{vnode}</ParentComponent.Provider>, localContainer);
    });
    const button = localContainer.querySelector("button");
    if (!button) throw new Error("button not rendered");
    return { container: localContainer, button };
}

function makeMouseEvent(type: string, init: Partial<MouseEvent> = {}) {
    const evt = new MouseEvent(type, { bubbles: true, cancelable: true });
    Object.assign(evt, init);
    return evt;
}

beforeEach(() => {
    parent = new Component();
    vi.clearAllMocks();
});

afterEach(() => {
    if (container) {
        render(null, container);
        container.remove();
        container = undefined;
    }
    vi.restoreAllMocks();
});

// --- Component rendering ---------------------------------------------------------------------------

describe("CustomNoteLauncher", () => {
    it("renders an action button with the launcher icon/title and binds the keyboard shortcut", () => {
        const launcherNote = buildNote({ id: "lc1", title: "My Launcher", "#keyboardShortcut": "ctrl+l" });
        const getTargetNoteId = vi.fn(() => "target1");
        const { button } = renderLauncher(
            <CustomNoteLauncher launcherNote={launcherNote} getTargetNoteId={getTargetNoteId} />
        );

        // Icon class from the note is applied to the button, and the launcher classes are present.
        expect(button.className).toContain(launcherNote.getIcon());
        expect(button.className).toContain("launcher-button");

        // The keyboardShortcut label drives useGlobalShortcut → bindGlobalShortcut.
        expect(shortcuts.bindGlobalShortcut).toHaveBeenCalledWith("ctrl+l", expect.any(Function), expect.any(String));
    });

    it("does not bind a shortcut when the launcher has no keyboardShortcut label", () => {
        const launcherNote = buildNote({ id: "lc2", title: "No Shortcut" });
        renderLauncher(<CustomNoteLauncher launcherNote={launcherNote} getTargetNoteId={() => "t"} />);
        expect(shortcuts.bindGlobalShortcut).not.toHaveBeenCalled();
    });
});

// --- onClick / onAuxClick → launchCustomNoteLauncher ----------------------------------------------

describe("CustomNoteLauncher click handling", () => {
    it("opens the target in the same tab on a plain left click", async () => {
        const openInSameTab = vi.fn(async () => undefined);
        const openInNewTab = vi.fn(async () => undefined);
        Object.assign(appContext, { tabManager: { getActiveContext: () => ({ hoistedNoteId: "root" }), openInSameTab, openInNewTab } });

        const launcherNote = buildNote({ id: "lc3", title: "L" });
        const getTargetNoteId = vi.fn(() => "target3");
        const { button } = renderLauncher(<CustomNoteLauncher launcherNote={launcherNote} getTargetNoteId={getTargetNoteId} />);

        await act(async () => { button.dispatchEvent(makeMouseEvent("click", { which: 1 })); });
        await flush();

        expect(getTargetNoteId).toHaveBeenCalledWith(launcherNote);
        expect(openInSameTab).toHaveBeenCalledWith("target3", "root");
        expect(openInNewTab).not.toHaveBeenCalled();
    });

    it("opens the target in a new tab via auxclick (middle-button which=2)", async () => {
        const openInSameTab = vi.fn(async () => undefined);
        const openInNewTab = vi.fn(async () => undefined);
        Object.assign(appContext, { tabManager: { getActiveContext: () => ({ hoistedNoteId: "root" }), openInSameTab, openInNewTab } });

        const launcherNote = buildNote({ id: "lc4", title: "L" });
        const { button } = renderLauncher(<CustomNoteLauncher launcherNote={launcherNote} getTargetNoteId={() => "target4"} />);

        await act(async () => { button.dispatchEvent(makeMouseEvent("auxclick", { which: 2, shiftKey: true })); });
        await flush();

        expect(openInNewTab).toHaveBeenCalledWith("target4", "root", true);
        expect(openInSameTab).not.toHaveBeenCalled();
    });
});

// --- onContextMenu --------------------------------------------------------------------------------

describe("CustomNoteLauncher context menu", () => {
    it("prevents default, fetches the target, includes link items, and forwards commands", async () => {
        Object.assign(appContext, { tabManager: { getActiveContext: () => ({ hoistedNoteId: "root" }) } });
        const launcherNote = buildNote({ id: "lc5", title: "L" });
        const getTargetNoteId = vi.fn(async () => "target5");
        const getHoistedNoteId = vi.fn(() => "hoisted5");
        const { button } = renderLauncher(
            <CustomNoteLauncher launcherNote={launcherNote} getTargetNoteId={getTargetNoteId} getHoistedNoteId={getHoistedNoteId} />
        );

        const evt = makeMouseEvent("contextmenu", { which: 3 });
        const preventDefault = vi.spyOn(evt, "preventDefault");
        await act(async () => { button.dispatchEvent(evt); });
        await flush();

        expect(preventDefault).toHaveBeenCalled();
        expect(getTargetNoteId).toHaveBeenCalledWith(launcherNote);
        expect(getHoistedNoteId).toHaveBeenCalledWith(launcherNote);
        // Target present → link items pulled and passed as extraItems.
        expect(link_context_menu.getItems).toHaveBeenCalledWith(evt);
        const mockShow = vi.mocked(showLauncherContextMenu);
        expect(mockShow).toHaveBeenCalledTimes(1);
        const call = mockShow.mock.calls[0];
        expect(call?.[0]).toBe(launcherNote);
        const options = call?.[2];
        expect(options?.extraItems?.length).toBe(1);

        // Exercise the onCommand callback: with a command + target it forwards to the link handler.
        options?.onCommand?.("openNoteInNewTab");
        expect(link_context_menu.handleLinkContextMenuItem).toHaveBeenCalledWith(
            "openNoteInNewTab", evt, "target5", {}, "hoisted5"
        );

        // A falsy command must NOT forward.
        vi.mocked(link_context_menu.handleLinkContextMenuItem).mockClear();
        options?.onCommand?.(undefined);
        expect(link_context_menu.handleLinkContextMenuItem).not.toHaveBeenCalled();
    });

    it("passes no link items and a null hoisted id when there is no target note", async () => {
        Object.assign(appContext, { tabManager: { getActiveContext: () => null } });
        const launcherNote = buildNote({ id: "lc6", title: "L" });
        const { button } = renderLauncher(
            <CustomNoteLauncher launcherNote={launcherNote} getTargetNoteId={async () => null} />
        );

        const evt = makeMouseEvent("contextmenu", { which: 3 });
        await act(async () => { button.dispatchEvent(evt); });
        await flush();

        expect(link_context_menu.getItems).not.toHaveBeenCalled();
        const mockShow = vi.mocked(showLauncherContextMenu);
        const options = mockShow.mock.calls[0]?.[2];
        expect(options?.extraItems).toEqual([]);

        // onCommand with a command but no target → handler not invoked.
        options?.onCommand?.("openNoteInNewTab");
        expect(link_context_menu.handleLinkContextMenuItem).not.toHaveBeenCalled();
    });
});

// --- launchCustomNoteLauncher (direct unit) -------------------------------------------------------

describe("launchCustomNoteLauncher", () => {
    let openInSameTab: ReturnType<typeof vi.fn>;
    let openInNewTab: ReturnType<typeof vi.fn>;

    beforeEach(() => {
        openInSameTab = vi.fn(async () => undefined);
        openInNewTab = vi.fn(async () => undefined);
        Object.assign(appContext, {
            tabManager: { getActiveContext: () => ({ hoistedNoteId: "activeHoisted" }), openInSameTab, openInNewTab }
        });
    });

    it("returns early on a right-click (which === 3) without resolving a target", async () => {
        const launcherNote = buildNote({ id: "ln1", title: "L" });
        const getTargetNoteId = vi.fn(() => "t");
        await launchCustomNoteLauncher(makeMouseEvent("mousedown", { which: 3 }), { launcherNote, getTargetNoteId });
        expect(getTargetNoteId).not.toHaveBeenCalled();
        expect(openInSameTab).not.toHaveBeenCalled();
    });

    it("returns early when getTargetNoteId resolves to nothing", async () => {
        const launcherNote = buildNote({ id: "ln2", title: "L" });
        await launchCustomNoteLauncher(makeMouseEvent("click", { which: 1 }), { launcherNote, getTargetNoteId: async () => null });
        expect(openInSameTab).not.toHaveBeenCalled();
        expect(openInNewTab).not.toHaveBeenCalled();
    });

    it("opens in the same tab and falls back to the active context's hoisted note id", async () => {
        const launcherNote = buildNote({ id: "ln3", title: "L" });
        await launchCustomNoteLauncher(makeMouseEvent("click", { which: 1 }), { launcherNote, getTargetNoteId: () => "tgt3" });
        expect(openInSameTab).toHaveBeenCalledWith("tgt3", "activeHoisted");
    });

    it("prefers an explicit getHoistedNoteId over the active context's", async () => {
        const launcherNote = buildNote({ id: "ln4", title: "L" });
        await launchCustomNoteLauncher(makeMouseEvent("click", { which: 1 }), {
            launcherNote, getTargetNoteId: () => "tgt4", getHoistedNoteId: () => "explicitHoisted"
        });
        expect(openInSameTab).toHaveBeenCalledWith("tgt4", "explicitHoisted");
    });

    it("opens in a new tab on ctrl+left-click (which === 1, ctrlKey) without activation", async () => {
        const launcherNote = buildNote({ id: "ln5", title: "L" });
        await launchCustomNoteLauncher(makeMouseEvent("click", { which: 1, ctrlKey: true }), {
            launcherNote, getTargetNoteId: () => "tgt5"
        });
        expect(openInNewTab).toHaveBeenCalledWith("tgt5", "activeHoisted", false);
        expect(openInSameTab).not.toHaveBeenCalled();
    });

    it("opens in a new tab with activation on middle-click + shift", async () => {
        const launcherNote = buildNote({ id: "ln6", title: "L" });
        await launchCustomNoteLauncher(makeMouseEvent("auxclick", { which: 2, shiftKey: true }), {
            launcherNote, getTargetNoteId: () => "tgt6"
        });
        expect(openInNewTab).toHaveBeenCalledWith("tgt6", "activeHoisted", true);
    });
});
