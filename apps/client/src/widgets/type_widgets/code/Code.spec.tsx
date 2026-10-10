// @vitest-environment jsdom
import type VanillaCodeMirror from "@triliumnext/codemirror";
import { createRef, render } from "preact";
import { act } from "preact/test-utils";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import type Component from "../../../components/component";
import FNote from "../../../entities/fnote";
import options from "../../../services/options";
import search from "../../../services/search";
import { buildNote } from "../../../test/easy-froca";
import { renderInto } from "../../../test/render";
import { ParentComponent } from "../../react/react_utils";
import { CodeEditor, EditableCode, ReadOnlyCode } from "./Code";

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

describe("CodeEditor", () => {
    const handlers = new Map<string, ((data: unknown) => unknown)[]>();
    const parent = {
        registerHandler(name: string, handler: (data: unknown) => unknown) {
            handlers.set(name, [ ...(handlers.get(name) ?? []), handler ]);
        },
        removeHandler(name: string, handler: (data: unknown) => unknown) {
            handlers.set(name, (handlers.get(name) ?? []).filter((h) => h !== handler));
        },
        componentId: "c"
    } as unknown as Component;

    /** Fires an event at every listener, as `triggerCommand()` does for an unhandled command. */
    async function trigger(name: string, data: unknown) {
        await Promise.all((handlers.get(name) ?? []).map((handler) => handler(data)));
    }

    beforeEach(() => {
        // Without `codeNoteTheme`, the theme effect throws and skips the effects of later editors.
        options.load({ codeNoteTheme: "none" } as Parameters<typeof options.load>[0]);
    });

    afterEach(() => {
        handlers.clear();
    });

    it("answers for its context only while it is the displayed editor", async () => {
        // `NoteDetail` keeps earlier type widgets mounted but hidden, so they share the `ntxId`.
        const hiddenRef = createRef<VanillaCodeMirror>();
        const shownRef = createRef<VanillaCodeMirror>();
        await act(async () => {
            renderInto(
                <ParentComponent.Provider value={parent}>
                    <CodeEditor
                        ntxId="ntx" mime="text/plain" isVisible={false} editorRef={hiddenRef}
                    />
                    <CodeEditor ntxId="ntx" mime="text/plain" isVisible editorRef={shownRef} />
                    <CodeEditor ntxId="other" mime="text/plain" />
                </ParentComponent.Provider>
            );
        });
        const shown = shownRef.current;
        expect(hiddenRef.current).not.toBeNull();
        if (!shown) throw new Error("The displayed editor did not initialize.");

        const resolveEditor = vi.fn();
        await trigger("executeWithCodeEditor", { resolve: resolveEditor, ntxId: "ntx" });
        expect(resolveEditor).toHaveBeenCalledOnce();
        expect(resolveEditor).toHaveBeenCalledWith(shown);

        const resolveElement = vi.fn();
        await trigger("executeWithContentElement", { resolve: resolveElement, ntxId: "ntx" });
        expect(resolveElement).toHaveBeenCalledOnce();
        expect(resolveElement.mock.calls[0][0][0]).toBe(shown.dom.parentElement);
    });

    it("answers when nothing tells it whether it is displayed", async () => {
        const editorRef = createRef<VanillaCodeMirror>();
        await act(async () => {
            renderInto(
                <ParentComponent.Provider value={parent}>
                    <CodeEditor ntxId="ntx" mime="text/plain" editorRef={editorRef} />
                </ParentComponent.Provider>
            );
        });
        expect(editorRef.current).not.toBeNull();

        const resolve = vi.fn();
        await trigger("executeWithCodeEditor", { resolve, ntxId: "ntx" });
        expect(resolve).toHaveBeenCalledWith(editorRef.current);
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
