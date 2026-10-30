import { act } from "preact/test-utils";
import { afterEach, describe, expect, it, vi } from "vitest";

import Component from "../../../components/component";
import NoteContext from "../../../components/note_context";
import FNote from "../../../entities/fnote";
import note_create from "../../../services/note_create";
import options from "../../../services/options";
import { buildNote } from "../../../test/easy-froca";
import { renderInto } from "../../../test/render";
import { NoteContextContext, ParentComponent } from "../../react/react_utils";
import PresentationView from "./index";

vi.mock("./themes", async (importOriginal) => ({
    ...await importOriginal<typeof import("./themes")>(),
    loadPresentationTheme: async () => ""
}));

describe("an empty presentation", () => {
    afterEach(() => {
        vi.restoreAllMocks();
    });

    async function renderEmpty(labels: Record<string, string> = {}) {
        options.set("presentationSidebarVisible", "true");
        const note = buildNote({ title: "Deck", type: "book", "#viewType": "presentation", ...labels });
        const onReady = vi.fn();
        const container = renderPresentation(note, onReady);
        await vi.waitFor(() => expect(container.querySelector(".no-items")).not.toBeNull());
        return { note, container, onReady };
    }

    it("shows an empty slide sidebar and, in place of the slides, a way to create the first", async () => {
        const createNote = vi.spyOn(note_create, "createNote")
            .mockResolvedValue({ note: { noteId: "first" } } as Awaited<ReturnType<typeof note_create.createNote>>);
        const { note, container, onReady } = await renderEmpty();

        const sidebar = container.querySelector(".presentation-sidebar");
        expect(sidebar).not.toBeNull();
        expect(sidebar?.querySelectorAll("li")).toHaveLength(0);
        expect(container.querySelector(".presentation-container")).toBeNull();
        expect(onReady).toHaveBeenCalled();

        const button = container.querySelector<HTMLButtonElement>(".no-items button");
        expect(button).not.toBeNull();
        await act(async () => button?.click());
        expect(createNote).toHaveBeenCalledWith(note.noteId, expect.objectContaining({ type: "text", activate: false }));
    });

    it("offers no way to create a slide in a read-only presentation", async () => {
        const { container } = await renderEmpty({ "#readOnly": "" });
        expect(container.querySelector(".no-items button")).toBeNull();
    });
});

function renderPresentation(note: FNote, onReady: () => void) {
    const noteContext = new NoteContext("ntx-presentation");
    noteContext.noteId = note.noteId;
    return renderInto(
        <ParentComponent.Provider value={new Component()}>
            <NoteContextContext.Provider value={noteContext}>
                <PresentationView
                    note={note}
                    notePath={note.noteId}
                    noteIds={[]}
                    highlightedTokens={undefined}
                    viewConfig={undefined}
                    saveConfig={() => {}}
                    media="screen"
                    onReady={onReady}
                />
            </NoteContextContext.Provider>
        </ParentComponent.Provider>
    );
}
