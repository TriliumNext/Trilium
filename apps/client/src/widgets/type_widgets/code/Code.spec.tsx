import { render } from "preact";
import { act } from "preact/test-utils";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// --- Module mocks (hoisted above the imports) ----------------------------------------------------

// `getThemeById` returns a theme only for the captured id; the heavy CodeMirror class is unused
// because `./CodeMirror` is mocked below.
const themeById: Record<string, { id: string; load: () => Promise<unknown> } | null> = {};
vi.mock("@triliumnext/codemirror", () => ({
    default: class {},
    getThemeById: (id: string) => themeById[id] ?? null
}));

// i18n is not initialised under happy-dom; return the key so placeholder strings stay defined.
vi.mock("../../../services/i18n", () => ({
    t: (key: string) => key
}));

// Replace the snippet slash-command hook (hits the search service) with a no-op that records args.
let snippetMatches: ((note: { type: string; mime: string; isMarkdown(): boolean }) => boolean) | null = null;
vi.mock("./snippets", async (importOriginal) => ({
    ...(await importOriginal<typeof import("./snippets")>()),
    useSnippetSlashCommands: (
        _editorView: unknown,
        matches: (note: { type: string; mime: string; isMarkdown(): boolean }) => boolean
    ) => {
        snippetMatches = matches;
    }
}));

vi.mock("../../../services/keyboard_actions", () => ({
    default: { setupActionsForElement: vi.fn(async () => []) }
}));
vi.mock("../../../services/shortcuts", () => ({
    default: {},
    removeIndividualBinding: vi.fn()
}));

// --- Lightweight CodeMirror stand-in --------------------------------------------------------------

// A fake VanillaCodeMirror instance with just the methods Code.tsx touches.
class FakeEditor {
    text = "";
    mime = "";
    themeSet: unknown = null;
    cleared = 0;
    scrolledToEnd = 0;
    focused = 0;
    getText() { return this.text; }
    setText(t: string) { this.text = t; }
    setMimeType(m: string) { this.mime = m; }
    clearHistory() { this.cleared++; }
    setTheme(theme: unknown) { this.themeSet = theme; return Promise.resolve(); }
    scrollToEnd() { this.scrolledToEnd++; }
    focus() { this.focused++; }
}

// Captures the props passed to the (real) CodeEditor's inner <CodeMirror>. Mirrors the real
// component: the editor is created and the refs/onInitialized fire exactly once (in an empty-dep
// effect), so consumers don't loop re-creating it. The container <pre> hosts a `.cm-editor` so the
// theme effect's getComputedStyle path runs.
let cmProps: Record<string, unknown> | null = null;
let cmEditor: FakeEditor | null = null;
const cmPres: HTMLPreElement[] = [];
vi.mock("./CodeMirror", () => ({
    default: (props: Record<string, unknown>) => {
        cmProps = props;
        const inited = mockUseRef(false);
        mockUseEffect(() => {
            if (inited.current) return;
            inited.current = true;
            const editor = new FakeEditor();
            cmEditor = editor;
            const containerRef = props.containerRef as { current: HTMLElement | null } | ((el: HTMLElement | null) => void) | undefined;
            const editorRef = props.editorRef as { current: unknown } | ((v: unknown) => void) | undefined;
            const pre = document.createElement("pre");
            const inner = document.createElement("div");
            inner.className = "cm-editor";
            inner.style.backgroundColor = "rgb(1, 2, 3)";
            pre.appendChild(inner);
            document.body.appendChild(pre);
            cmPres.push(pre);
            if (typeof containerRef === "function") containerRef(pre);
            else if (containerRef) containerRef.current = pre;
            if (typeof editorRef === "function") editorRef(editor);
            else if (editorRef) editorRef.current = editor;
            (props.onInitialized as (() => void) | undefined)?.();
        }, []);
        // Mirror the real CodeMirror: apply the content/mime props to the editor as they change.
        mockUseEffect(() => {
            if (cmEditor) {
                cmEditor.setText((props.content as string | undefined) ?? "");
                cmEditor.setMimeType((props.mime as string | undefined) ?? "");
            }
        }, [ props.content, props.mime ]);
        return null;
    }
}));

