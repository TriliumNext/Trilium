import { useLayoutEffect } from "preact/hooks";
import { act } from "preact/test-utils";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import appContext from "../../components/app_context";
import NoteContext from "../../components/note_context";
import type TabManager from "../../components/tab_manager";
import LoadResults from "../../services/load_results";
import { buildNote } from "../../test/easy-froca";
import NoteWrapperWidget from "../note_wrapper";
import { useNoteContext } from "../react/hooks";
import SplitNoteContainer from "./split_note_container";

// The resizer drives Split.js against the real #center-pane layout, on an animation frame that
// outlives the test. These tests are about which splits the container opens, closes and moves.
vi.mock("../../services/resizer", () => ({
    default: {
        setupNoteSplitResizer: vi.fn(),
        delNoteSplitResizer: vi.fn(),
        moveNoteSplitResizer: vi.fn()
    }
}));

describe("SplitNoteContainer", () => {
    let noteContexts: NoteContext[];
    let removeNoteContext: ReturnType<typeof vi.fn>;

    afterEach(() => {
        vi.unstubAllGlobals();
    });

    beforeEach(() => {
        noteContexts = [];
        removeNoteContext = vi.fn();

        // Only the lookups the container makes while opening, closing and moving splits.
        appContext.tabManager = {
            activeNtxId: null,
            noteContexts,
            getActiveMainContext: () => noteContexts[0],
            getMainNoteContexts: () => noteContexts.filter((c) => c.isMainContext()),
            getNoteContextById: (ntxId: string) => noteContexts.find((c) => c.ntxId === ntxId),
            activateNoteContext: () => {},
            removeNoteContext
        } as unknown as TabManager;
    });

    /** Opens one tab: the first id becomes its main context, the rest its splits. */
    async function openSplits(ntxIds: string[], widgetFactory = () => new NoteWrapperWidget()) {
        const container = new SplitNoteContainer(widgetFactory);
        container.render();

        for (const [ index, ntxId ] of ntxIds.entries()) {
            const noteContext = new NoteContext(ntxId, "root", index === 0 ? null : ntxIds[0]);
            noteContexts.push(noteContext);
            await container.newNoteContextCreatedEvent({ noteContext });
        }

        return container;
    }

    it("stops delivering events to a split once its tab is closed", async () => {
        const container = await openSplits([ "split-a", "split-b" ]);
        const [ staysOpen, getsClosed ] = container.children;

        // Stands in for what useTriliumEvent registers on a widget: the board's entitiesReloaded
        // subscription is one of these, and it is what redraws a board nobody can see.
        const openHandler = vi.fn();
        const closedHandler = vi.fn();
        staysOpen.registerHandler("entitiesReloaded", openHandler);
        getsClosed.registerHandler("entitiesReloaded", closedHandler);

        container.noteContextRemovedEvent({ ntxIds: [ "split-b" ] });
        await container.handleEvent("entitiesReloaded", { loadResults: new LoadResults([]) });

        expect(openHandler).toHaveBeenCalledOnce();
        expect(closedHandler).not.toHaveBeenCalled();
        expect(container.children).toHaveLength(1);
    });

    it("unmounts the React widgets of a split once its tab is closed", async () => {
        let isMounted = false;

        function Probe() {
            // A layout effect rather than useEffect: it runs during the commit, so the probe is
            // mounted by the time render() returns, with no scheduled work to flush first.
            useLayoutEffect(() => {
                isMounted = true;
                return () => { isMounted = false; };
            }, []);

            return <div className="probe" />;
        }

        const container = await openSplits(
            [ "split-a" ],
            () => new NoteWrapperWidget().child(<Probe />));
        expect(isMounted).toBe(true);

        container.noteContextRemovedEvent({ ntxIds: [ "split-a" ] });

        // Detaching the widget stops the events; only unmounting releases the Preact tree and the
        // DOM it still points at.
        expect(isMounted).toBe(false);
    });

    it("keeps the note of a background tab from its panes until the tab is shown", async () => {
        function Probe() {
            const { note } = useNoteContext();
            return <div className="probe">{note?.noteId ?? ""}</div>;
        }

        const container = new SplitNoteContainer(() => new NoteWrapperWidget().child(<Probe />));
        container.render();

        // A shown tab, then a background tab of two splits, each opened on a note as loadTabs() does:
        // openEmptyTab() creates the pane, then setNote() switches it to the note.
        const panes = [
            new NoteContext("shown"),
            new NoteContext("background"),
            new NoteContext("background-split", "root", "background")
        ];
        await act(async () => {
            for (const noteContext of panes) {
                noteContext.setEmpty();
                noteContexts.push(noteContext);
                await container.newNoteContextCreatedEvent({ noteContext });

                const { noteId } = buildNote({ id: `${noteContext.ntxId}-note`, title: "Note" });
                noteContext.notePath = noteId;
                noteContext.noteId = noteId;
                await container.handleEvent("noteSwitched", { noteContext, notePath: noteId });
            }
        });

        const findPane = (ntxId: string) => container.$widget.find(`[data-ntx-id="${ntxId}"]`);
        const readProbe = (ntxId: string) => {
            const $probe = findPane(ntxId).find(".probe");
            expect($probe).toHaveLength(1);
            return $probe.text();
        };
        expect(readProbe("shown")).toBe("shown-note");
        expect(readProbe("background")).toBe("");
        expect(readProbe("background-split")).toBe("");
        // `resizer.ts` selects the panes of a tab by this class, also before the tab is shown.
        expect(findPane("background").hasClass("note-split")).toBe(true);
        expect(findPane("background-split").hasClass("note-split")).toBe(true);

        // Focusing either split shows the whole tab.
        appContext.tabManager.getActiveMainContext = () => panes[1];
        await act(async () => {
            await container.handleEvent("activeContextChanged", { noteContext: panes[2] });
        });

        expect(readProbe("background")).toBe("background-note");
        expect(readProbe("background-split")).toBe("background-split-note");
    });

    it("renders the tabs next to the active one on mobile, a while after it is shown", async () => {
        function Probe() {
            const { note } = useNoteContext();
            return <div className="probe">{note?.noteId ?? ""}</div>;
        }

        const { device } = window.glob;
        window.glob.device = "mobile";
        vi.useFakeTimers({ toFake: [ "setTimeout", "clearTimeout" ] });
        try {
            const container = new SplitNoteContainer(() => new NoteWrapperWidget().child(<Probe />));
            container.render();
            // The active tab, and three in the background; the last is before the first, around the end.
            const tabs = [ "first", "second", "third", "fourth" ].map((ntxId) => new NoteContext(ntxId));
            await act(async () => {
                for (const noteContext of tabs) {
                    noteContext.setEmpty();
                    noteContexts.push(noteContext);
                    await container.newNoteContextCreatedEvent({ noteContext });

                    const { noteId } = buildNote({ id: `${noteContext.ntxId}-note`, title: "Note" });
                    noteContext.notePath = noteId;
                    noteContext.noteId = noteId;
                    await container.handleEvent("noteSwitched", { noteContext, notePath: noteId });
                }
                await container.handleEvent("activeContextChanged", { noteContext: tabs[0] });
            });

            const readProbes = () => tabs.map(({ ntxId }) => container.$widget.find(`[data-ntx-id="${ntxId}"] .probe`).text());
            expect(readProbes()).toEqual([ "first-note", "", "", "" ]);

            await act(async () => {
                await vi.advanceTimersByTimeAsync(1000);
            });
            expect(readProbes()).toEqual([ "first-note", "second-note", "", "" ]);
            await act(async () => {
                await vi.advanceTimersByTimeAsync(1000);
            });
            expect(readProbes()).toEqual([ "first-note", "second-note", "", "fourth-note" ]);
            // Still hidden: only the active tab is shown.
            expect(container.$widget.find("[data-ntx-id=second]").hasClass("hidden-ext")).toBe(true);

            await act(async () => {
                await vi.advanceTimersByTimeAsync(5000);
            });
            expect(readProbes()[2]).toBe("");
        } finally {
            vi.useRealTimers();
            window.glob.device = device;
        }
    });

    it("leaves the background tabs alone on desktop", async () => {
        vi.useFakeTimers({ toFake: [ "setTimeout", "clearTimeout" ] });
        try {
            const container = await openSplits([ "shown" ]);
            const background = new NoteContext("background");
            noteContexts.push(background);
            await container.newNoteContextCreatedEvent({ noteContext: background });
            await container.handleEvent("activeContextChanged", { noteContext: noteContexts[0] });

            await vi.advanceTimersByTimeAsync(5000);
            expect(container.$widget.find("[data-ntx-id=background]").hasClass("empty-note")).toBe(true);
        } finally {
            vi.useRealTimers();
        }
    });

    describe("keyboard actions", () => {
        it("closes the active split, leaving a tab that has no split alone", async () => {
            const container = await openSplits([ "split-a", "split-b" ]);
            // a second tab, whose single pane is not a split
            noteContexts.push(new NoteContext("other-tab"));

            await container.closeActiveNoteSplitEvent({ ntxId: "split-b" });
            expect(removeNoteContext).toHaveBeenCalledWith("split-b");

            removeNoteContext.mockClear();
            await container.closeActiveNoteSplitEvent({ ntxId: "other-tab" });
            expect(removeNoteContext).not.toHaveBeenCalled();
        });

        it("moves the active split within its tab, but not past either end of it", async () => {
            const container = await openSplits([ "split-a", "split-b" ]);
            noteContexts.push(new NoteContext("other-tab"));
            // two empty splits swap to nothing, so give every pane a note
            for (const noteContext of noteContexts) {
                noteContext.noteId = "note";
            }

            const triggerCommand = vi.spyOn(container, "triggerCommand");

            await container.moveActiveNoteSplitLeftEvent({ ntxId: "split-b" });
            expect(triggerCommand).toHaveBeenCalledWith("noteContextReorder",
                expect.objectContaining({ ntxIdsInOrder: [ "split-b", "split-a", "other-tab" ] }));

            triggerCommand.mockClear();
            // split-b is the last pane of its tab -- moving it right would drag it into the next tab
            await container.moveActiveNoteSplitRightEvent({ ntxId: "split-b" });
            // and split-a is the first pane of the window
            await container.moveActiveNoteSplitLeftEvent({ ntxId: "split-a" });
            // other-tab is the last pane of all, so there is no neighbour to read, let alone swap
            await container.moveActiveNoteSplitRightEvent({ ntxId: "other-tab" });
            expect(triggerCommand).not.toHaveBeenCalled();
        });

        it("reports a move aimed at a pane that is not open", async () => {
            const container = await openSplits([ "split-a", "split-b" ]);
            const logError = vi.fn();
            vi.stubGlobal("logError", logError);
            const triggerCommand = vi.spyOn(container, "triggerCommand");

            // the pane can close between the keypress and the handler
            await container.moveActiveNoteSplitLeftEvent({ ntxId: "already-gone" });

            expect(logError).toHaveBeenCalled();
            expect(triggerCommand).not.toHaveBeenCalled();
        });
    });
});
