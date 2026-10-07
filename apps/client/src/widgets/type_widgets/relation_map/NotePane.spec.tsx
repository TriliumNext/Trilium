import { render } from "preact";
import { useRef, useState } from "preact/hooks";
import { act } from "preact/test-utils";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import appContext from "../../../components/app_context";
import Component from "../../../components/component";
import server from "../../../services/server";
import { buildNote } from "../../../test/easy-froca";
import { useNoteContext, useTriliumEvent } from "../../react/hooks";
import { ParentComponent } from "../../react/react_utils";
import type RelationMapApi from "./api";
import NotePane, { type NotePaneHandle, type PaneSelection } from "./NotePane";

/** Stub for the note's editor, listening for `beforeNoteContextRemove` as the real editor does. */
const editorAskedToSave = vi.fn();
vi.mock("../../NoteDetail", () => ({
    default: () => {
        const { note } = useNoteContext();
        useTriliumEvent("beforeNoteContextRemove", editorAskedToSave);
        return <div className="note-detail-stub">{note?.title}</div>;
    }
}));

const confirmDelete = vi.fn();
vi.mock("../../../services/dialog", async (importOriginal) => ({
    default: {
        ...((await importOriginal<{ default: object }>()).default),
        confirmDeleteNoteBoxWithNote: (...args: unknown[]) => confirmDelete(...args)
    }
}));

// Promoted text fields request autocomplete values from the server.
server.get = (async () => []) as unknown as typeof server.get;

interface MountOptions {
    noteIdsOnMap?: string[];
    isReadOnly?: boolean;
    selection?: PaneSelection | null;
}

describe("relation map NotePane", () => {
    let container: HTMLElement | undefined;
    let mapComponent: Component | undefined;
    let handle: { current: NotePaneHandle | null } = { current: null };
    const removeItem = vi.fn();
    const mapApi = { branchIdFor: () => "branch", removeItem } as unknown as RelationMapApi;

    beforeEach(() => {
        container = document.createElement("div");
        document.body.appendChild(container);
        (appContext as unknown as { tabManager: unknown }).tabManager = {
            getActiveContext: () => undefined,
            getActiveContextNotePath: () => undefined,
            registerDetachedContext: () => undefined,
            unregisterDetachedContext: () => undefined
        };
        buildNote({
            id: "root", title: "root", children: [
                { id: "mapnote", title: "Map", children: [
                    { id: "first", title: "First" },
                    { id: "second", title: "Second" }
                ] }
            ]
        });
        editorAskedToSave.mockClear();
        removeItem.mockClear();
        confirmDelete.mockReset();
    });

    afterEach(() => {
        if (container) {
            const mounted = container;
            act(() => render(null, mounted));
            container.remove();
            container = undefined;
        }
        mapComponent = undefined;
        (appContext as unknown as { tabManager: unknown }).tabManager = undefined;
    });

    /** Stub for `RelationMap`, which owns the selection and the list of notes on the map. */
    function Harness({ noteIdsOnMap, isReadOnly, initialSelection }: {
        noteIdsOnMap: string[]; isReadOnly: boolean; initialSelection: PaneSelection | null;
    }) {
        const [ selection, setSelection ] = useState(initialSelection);
        const paneRef = useRef<NotePaneHandle>(null);
        handle = paneRef;
        const mapApiRef = useRef(mapApi);
        return <NotePane
            paneRef={paneRef} noteIdsOnMap={noteIdsOnMap} mapApiRef={mapApiRef}
            isReadOnly={isReadOnly} selection={selection} onSelect={setSelection}
        />;
    }

    /** Mounts the pane afresh, with the map's selection set to `selection`. */
    async function mount(options: MountOptions = {}) {
        if (container) render(null, container);
        await update(options);
    }

    /** Re-renders with new props, keeping the selection the pane has now. */
    async function update({ noteIdsOnMap = [ "first", "second" ], isReadOnly = false, selection = { noteId: "first" } }: MountOptions = {}) {
        mapComponent ??= new Component();
        await act(async () => {
            render(
                <ParentComponent.Provider value={mapComponent as Component}>
                    <Harness noteIdsOnMap={noteIdsOnMap} isReadOnly={isReadOnly} initialSelection={selection} />
                </ParentComponent.Provider>,
                container as HTMLElement
            );
        });
        await settle();
    }

    async function settle() {
        await act(async () => {
            for (let i = 0; i < 20; i++) await new Promise((resolve) => setTimeout(resolve));
        });
    }

    const pane = () => container?.querySelector(".relation-map-note-pane") ?? null;
    const title = () => pane()?.querySelector<HTMLInputElement>(".title-row input")?.value;

    it("shows the selected note, and closes from its button after asking the editor to save", async () => {
        await mount();

        expect(title()).toBe("First");
        expect(pane()?.querySelector(".note-detail-stub")?.textContent).toBe("First");

        const close = pane()?.querySelector<HTMLButtonElement>(".tn-overlay-panel-close");
        expect(close).toBeTruthy();
        await act(async () => close?.click());

        expect(editorAskedToSave).toHaveBeenCalledTimes(1);
        expect(pane()).toBeNull();
    });

    it("closes on Escape and through the handle the map holds", async () => {
        await mount();
        await act(async () => { window.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape" })); });
        expect(pane()).toBeNull();

        await mount({ selection: { noteId: "second" } });
        expect(title()).toBe("Second");
        await act(async () => handle.current?.close());
        expect(editorAskedToSave).toHaveBeenCalled();
        expect(pane()).toBeNull();
    });

    it("stays closed for a note that is not on the map, and closes once its note leaves it", async () => {
        await mount({ noteIdsOnMap: [ "second" ] });
        expect(pane()).toBeNull();

        await mount({ selection: { noteId: "second" } });
        expect(title()).toBe("Second");

        await update({ noteIdsOnMap: [ "first" ] });
        expect(pane()).toBeNull();
    });

    it("switches to a note on the map when a link to it is followed inside the pane", async () => {
        await mount();

        const anchor = document.createElement("a");
        anchor.setAttribute("href", "#root/mapnote/second");
        pane()?.querySelector(".relation-map-note-pane-body")?.appendChild(anchor);
        await act(async () => anchor.click());
        await settle();

        expect(title()).toBe("Second");
    });

    it("removes the note from the map once confirmed, and offers no edits on a read-only map", async () => {
        confirmDelete.mockResolvedValue({ confirmed: true, isDeleteNoteChecked: false });
        await mount();

        const remove = pane()?.querySelector<HTMLButtonElement>(".tn-embedded-note-remove");
        expect(remove).toBeTruthy();
        await act(async () => remove?.click());
        await settle();
        expect(removeItem).toHaveBeenCalledWith("first", false);

        await mount({ isReadOnly: true });
        expect(pane()).toBeTruthy();
        expect(pane()?.querySelector(".tn-embedded-note-remove")).toBeNull();
        expect(pane()?.querySelector(".tn-embedded-note-color")).toBeNull();
    });
});