import { OptionNames } from "@triliumnext/commons";
import { useEffect as mockUseEffect, useRef as mockUseRef } from "preact/hooks";

import Component from "../../../components/component";
import type NoteContext from "../../../components/note_context";
import froca from "../../../services/froca";
import options from "../../../services/options";
import server from "../../../services/server";
import ws from "../../../services/ws";
import { buildNote } from "../../../test/easy-froca";
import { ParentComponent } from "../../react/react_utils";
import { TypeWidgetProps } from "../type_widget";
import { CodeEditor, EditableCode, type EditableCodeProps, ReadOnlyCode } from "./Code";

type CodeEditorProps = Parameters<typeof CodeEditor>[0];

// --- Helpers --------------------------------------------------------------------------------------

let container: HTMLDivElement | undefined;
let parent: Component;

function setOptions(values: Record<string, string>) {
    options.load(values as Record<OptionNames, string>);
}

function fakeNoteContext(overrides: Record<string, unknown> = {}): NoteContext {
    return {
        ntxId: "ntx1",
        viewScope: { viewMode: "default" },
        isReadOnly: vi.fn(async () => false),
        setContextData: vi.fn(),
        getContextData: vi.fn(),
        clearContextData: vi.fn(),
        ...overrides
    } as unknown as NoteContext;
}

/** Drain async effect chains (jQuery deferred + froca) and the resulting re-render. */
async function flush() {
    await act(async () => {
        for (let i = 0; i < 3; i++) await new Promise(resolve => setTimeout(resolve, 0));
    });
}

function renderInto(vnode: preact.ComponentChildren) {
    const el = document.createElement("div");
    container = el;
    document.body.appendChild(el);
    act(() => {
        render(
            <ParentComponent.Provider value={parent}>
                {vnode}
            </ParentComponent.Provider>,
            el
        );
    });
    return el;
}

function fireEvent(name: string, data: unknown) {
    act(() => { parent.handleEventInChildren(name as never, data as never); });
}

function unmountCurrent() {
    const el = container;
    if (!el) return;
    act(() => render(null, el));
    el.remove();
    container = undefined;
}

beforeEach(() => {
    for (const key of Object.keys(froca.notes)) delete froca.notes[key];
    for (const key of Object.keys(froca.attributes)) delete froca.attributes[key];
    for (const key of Object.keys(froca.branches)) delete froca.branches[key];
    for (const key of Object.keys(themeById)) delete themeById[key];
    vi.clearAllMocks();
    Object.assign(server, { put: vi.fn(async () => undefined), upload: vi.fn(async () => undefined) });
    Object.assign(ws, { logError: vi.fn() });
    setOptions({
        vimKeymapEnabled: "false",
        codeLineWrapEnabled: "false",
        codeNoteTheme: "default:abcdef",
        codeNoteTabWidth: "4",
        codeNoteIndentWithTabs: "false",
        codeNoteThemeMatchesApp: "false",
        codeNoteThemeLight: "default:light",
        codeNoteThemeDark: "default:dark"
    });
    cmProps = null;
    cmEditor = null;
    snippetMatches = null;
    parent = new Component();
    // `$widget.closest(...)` is reached by the background-color effect.
    parent.$widget = $("<div class='scrolling-container'></div>");
    const glob = window.glob as unknown as Record<string, unknown>;
    glob.getThemeStyle = () => "light";
});

afterEach(() => {
    unmountCurrent();
    while (cmPres.length) cmPres.pop()?.remove();
    vi.restoreAllMocks();
});

// --- ReadOnlyCode ---------------------------------------------------------------------------------

