import { render } from "preact";
import { act } from "preact/test-utils";
import { afterEach, describe, expect, it, vi } from "vitest";

import Component from "../../components/component.js";
import type FNote from "../../entities/fnote.js";
import options from "../../services/options.js";
import { buildNote } from "../../test/easy-froca.js";
import { TREE_CLIPBOARD_TYPE } from "../react/hooks/drag.js";
import { ParentComponent } from "../react/react_utils.js";
import LauncherContainer, { useLauncherChildNotes } from "./LauncherContainer.js";

const h = vi.hoisted(() => ({
    isElectron: false, showLauncherContextMenu: vi.fn(), tabSwitcherLoaded: false, recordMeetingLoaded: false,
    dropTargetLoaded: false, customWidgetLoaded: false, ...gate()
}));

/** A promise the tab switcher's module waits on, so a case can see the bar before it loads. */
function gate() {
    let openTabSwitcherGate = () => {};
    const tabSwitcherGate = new Promise<void>((resolve) => { openTabSwitcherGate = resolve; });
    return { tabSwitcherGate, openTabSwitcherGate };
}

vi.mock("../../services/utils", async (importOriginal) => ({
    ...await importOriginal<typeof import("../../services/utils")>(),
    isElectron: () => h.isElectron
}));
vi.mock("../../menus/launcher_button_context_menu", async (importOriginal) => ({
    ...await importOriginal<typeof import("../../menus/launcher_button_context_menu")>(),
    showLauncherContextMenu: h.showLauncherContextMenu
}));
vi.mock("../mobile_widgets/TabSwitcher", async () => {
    h.tabSwitcherLoaded = true;
    await h.tabSwitcherGate;
    return {
        default: () => <span className="tab-switcher-stub" />,
        LaunchBarTabSwipe: () => <span className="tab-swipe-stub" />
    };
});
vi.mock("./RecordMeetingButton", () => {
    h.recordMeetingLoaded = true;
    return { default: () => <span className="record-meeting-button" /> };
});
vi.mock("./LauncherDropTarget", async (importOriginal) => {
    h.dropTargetLoaded = true;
    return await importOriginal<typeof import("./LauncherDropTarget")>();
});
vi.mock("./CustomWidget", () => {
    h.customWidgetLoaded = true;
    return { default: () => <span className="custom-widget-stub" /> };
});
vi.mock("./GenericButtons", async (importOriginal) => ({
    ...await importOriginal<typeof import("./GenericButtons")>(),
    CustomNoteLauncher: ({ launcherNote, getTargetNoteId, getOpenMode, parentNoteId }: {
        launcherNote: FNote,
        getTargetNoteId: (launcherNote: FNote) => unknown,
        getOpenMode?: (launcherNote: FNote) => unknown,
        parentNoteId?: string
    }) => (
        <span
            className="custom-note-launcher"
            data-target={`${getTargetNoteId(launcherNote)}`}
            data-open-mode={`${getOpenMode?.(launcherNote)}`}
            data-parent={`${parentNoteId}`}
        />
    )
}));

let container: HTMLDivElement;

afterEach(() => {
    act(() => render(null, container));
    container.remove();
});

function mountHook() {
    const host = new Component();
    let childNotes: FNote[] | undefined;

    function Harness() {
        childNotes = useLauncherChildNotes();
        return null;
    }

    container = document.createElement("div");
    document.body.appendChild(container);
    act(() => render(<ParentComponent.Provider value={host}><Harness /></ParentComponent.Provider>, container));

    return { host, getChildNotes: () => childNotes };
}

// The hook resolves the root note, re-renders, then resolves the children — each async step
// needs its own act() round so the intermediate state commits and the next effect fires.
async function flush() {
    for (let i = 0; i < 3; i++) {
        await act(async () => { await new Promise((resolve) => setTimeout(resolve)); });
    }
}

