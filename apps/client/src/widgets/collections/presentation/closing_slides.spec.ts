import { h, render } from "preact";
import { act } from "preact/test-utils";
import { afterEach, describe, expect, it, vi } from "vitest";

import FNote from "../../../entities/fnote";
import { buildNote } from "../../../test/easy-froca";
import { useClosingSlides } from "./closing_slides";
import { renderSlideContent } from "./model";

vi.mock("./model", async (importOriginal) => ({
    ...await importOriginal<typeof import("./model")>(),
    renderSlideContent: vi.fn(async (_note: FNote, content: string) => ({ __html: `<p>${content}</p>` }))
}));

describe("useClosingSlides", () => {
    afterEach(() => {
        document.body.replaceChildren();
    });

    function renderHook() {
        const refresh = vi.fn();
        let closing: ReturnType<typeof useClosingSlides> | undefined;
        const Probe = () => {
            closing = useClosingSlides(refresh);
            return null;
        };
        act(() => render(h(Probe, {}), document.createElement("div")));
        const current = () => {
            if (!closing) throw new Error("The hook did not render.");
            return closing;
        };
        return { refresh, current };
    }

    function deferred() {
        let resolve: (isSaved: boolean) => void = () => {};
        const promise = new Promise<boolean>((r) => { resolve = r; });
        return { promise, resolve };
    }

    it("shows the closed editor's content until a model built after the save applies", async () => {
        const note = buildNote({ title: "Slide" });
        const { refresh, current } = renderHook();
        const save = deferred();

        await act(async () => current().onEditorClose(note, "typed", save.promise));
        expect(renderSlideContent).toHaveBeenCalledWith(note, "typed");
        expect(current().contents).toStrictEqual({ [note.noteId]: { __html: "<p>typed</p>" } });
        // A model built while the save runs does not hold it yet.
        expect(current().getSaved()).toStrictEqual([]);

        await act(async () => save.resolve(true));
        expect(refresh).toHaveBeenCalledOnce();
        const saved = current().getSaved();
        expect(saved.map(([ noteId ]) => noteId)).toStrictEqual([ note.noteId ]);

        act(() => current().release(saved));
        expect(current().contents).toStrictEqual({});
        expect(current().getSaved()).toStrictEqual([]);
    });

    it("keeps the content after a failed save until the next model, without building one", async () => {
        const note = buildNote({ title: "Slide" });
        const { refresh, current } = renderHook();

        await act(async () => current().onEditorClose(note, "typed", Promise.resolve(false)));
        expect(refresh).not.toHaveBeenCalled();
        expect(current().contents[note.noteId]).toStrictEqual({ __html: "<p>typed</p>" });

        act(() => current().release(current().getSaved()));
        expect(current().contents).toStrictEqual({});
    });

    it("follows only the last editor of a slide closed twice", async () => {
        const note = buildNote({ title: "Slide" });
        const { refresh, current } = renderHook();
        const first = deferred();
        let renderFirst: (html: { __html: string }) => void = () => {};
        vi.mocked(renderSlideContent).mockImplementationOnce(() => new Promise((r) => { renderFirst = r; }));

        await act(async () => current().onEditorClose(note, "first", first.promise));
        await act(async () => current().onEditorClose(note, "second", new Promise(() => {})));

        // The first editor's render and save land after the second closed, and change nothing.
        await act(async () => {
            renderFirst({ __html: "<p>first</p>" });
            first.resolve(true);
        });
        expect(current().contents[note.noteId]).toStrictEqual({ __html: "<p>second</p>" });
        expect(refresh).not.toHaveBeenCalled();

        // A release of an editor that is no longer the slide's keeps its content.
        act(() => current().release([ [ note.noteId, { isSaving: false } ] ]));
        expect(current().contents[note.noteId]).toStrictEqual({ __html: "<p>second</p>" });
    });
});