describe("ReadOnlyCode", () => {
    function renderReadOnly(props: Partial<TypeWidgetProps> = {}) {
        let note = props.note;
        if (!note) {
            note = buildNote({ id: "ro1", title: "RO", type: "code", content: "const a = 1;" });
            note.mime = "text/javascript";
        }
        const fullProps: TypeWidgetProps = {
            note,
            viewScope: undefined,
            ntxId: "ntx1",
            parentComponent: parent,
            noteContext: undefined,
            ...props
        };
        renderInto(<ReadOnlyCode {...fullProps} />);
        return { note, props: fullProps };
    }

    it("loads the blob content into the editor", async () => {
        renderReadOnly();
        await flush();
        expect(cmProps?.readOnly).toBe(true);
        expect(cmProps?.className).toBe("note-detail-readonly-code-content");
        expect(cmEditor?.text).toBe("const a = 1;");
    });

    it("formats HTML source for a text note in source view mode", async () => {
        const note = buildNote({ id: "roHtml", title: "H", type: "text", content: "<p>x</p><p>y</p>" });
        note.mime = "text/html";
        renderReadOnly({ note, viewScope: { viewMode: "source" } as never });
        await flush();
        // formatHtml pretty-prints onto multiple lines.
        expect(cmEditor?.text.split("\n").length).toBeGreaterThan(1);
    });

    it("pretty-prints JSON source for a non-code JSON note in source view mode", async () => {
        const note = buildNote({ id: "roJson", title: "J", type: "file", content: '{"a":1,"b":2}' });
        note.mime = "application/json";
        renderReadOnly({ note, viewScope: { viewMode: "source" } as never });
        await flush();
        expect(cmEditor?.text).toContain("\n");
        expect(cmEditor?.text).toContain('"a": 1');
    });

    it("falls back to raw content for invalid JSON in source view mode", async () => {
        const note = buildNote({ id: "roBadJson", title: "BJ", type: "file", content: "{not json" });
        note.mime = "application/json";
        renderReadOnly({ note, viewScope: { viewMode: "source" } as never });
        await flush();
        expect(cmEditor?.text).toBe("{not json");
    });

    it("applies per-note tabWidth / indentWithTabs / wrapLines labels", async () => {
        const note = buildNote({
            id: "roLabels", title: "L", type: "code", content: "x",
            "#tabWidth": "2", "#indentWithTabs": "true", "#wrapLines": "true"
        });
        note.mime = "text/javascript";
        renderReadOnly({ note });
        await flush();
        expect(cmProps?.indentSize).toBe(2);
        expect(cmProps?.useTabs).toBe(true);
        expect(cmProps?.lineWrapping).toBe(true);
    });
});

// --- EditableCode ---------------------------------------------------------------------------------

