// @vitest-environment happy-dom
import type { ComponentChildren } from "preact";
import { act } from "preact/test-utils";
import { describe, expect, it, vi } from "vitest";

import type { AppPayload, HostedApp } from "./app_host.js";
import mountCollection from "./collection_view.js";

const { openNote, noteList } = vi.hoisted(() => ({
    openNote: vi.fn(),
    noteList: vi.fn(() => null)
}));

vi.mock("@triliumnext/client/src/widgets/collections/NoteList.js", () => ({
    EmbeddedNoteList: noteList
}));
vi.mock("./app_host.js", () => ({
    default: ({ noteId, children }: {
        noteId: string;
        children(app: HostedApp): ComponentChildren;
    }) =>
        children({ note: { noteId }, openNote } as unknown as HostedApp)
}));

describe("mountCollection", () => {
    it("mounts the app's note list over the collection, opening notes on their pages", () => {
        const container = document.createElement("div");
        container.dataset.noteId = "books";

        act(() => mountCollection(container, {} as AppPayload));

        expect(noteList).toHaveBeenCalledWith(expect.objectContaining({
            note: { noteId: "books" }, notePath: "books", ntxId: null, onOpenNote: openNote
        }), expect.anything());

        delete container.dataset.noteId;
        act(() => mountCollection(container, {} as AppPayload));
        expect(noteList).toHaveBeenLastCalledWith(
            expect.objectContaining({ note: { noteId: "" } }), expect.anything());
    });
});
