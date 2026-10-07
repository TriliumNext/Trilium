// @vitest-environment jsdom
import { render } from "preact";
import { act } from "preact/test-utils";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import FNote from "../../../entities/fnote";
import search from "../../../services/search";
import { buildNote } from "../../../test/easy-froca";
import { renderInto } from "../../../test/render";
import { ParentComponent } from "../../react/react_utils";
import { EditableCode, ReadOnlyCode } from "./Code";

describe("EditableCode", () => {
    const parent = { registerHandler() {}, removeHandler() {}, componentId: "c" } as any;
    const markdown = { type: "code", mime: "text/x-markdown" } as const;
    const noteA = buildNote({ ...markdown, title: "A", content: "# Note A" });
    const noteB = buildNote({ ...markdown, title: "B", content: "# Note B" });

    function show(note: FNote, onContentChanged: (content: string) => void) {
        return (
            <ParentComponent.Provider value={parent}>
                <EditableCode
                    note={note} ntxId="ntx" parentComponent={parent}
                    noteContext={undefined} viewScope={undefined}
                    onContentChanged={onContentChanged}
                />
            </ParentComponent.Provider>
        );
    }

    afterEach(() => {
        vi.restoreAllMocks();
    });

    // jsdom has no layout, so every editor has a null `offsetParent` and counts as hidden.
    it("reports each note loaded into a hidden editor", async () => {
        const onContentChanged = vi.fn();

        let container: HTMLElement | undefined;
        await act(async () => { container = renderInto(show(noteA, onContentChanged)); });
        await vi.waitFor(() => expect(onContentChanged).toHaveBeenLastCalledWith("# Note A"));

        await act(async () => {
            if (container) render(show(noteB, onContentChanged), container);
        });
        await vi.waitFor(() => expect(onContentChanged).toHaveBeenLastCalledWith("# Note B"));
    });

    it("reports a load into a visible editor once", async () => {
        vi.spyOn(HTMLElement.prototype, "offsetParent", "get").mockReturnValue(document.body);
        const onContentChanged = vi.fn();

        await act(async () => { renderInto(show(noteA, onContentChanged)); });
        await vi.waitFor(() => expect(onContentChanged).toHaveBeenCalledWith("# Note A"));
        expect(onContentChanged).toHaveBeenCalledTimes(1);
    });
});

describe("API log", () => {
    const handlers = new Map<string, (data: unknown) => void>();
    const parent = {
        registerHandler(name: string, handler: (data: unknown) => void) { handlers.set(name, handler); },
        removeHandler() {},
        componentId: "c"
    } as any;

    beforeEach(() => {
        vi.spyOn(search, "searchForNotes").mockResolvedValue([]);
    });

    afterEach(() => {
        vi.restoreAllMocks();
    });

    it("shows what the script note logs below the editable and the read-only editor, until closed or switched away", async () => {
        for (const Editor of [ EditableCode, ReadOnlyCode ]) {
            const script = { type: "code", mime: "application/javascript;env=frontend", content: "api.log(1)" } as const;
            const note = buildNote({ ...script, title: "Script" });
            const otherNote = buildNote({ ...script, title: "Other script" });
            const show = (shown: FNote) => (
                <ParentComponent.Provider value={parent}>
                    <Editor note={shown} ntxId="ntx" parentComponent={parent} noteContext={undefined} viewScope={undefined} />
                </ParentComponent.Provider>
            );
            const log = (noteId: string) => act(() => handlers.get("apiLogMessages")?.({ noteId, messages: [ "first", "second" ] }));

            let container: HTMLElement | undefined;
            await act(async () => { container = renderInto(show(note)); });

            log(otherNote.noteId);
            expect(container?.querySelector(".api-log-container")).toBeNull();

            log(note.noteId);
            expect(container?.querySelector(".api-log-container")?.textContent).toBe("first\nsecond");

            await act(async () => {
                if (container) render(show(otherNote), container);
            });
            expect(container?.querySelector(".api-log-container")).toBeNull();

            log(otherNote.noteId);
            const closeButton = container?.querySelector<HTMLElement>(".close-api-log-button");
            expect(closeButton).not.toBeNull();
            act(() => closeButton?.click());
            expect(container?.querySelector(".api-log-container")).toBeNull();
        }
    });
});