describe("EditableCode", () => {
    function renderEditable(props: Partial<EditableCodeProps> = {}) {
        let note = props.note;
        if (!note) {
            note = buildNote({ id: "ed1", title: "Ed", type: "code", content: "let x;" });
            note.mime = "text/javascript";
        }
        const fullProps = {
            note,
            viewScope: undefined,
            ntxId: "ntx1",
            parentComponent: parent,
            noteContext: fakeNoteContext({ ntxId: "ntx1" }),
            ...props
        } as EditableCodeProps;
        renderInto(<EditableCode {...fullProps} />);
        return { note, props: fullProps };
    }

    it("renders with placeholder, default tabIndex and code editor class", async () => {
        renderEditable();
        await flush();
        expect(cmProps?.className).toBe("note-detail-code-editor");
        expect(cmProps?.tabIndex).toBe(300);
        expect(cmProps?.placeholder).toBe("editable_code.placeholder");
    });

    it("uses a supplied placeholder over the default", async () => {
        renderEditable({ placeholder: "custom-ph" });
        await flush();
        expect(cmProps?.placeholder).toBe("custom-ph");
    });

    it("propagates content changes: schedules an update and invokes onContentChanged", async () => {
        const onContentChanged = vi.fn();
        renderEditable({ onContentChanged });
        await flush();
        if (cmEditor) cmEditor.text = "changed";
        act(() => (cmProps?.onContentChanged as () => void)());
        expect(onContentChanged).toHaveBeenCalledWith("changed");
    });

    it("resets the update timer first when debounceUpdate is set", async () => {
        renderEditable({ debounceUpdate: true });
        await flush();
        // Just exercising the debounced branch; no throw means the resetUpdateTimer path ran.
        expect(() => act(() => (cmProps?.onContentChanged as () => void)())).not.toThrow();
    });

    it("saves the editor text via getData when an update flushes (runActiveNote)", async () => {
        const dataSaved = vi.fn();
        const grandParent = new Component();
        vi.spyOn(grandParent, "triggerCommand").mockReturnValue(undefined);
        parent.setParent(grandParent);
        renderEditable({ ntxId: "ntx1", dataSaved });
        await flush();
        // Make the editor report some text, then schedule an update.
        if (cmEditor) cmEditor.text = "saved content";
        act(() => (cmProps?.onContentChanged as () => void)());
        // runActiveNoteCommand awaits updateNowIfNecessary(), which runs the save callback → getData().
        const handler = (parent as unknown as Record<string, (d: unknown) => Promise<unknown>>).runActiveNoteCommand;
        await act(async () => { await handler.call(parent, { ntxId: "ntx1" }); });
        await flush();
        expect(dataSaved).toHaveBeenCalled();
        expect(server.put).toHaveBeenCalled();
    });

    it("forwards the external editorRef as a function and an object ref", async () => {
        const fnRef = vi.fn();
        renderEditable({ editorRef: fnRef });
        await flush();
        expect(fnRef).toHaveBeenCalled();

        unmountCurrent();
        const objRef = { current: null as unknown };
        renderEditable({ editorRef: objRef as never });
        await flush();
        expect(objRef.current).toBeInstanceOf(FakeEditor);
    });

    it("registers a snippet predicate matching same-mime / plain-text code notes", async () => {
        const note = buildNote({ id: "edSnip", title: "S", type: "code", content: "" });
        note.mime = "text/css";
        renderEditable({ note });
        await flush();
        const matches = snippetMatches;
        if (!matches) throw new Error("predicate not captured");
        expect(matches({ type: "code", mime: "text/css", isMarkdown: () => false })).toBe(true);
        expect(matches({ type: "code", mime: "text/plain", isMarkdown: () => false })).toBe(true);
        expect(matches({ type: "code", mime: "text/html", isMarkdown: () => false })).toBe(false);
        expect(matches({ type: "text", mime: "text/css", isMarkdown: () => false })).toBe(false);
    });

    it("runActiveNoteCommand for the matching ntxId saves then delegates to the parent", async () => {
        const grandParent = new Component();
        const triggerCommand = vi.spyOn(grandParent, "triggerCommand").mockReturnValue(undefined);
        parent.setParent(grandParent);
        renderEditable({ ntxId: "ntx1" });
        await flush();
        const handler = (parent as unknown as Record<string, (d: unknown) => Promise<unknown>>).runActiveNoteCommand;
        expect(typeof handler).toBe("function");
        await act(async () => { await handler.call(parent, { ntxId: "ntx1" }); });
        expect(triggerCommand).toHaveBeenCalledWith("runActiveNote", { ntxId: "ntx1" });
    });

    it("runActiveNoteCommand for a different ntxId skips saving but still delegates", async () => {
        const grandParent = new Component();
        const triggerCommand = vi.spyOn(grandParent, "triggerCommand").mockReturnValue(undefined);
        parent.setParent(grandParent);
        renderEditable({ ntxId: "ntx1" });
        await flush();
        const handler = (parent as unknown as Record<string, (d: unknown) => Promise<unknown>>).runActiveNoteCommand;
        await act(async () => { await handler.call(parent, { ntxId: "other" }); });
        expect(triggerCommand).toHaveBeenCalledWith("runActiveNote", { ntxId: "other" });
    });

    it("applies per-note label overrides for indent and wrapping", async () => {
        const note = buildNote({
            id: "edLabels", title: "L", type: "code", content: "",
            "#tabWidth": "8", "#indentWithTabs": "true", "#wrapLines": "false"
        });
        note.mime = "text/javascript";
        renderEditable({ note });
        await flush();
        expect(cmProps?.indentSize).toBe(8);
        expect(cmProps?.useTabs).toBe(true);
        expect(cmProps?.lineWrapping).toBe(false);
    });
});

