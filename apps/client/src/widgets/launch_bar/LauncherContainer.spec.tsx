import { render } from "preact";
import { act } from "preact/test-utils";
import { afterEach, describe, expect, it, vi } from "vitest";

import Component from "../../components/component.js";
import type FNote from "../../entities/fnote.js";
import { buildNote } from "../../test/easy-froca.js";
import { TREE_CLIPBOARD_TYPE } from "../react/hooks.js";
import { ParentComponent } from "../react/react_utils.js";
import LauncherContainer, { useLauncherChildNotes } from "./LauncherContainer.js";

const h = vi.hoisted(() => ({ isElectron: false, showLauncherContextMenu: vi.fn() }));

vi.mock("../../services/utils", async (importOriginal) => ({
    ...await importOriginal<typeof import("../../services/utils")>(),
    isElectron: () => h.isElectron
}));
vi.mock("../../menus/launcher_button_context_menu", async (importOriginal) => ({
    ...await importOriginal<typeof import("../../menus/launcher_button_context_menu")>(),
    showLauncherContextMenu: h.showLauncherContextMenu
}));
vi.mock("./RecordMeetingButton", () => ({
    default: () => <span className="record-meeting-button" />
}));
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
        act(() => render(null, container));
        container.remove();

        h.isElectron = true;
        mount();
        await flush();
        expect(container.querySelector(".record-meeting-button")).not.toBeNull();
    });

    it("shows a note cloned into the bar as a launcher of itself, and takes drops", async () => {
        buildNote({
            id: "_lbVisibleLaunchers",
            title: "Visible Launchers",
            children: [
                { id: "clonedNote", title: "Cloned note", "#bookmarkOpenMode": "newWindow" }
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

        const bar = container.querySelector("#launcher-container");
        expect(bar).not.toBeNull();
        const dragOver = new Event("dragover", { bubbles: true, cancelable: true });
        Object.defineProperty(dragOver, "dataTransfer", {
            value: { types: [ TREE_CLIPBOARD_TYPE ] }
        });
        act(() => {
            bar?.dispatchEvent(dragOver);
        });
        expect(document.body.querySelector(".launcher-drop-indicator")).not.toBeNull();
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
        expect(h.showLauncherContextMenu).toHaveBeenCalledExactlyOnceWith(
            expect.objectContaining({ noteId: "clonedFolder" }),
            expect.anything(),
            { parentNoteId: "_lbVisibleLaunchers" }
        );
    });
});
