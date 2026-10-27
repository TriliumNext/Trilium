// @vitest-environment jsdom
import VanillaCodeMirror from "@triliumnext/codemirror";
import { render } from "preact";
import { useEffect, useState } from "preact/hooks";
import { act } from "preact/test-utils";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import type NoteContext from "../../../components/note_context";
import FNote from "../../../entities/fnote";
import options from "../../../services/options";
import search from "../../../services/search";
import { buildNote } from "../../../test/easy-froca";
import { renderInto } from "../../../test/render";
import { ParentComponent } from "../../react/react_utils";
import { EditableCode, ReadOnlyCode } from "./Code";
import type { CodeMirrorProps } from "./CodeMirror";

// While `deferEditor.on` is set, the editor is created one render after `CodeEditor` mounts, after
// its effects have run, as in a Mermaid note's split; otherwise the real component renders as is.
const deferEditor = vi.hoisted(() => ({ on: false }));
vi.mock("./CodeMirror", async (importOriginal) => {
    const { default: RealCodeMirror } = await importOriginal<typeof import("./CodeMirror")>();
    return {
        default: (props: CodeMirrorProps) => {
            const [ shown, setShown ] = useState(!deferEditor.on);
            useEffect(() => setShown(true), []);
            return shown ? <RealCodeMirror {...props} /> : null;
        }
    };
});

// The `/` list of a Markdown editor loads the task states from the `_taskStates` subtree.
vi.mock("../../../services/task_states", () => ({ getTaskStateDefinitions: async () => [] }));

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

    it("publishes its editor while it is displayed for the note of its context", async () => {
        const contextData = new Map<string, unknown>();
        const setContextData = vi.fn((key: string, value: unknown) => contextData.set(key, value));
        const noteContext = {
            noteId: noteA.noteId,
            setContextData,
            getContextData: (key: string) => contextData.get(key),
            clearContextData: (key: string) => contextData.delete(key)
        } as unknown as NoteContext;
        let editor: VanillaCodeMirror | null = null;
        const showIn = (isVisible: boolean) => (
            <ParentComponent.Provider value={parent}>
                <EditableCode
                    note={noteA} ntxId="ntx" parentComponent={parent}
                    noteContext={noteContext} viewScope={undefined} isVisible={isVisible}
                    editorRef={(view: VanillaCodeMirror | null) => { editor = view; }}
                />
            </ParentComponent.Provider>
        );
        const getPublished = () => setContextData.mock.calls
            .filter(([ key ]) => key === "codeEditor")
            .map(([ , value ]) => value);

        let container: HTMLElement | undefined;
        await act(async () => { container = renderInto(showIn(false)); });
        expect(editor).toBeInstanceOf(VanillaCodeMirror);
        expect(getPublished()).toEqual([]);

        // Displayed while the context still shows another note.
        noteContext.noteId = "other";
        await act(async () => { if (container) render(showIn(true), container); });
        expect(getPublished()).toEqual([]);

        noteContext.noteId = noteA.noteId;
        await act(async () => { if (container) render(showIn(false), container); });
        await act(async () => { if (container) render(showIn(true), container); });
        expect(getPublished()).toEqual([ editor ]);
        expect(contextData.get("codeEditor")).toBe(editor);

        // Hidden, as by the attachments view of the same note.
        await act(async () => { if (container) render(showIn(false), container); });
        expect(contextData.has("codeEditor")).toBe(false);

        // Hidden after another type widget has published its own editor.
        await act(async () => { if (container) render(showIn(true), container); });
        const replacement = {};
        contextData.set("codeEditor", replacement);
        await act(async () => { if (container) render(showIn(false), container); });
        expect(contextData.get("codeEditor")).toBe(replacement);
    });
});

describe("code note theme", () => {
    beforeEach(() => {
        vi.spyOn(search, "searchForNotes").mockResolvedValue([]);
        options.set("codeNoteThemeMatchesApp", "false");
        options.set("codeNoteTheme", "default:github-light");
    });

    afterEach(() => {
        deferEditor.on = false;
        vi.restoreAllMocks();
    });

    it("applies the theme to an editor created after the component's effects have run", async () => {
        const setTheme = vi.spyOn(VanillaCodeMirror.prototype, "setTheme");
        deferEditor.on = true;
        const note = buildNote({ type: "code", mime: "text/plain", title: "T", content: "text" });
        const parent = { registerHandler() {}, removeHandler() {}, componentId: "c" } as any;

        await act(async () => {
            renderInto(
                <ParentComponent.Provider value={parent}>
                    <EditableCode note={note} ntxId="ntx" parentComponent={parent} noteContext={undefined} viewScope={undefined} />
                </ParentComponent.Provider>
            );
        });

        await vi.waitFor(() => expect(setTheme).toHaveBeenCalledWith(expect.objectContaining({ id: "github-light" })));
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
