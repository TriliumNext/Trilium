import { useLayoutEffect } from "preact/hooks";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import appContext from "../../components/app_context";
import NoteContext from "../../components/note_context";
import type TabManager from "../../components/tab_manager";
import LoadResults from "../../services/load_results";
import NoteWrapperWidget from "../note_wrapper";
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