// --- CodeEditor (theme + events) ------------------------------------------------------------------

describe("CodeEditor", () => {
    function renderEditor(props: Partial<CodeEditorProps> = {}) {
        const fullProps = {
            parentComponent: parent,
            ntxId: "ntx1",
            mime: "text/javascript",
            ...props
        } as CodeEditorProps;
        renderInto(<CodeEditor {...fullProps} />);
        return fullProps;
    }

    it("derives indent size and useTabs from global options", async () => {
        setOptions({
            codeLineWrapEnabled: "true",
            codeNoteTheme: "plain",
            codeNoteTabWidth: "6",
            codeNoteIndentWithTabs: "true",
            codeNoteThemeMatchesApp: "false",
            codeNoteThemeLight: "default:light",
            codeNoteThemeDark: "default:dark"
        });
        renderEditor();
        await flush();
        expect(cmProps?.indentSize).toBe(6);
        expect(cmProps?.useTabs).toBe(true);
        expect(cmProps?.lineWrapping).toBe(true);
    });

    it("falls back to indent size 4 when the option is not a number", async () => {
        setOptions({
            codeLineWrapEnabled: "false",
            codeNoteTheme: "plain",
            codeNoteTabWidth: "not-a-number",
            codeNoteIndentWithTabs: "false",
            codeNoteThemeMatchesApp: "false",
            codeNoteThemeLight: "default:light",
            codeNoteThemeDark: "default:dark"
        });
        renderEditor();
        await flush();
        expect(cmProps?.indentSize).toBe(4);
    });

    it("applies a default-prefixed theme and updates the scrolling background color", async () => {
        themeById["mytheme"] = { id: "mytheme", load: () => Promise.resolve() };
        setOptions({
            codeLineWrapEnabled: "false",
            codeNoteTheme: "default:mytheme",
            codeNoteTabWidth: "4",
            codeNoteIndentWithTabs: "false",
            codeNoteThemeMatchesApp: "false",
            codeNoteThemeLight: "default:light",
            codeNoteThemeDark: "default:dark"
        });
        // Place the widget inside a scrolling container so the css() call has a target.
        const scrolling = document.createElement("div");
        scrolling.className = "scrolling-container";
        document.body.appendChild(scrolling);
        parent.$widget = $("<div></div>");
        scrolling.appendChild((parent.$widget as JQuery<HTMLElement>)[0]);

        renderEditor();
        await flush();
        expect(cmEditor?.themeSet).toEqual({ id: "mytheme", load: expect.any(Function) });
        scrolling.remove();
    });

    it("uses the app color scheme when matchesApp is enabled (dark)", async () => {
        themeById["dk"] = { id: "dk", load: () => Promise.resolve() };
        (window.glob as unknown as Record<string, unknown>).getThemeStyle = () => "dark";
        setOptions({
            codeLineWrapEnabled: "false",
            codeNoteTheme: "default:other",
            codeNoteTabWidth: "4",
            codeNoteIndentWithTabs: "false",
            codeNoteThemeMatchesApp: "true",
            codeNoteThemeLight: "default:light",
            codeNoteThemeDark: "default:dk"
        });
        renderEditor();
        await flush();
        expect(cmEditor?.themeSet).toEqual({ id: "dk", load: expect.any(Function) });
    });

    it("skips background update when noBackgroundChange is set", async () => {
        themeById["nobg"] = { id: "nobg", load: () => Promise.resolve() };
        const cssSpy = vi.fn();
        parent.$widget = { closest: () => ({ css: cssSpy }) } as unknown as JQuery<HTMLElement>;
        setOptions({
            codeLineWrapEnabled: "false",
            codeNoteTheme: "default:nobg",
            codeNoteTabWidth: "4",
            codeNoteIndentWithTabs: "false",
            codeNoteThemeMatchesApp: "false",
            codeNoteThemeLight: "default:light",
            codeNoteThemeDark: "default:dark"
        });
        renderEditor({ noBackgroundChange: true });
        await flush();
        expect(cssSpy).not.toHaveBeenCalled();
    });

    it("resolves executeWithCodeEditor with the editor once initialized", async () => {
        renderEditor({ ntxId: "ntx1" });
        await flush();
        let resolved: unknown = null;
        fireEvent("executeWithCodeEditor", { ntxId: "ntx1", resolve: (e: unknown) => { resolved = e; } });
        await flush();
        expect(resolved).toBe(cmEditor);
    });

    it("ignores executeWithCodeEditor for a different ntxId", async () => {
        renderEditor({ ntxId: "ntx1" });
        await flush();
        const resolve = vi.fn();
        fireEvent("executeWithCodeEditor", { ntxId: "other", resolve });
        await flush();
        expect(resolve).not.toHaveBeenCalled();
    });

    it("resolves executeWithContentElement with the container jQuery selector", async () => {
        renderEditor({ ntxId: "ntx1" });
        await flush();
        let resolved: JQuery<HTMLElement> | null = null;
        fireEvent("executeWithContentElement", { ntxId: "ntx1", resolve: (el: JQuery<HTMLElement>) => { resolved = el; } });
        await flush();
        expect(resolved).not.toBeNull();
        expect((resolved as unknown as JQuery<HTMLElement> | null)?.length).toBeGreaterThan(0);
    });

    it("scrollToEnd scrolls and focuses the editor for the matching ntxId only", async () => {
        renderEditor({ ntxId: "ntx1" });
        await flush();
        fireEvent("scrollToEnd", { ntxId: "other" });
        expect(cmEditor?.scrolledToEnd).toBe(0);
        fireEvent("scrollToEnd", { ntxId: "ntx1" });
        expect(cmEditor?.scrolledToEnd).toBe(1);
        expect(cmEditor?.focused).toBeGreaterThan(0);
    });

    it("focusOnDetail focuses the editor for the matching ntxId only", async () => {
        renderEditor({ ntxId: "ntx1" });
        await flush();
        const before = cmEditor?.focused ?? 0;
        fireEvent("focusOnDetail", { ntxId: "other" });
        expect(cmEditor?.focused).toBe(before);
        fireEvent("focusOnDetail", { ntxId: "ntx1" });
        expect(cmEditor?.focused).toBe(before + 1);
    });

    it("forwards container and editor refs through onInitialized (object + function refs)", async () => {
        const containerObjRef = { current: null as HTMLElement | null };
        const editorObjRef = { current: null as unknown };
        renderEditor({ ntxId: "ntx1", containerRef: containerObjRef as never, editorRef: editorObjRef as never });
        await flush();
        expect(containerObjRef.current).toBeInstanceOf(HTMLElement);
        expect(editorObjRef.current).toBeInstanceOf(FakeEditor);

        unmountCurrent();
        const containerFnRef = vi.fn();
        const editorFnRef = vi.fn();
        const onInitialized = vi.fn();
        renderEditor({ ntxId: "ntx1", containerRef: containerFnRef as never, editorRef: editorFnRef as never, onInitialized });
        await flush();
        expect(containerFnRef).toHaveBeenCalled();
        expect(editorFnRef).toHaveBeenCalled();
        expect(onInitialized).toHaveBeenCalled();
    });

    it("honors an explicit lineWrapping prop over the global option", async () => {
        setOptions({
            codeLineWrapEnabled: "true",
            codeNoteTheme: "plain",
            codeNoteTabWidth: "4",
            codeNoteIndentWithTabs: "false",
            codeNoteThemeMatchesApp: "false",
            codeNoteThemeLight: "default:light",
            codeNoteThemeDark: "default:dark"
        });
        renderEditor({ lineWrapping: false });
        await flush();
        expect(cmProps?.lineWrapping).toBe(false);
    });
});