describe("useLauncherChildNotes", () => {
    it("swaps to fresh FNote refs on frocaReloaded (protected launcher titles decrypt after unlock)", async () => {
        // Locked protected session: the launcher note's title is the encrypted placeholder.
        buildNote({
            id: "_lbVisibleLaunchers",
            title: "Visible Launchers",
            children: [ { id: "_lbTestLauncher", title: "[protected]", type: "launcher" } ]
        });

        const { host, getChildNotes } = mountHook();
        await flush();

        const staleNote = getChildNotes()?.[0];
        expect(staleNote?.title).toBe("[protected]");

        // Unlocking rebuilds froca from scratch: same noteIds, brand-new FNote instances,
        // now with decrypted titles. The old instances stay orphaned in the hook's state
        // unless frocaReloaded triggers a re-resolve.
        buildNote({
            id: "_lbVisibleLaunchers",
            title: "Visible Launchers",
            children: [ { id: "_lbTestLauncher", title: "My secret launcher", type: "launcher" } ]
        });

        await act(async () => { await host.handleEvent("frocaReloaded", {}); });
        await flush();

        const freshNote = getChildNotes()?.[0];
        expect(freshNote?.title).toBe("My secret launcher");
        expect(freshNote).not.toBe(staleNote);
    });
});

describe("LauncherContainer", () => {
    it("shows the meeting transcription launcher only in the desktop app", async () => {
        buildNote({
            id: "_lbVisibleLaunchers",
            title: "Visible Launchers",
            children: [ {
                title: "Transcribe meeting",
                type: "launcher",
                "#launcherType": "builtinWidget",
                "#builtinWidget": "recordMeeting"
            } ]
        });
        const mount = () => {
            container = document.createElement("div");
            document.body.appendChild(container);
            act(() => render(
                <ParentComponent.Provider value={new Component()}>
                    <LauncherContainer isHorizontalLayout={false} />
                </ParentComponent.Provider>, container));
        };

        mount();
        await flush();
        expect(container.querySelector("#launcher-container")).not.toBeNull();
        expect(container.querySelector(".record-meeting-button")).toBeNull();
        expect(h.recordMeetingLoaded).toBe(false);
        act(() => render(null, container));
        container.remove();

        // The button is hidden while transcription is off, so the desktop app loads it only once on.
        h.isElectron = true;
        options.set("transcriptionEnabled", "false");
        const getState = vi.fn(async () => ({ status: "idle", noteId: null, pendingSources: [] }));
        window.electronApi = { transcription: { getState } } as unknown as typeof window.electronApi;
        mount();
        await flush();
        expect(container.querySelector("#launcher-container")).not.toBeNull();
        expect(getState).toHaveBeenCalled();
        expect(h.recordMeetingLoaded).toBe(false);
        act(() => render(null, container));
        container.remove();

        // A recording outlives the switch, so a frontend reloaded during one shows its stop button.
        getState.mockResolvedValue({ status: "recording", noteId: null, pendingSources: [] });
        mount();
        await vi.waitFor(() => expect(container.querySelector(".record-meeting-button")).not.toBeNull());
        act(() => render(null, container));
        container.remove();
        delete window.electronApi;

        options.set("transcriptionEnabled", "true");
        mount();
        await vi.waitFor(() => expect(container.querySelector(".record-meeting-button")).not.toBeNull());
    });

    it("shows a note cloned into the bar as a launcher of itself, and takes drops", async () => {
        buildNote({
            id: "_lbVisibleLaunchers",
            title: "Visible Launchers",
            children: [
                { id: "clonedNote", title: "Cloned note", "#bookmarkOpenMode": "newWindow" },
                { id: "widgetLauncher", title: "Widget", type: "launcher", "#launcherType": "customWidget" }
            ]
        });
        container = document.createElement("div");
        document.body.appendChild(container);
        act(() => render(
            <ParentComponent.Provider value={new Component()}>
                <LauncherContainer isHorizontalLayout={false} />
            </ParentComponent.Provider>, container));
        await flush();

        const slot = container.querySelector(".launcher-slot[data-launcher-id='clonedNote']");
        const launcher = slot?.querySelector(".custom-note-launcher");
        expect(launcher?.getAttribute("data-target")).toBe("clonedNote");
        expect(launcher?.getAttribute("data-open-mode")).toBe("newWindow");
        // "Remove from launch bar" removes this placement, not a bookmark of the note.
        expect(launcher?.getAttribute("data-parent")).toBe("_lbVisibleLaunchers");

        // A custom widget loads with its launcher, and the drop target with the first drag.
        await vi.waitFor(() => expect(container.querySelector(".custom-widget-stub")).not.toBeNull());
        expect(h.customWidgetLoaded).toBe(true);
        expect(h.dropTargetLoaded).toBe(false);

        const bar = container.querySelector("#launcher-container");
        expect(bar).not.toBeNull();
        const dispatchDrag = (type: string) => {
            const event = new Event(type, { bubbles: true, cancelable: true });
            Object.defineProperty(event, "dataTransfer", {
                value: { types: [ TREE_CLIPBOARD_TYPE ] }
            });
            act(() => {
                bar?.dispatchEvent(event);
            });
        };
        dispatchDrag("dragenter");
        await vi.waitFor(() => {
            dispatchDrag("dragover");
            expect(document.body.querySelector(".launcher-drop-indicator")).not.toBeNull();
        });
        expect(h.dropTargetLoaded).toBe(true);
    });

    it("shows a cloned note with #bookmarkFolder as a folder of its children", async () => {
        buildNote({
            id: "_lbVisibleLaunchers",
            title: "Visible Launchers",
            children: [ {
                id: "clonedFolder",
                title: "Cloned folder",
                "#bookmarkFolder": "",
                children: [ { id: "child", title: "Child" } ]
            } ]
        });
        container = document.createElement("div");
        document.body.appendChild(container);
        act(() => render(
            <ParentComponent.Provider value={new Component()}>
                <LauncherContainer isHorizontalLayout={false} />
            </ParentComponent.Provider>, container));
        await flush();

        const slot = container.querySelector(".launcher-slot[data-launcher-id='clonedFolder']");
        expect(slot?.querySelector(".custom-note-launcher")).toBeNull();
        const button = slot?.querySelector(".right-dropdown-button");
        expect(button).not.toBeNull();

        // "Remove from launch bar" removes this placement, not a bookmark of the note.
        act(() => {
            button?.dispatchEvent(new MouseEvent("contextmenu", { bubbles: true, cancelable: true }));
        });
        await vi.waitFor(() => expect(h.showLauncherContextMenu).toHaveBeenCalledExactlyOnceWith(
            expect.objectContaining({ noteId: "clonedFolder" }),
            expect.anything(),
            { parentNoteId: "_lbVisibleLaunchers" }
        ));
    });

    it("loads the tab switcher only for a bar that shows it", async () => {
        const mount = (isHorizontalLayout: boolean) => {
            container = document.createElement("div");
            document.body.appendChild(container);
            act(() => render(
                <ParentComponent.Provider value={new Component()}>
                    <LauncherContainer isHorizontalLayout={isHorizontalLayout} />
                </ParentComponent.Provider>, container));
        };

        buildNote({
            id: "_lbVisibleLaunchers",
            title: "Visible Launchers",
            children: [ { title: "Spacer", type: "launcher", "#launcherType": "builtinWidget", "#builtinWidget": "spacer" } ]
        });
        mount(true);
        await flush();
        expect(container.querySelector(".spacer")).not.toBeNull();
        expect(h.tabSwitcherLoaded).toBe(false);
        act(() => render(null, container));
        container.remove();

        buildNote({
            id: "_lbVisibleLaunchers",
            title: "Visible Launchers",
            children: [ {
                id: "_lbTabSwitcher",
                title: "Tabs",
                type: "launcher",
                "#launcherType": "builtinWidget",
                "#builtinWidget": "mobileTabSwitcher"
            } ]
        });
        mount(true);
        await flush();
        expect(h.tabSwitcherLoaded).toBe(true);
        // Until it loads, a button of the same size holds its place, so the launchers do not move.
        const slot = container.querySelector(".launcher-slot[data-launcher-id='_lbTabSwitcher']");
        expect(slot?.querySelector("button.launcher-button.mobile-tab-switcher")).not.toBeNull();
        expect(slot?.querySelector(".tab-switcher-stub")).toBeNull();

        h.openTabSwitcherGate();
        await flush();
        expect(slot?.querySelector(".tab-switcher-stub")).not.toBeNull();
        expect(slot?.querySelector("button.mobile-tab-switcher")).toBeNull();
        expect(container.querySelector(".tab-swipe-stub")).not.toBeNull();
    });
});
