import type { OptionNames } from "@triliumnext/commons";
import { act } from "preact/test-utils";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { bootstrapMock } from "../../../test/mocks";

// --- Module mocks (hoisted above the component import) --------------------------------------------

vi.mock("bootstrap", () => bootstrapMock());

// Capture the props passed to the (heavyweight, real CKEditor) child so the tests can drive its
// callbacks without instantiating an actual editor.
const ckProps: { current: Record<string, unknown> } = { current: {} };
// An editor pre-attached to the watchdog on first render (set before rendering when a test needs the
// editor available during the initial blob-load effect, e.g. the bookmark-scroll path).
const preAttachedEditor: { current: unknown } = { current: undefined };
vi.mock("./CKEditorWithWatchdog", () => ({
    default: (props: Record<string, unknown>) => {
        ckProps.current = props;
        // The real child assigns its container element through the forwarded ref; mirror that so the
        // component's container-dependent code paths (image opening, included-note refresh) run.
        const containerRef = props.containerRef as { current: HTMLDivElement | null } | undefined;
        if (containerRef && !containerRef.current) {
            containerRef.current = document.createElement("div");
        }
        const watchdogRef = props.watchdogRef as { current: unknown } | undefined;
        if (watchdogRef && preAttachedEditor.current) {
            watchdogRef.current = { editor: preAttachedEditor.current };
        }
        return null;
    }
}));

vi.mock("./snippets.js", () => ({
    default: vi.fn(async () => [ { title: "Snippet", data: () => "x", icon: "<svg/>", description: "d" } ]),
    updateTemplateCache: vi.fn(async () => undefined)
}));

vi.mock("./utils", () => ({
    loadIncludedNote: vi.fn(),
    refreshIncludedNote: vi.fn(),
    setupImageOpening: vi.fn()
}));

vi.mock("../../../services/dialog", () => ({ default: { info: vi.fn() } }));
vi.mock("../../../services/toast", () => ({
    default: {
        showPersistent: vi.fn(),
        showError: vi.fn(),
        showErrorTitleAndMessage: vi.fn()
    }
}));
vi.mock("../../../services/link_embed", () => ({
    default: {
        fetchMetadata: vi.fn(async () => ({ url: "u" })),
        detectEmbedType: vi.fn(() => "iframe"),
        renderEmbedPreview: vi.fn(),
        renderMentionPreview: vi.fn()
    }
}));
vi.mock("../../../services/note_create", () => ({
    default: {
        createNoteWithTypePrompt: vi.fn(async () => ({ note: { getBestNotePathString: () => "root/created" } })),
        createNote: vi.fn(async () => undefined)
    }
}));
vi.mock("../../../services/link", async (importOriginal) => ({
    ...(await importOriginal<typeof import("../../../services/link")>()),
    default: { getNotePathFromUrl: vi.fn(() => "root/linked") },
    parseNavigationStateFromUrl: vi.fn(() => ({ notePath: "root/ref" }))
}));

import appContext from "../../../components/app_context";
import Component from "../../../components/component";
import type NoteContext from "../../../components/note_context";
import dialog from "../../../services/dialog";
import link_embed from "../../../services/link_embed";
import note_create from "../../../services/note_create";
import server from "../../../services/server";
import toast from "../../../services/toast";
import { buildNote } from "../../../test/easy-froca";
import { fakeNoteContext as baseFakeNoteContext, flush, makeLoadResults, renderComponent, resetFroca } from "../../../test/render";
import options from "../../../services/options";
import { loadIncludedNote, refreshIncludedNote, setupImageOpening } from "./utils";
import { updateTemplateCache } from "./snippets.js";
import EditableText from "./EditableText";
import type { TypeWidgetProps } from "../type_widget";

// --- Fakes ---------------------------------------------------------------------------------------

interface FakeEditor {
    getData: () => string;
    setData: ReturnType<typeof vi.fn>;
    editing: { view: { focus: ReturnType<typeof vi.fn>; getDomRoot: () => HTMLElement | undefined } };
    model: {
        change: (cb: (writer: unknown) => void) => void;
        document: {
            getRoot: () => unknown;
            selection: {
                getLastPosition: () => unknown;
                getSelectedElement?: () => unknown;
                hasAttribute?: (name: string) => boolean;
                getAttribute?: (name: string) => unknown;
            };
        };
    };
    focus: ReturnType<typeof vi.fn>;
    enableReadOnlyMode: ReturnType<typeof vi.fn>;
}

function makeEditor(domRoot?: HTMLElement, overrides: Partial<FakeEditor> = {}): FakeEditor {
    const writer = {
        setSelection: vi.fn(),
        createPositionAt: vi.fn(() => "pos"),
        insertText: vi.fn()
    };
    return {
        getData: () => "<p>hello</p>",
        setData: vi.fn(),
        editing: { view: { focus: vi.fn(), getDomRoot: () => domRoot } },
        model: {
            change: (cb: (w: unknown) => void) => cb(writer),
            document: {
                getRoot: () => ({}),
                selection: {
                    getLastPosition: () => "lastPos",
                    getSelectedElement: () => undefined,
                    hasAttribute: () => false,
                    getAttribute: () => undefined
                }
            }
        },
        focus: vi.fn(),
        enableReadOnlyMode: vi.fn(),
        ...overrides
    };
}

function fakeNoteContext(overrides: Record<string, unknown> = {}): NoteContext {
    // The shared base lacks the two methods EditableText calls (`isActive`, `getTextEditor`); add
    // them as defaults so tests can override or assert on them.
    return baseFakeNoteContext({
        isActive: vi.fn(() => true),
        getTextEditor: vi.fn(async () => undefined),
        ...overrides
    });
}

// --- Render harness ------------------------------------------------------------------------------

function renderEditableText(props: TypeWidgetProps, parent: Component) {
    const { container } = renderComponent(<EditableText {...props} />, { parent, noteContext: props.noteContext ?? null });
    return container;
}

function fireEvent(parent: Component, name: string, data: unknown) {
    act(() => {
        (parent.handleEventInChildren as (n: string, d: unknown) => void)(name, data);
    });
}

/** Set the stubbed editor's watchdog so the component's `waitForEditor()` resolves to it. */
function attachEditor(editor: FakeEditor | undefined) {
    const watchdogRef = ckProps.current.watchdogRef as { current: { editor: FakeEditor | undefined } | null } | undefined;
    if (watchdogRef) {
        watchdogRef.current = { editor };
    }
}

function getEditorApiRef() {
    return ckProps.current.editorApi as { current: Record<string, (...args: never[]) => unknown> | null } | undefined;
}

beforeEach(() => {
    resetFroca();
    vi.clearAllMocks();
    ckProps.current = {};
    preAttachedEditor.current = undefined;
    options.load({ textNoteEditorType: "ckeditor-balloon", codeBlockWordWrap: "false", codeBlockTabWidth: "4", locale: "en" } as Record<OptionNames, string>);
    (globalThis as unknown as { logInfo: unknown }).logInfo = vi.fn();
    (globalThis as unknown as { logError: unknown }).logError = vi.fn();
    Object.assign(appContext, {
        tabManager: {
            getActiveContext: vi.fn(() => null),
            getActiveContextNote: vi.fn(() => null),
            getActiveContextNotePath: vi.fn(() => null)
        }
    });
});

// --- Tests ---------------------------------------------------------------------------------------

describe("EditableText render", () => {
    it("renders the editor child once templates resolve and forwards word-wrap class off", async () => {
        const note = buildNote({ id: "n1", title: "N1", content: "<p>body</p>" });
        const parent = new Component();
        renderEditableText({ note, ntxId: "ntx1", viewScope: undefined, parentComponent: new Component(), noteContext: fakeNoteContext() }, parent);
        await flush();

        expect(typeof ckProps.current.onEditorInitialized).toBe("function");
        const className = ckProps.current.className as string;
        expect(className).toContain("note-detail-editable-text-editor");
        expect(className).not.toContain("word-wrap");
        expect(ckProps.current.isClassicEditor).toBe(false);
        expect(ckProps.current.tabIndex).toBe(300);
    });

    it("adds word-wrap class and classic flag from options", async () => {
        options.load({ textNoteEditorType: "ckeditor-classic", codeBlockWordWrap: "true", codeBlockTabWidth: "2", locale: "en" } as Record<OptionNames, string>);
        const note = buildNote({ id: "n2", title: "N2" });
        const parent = new Component();
        renderEditableText({ note, ntxId: "ntx1", viewScope: undefined, parentComponent: new Component(), noteContext: fakeNoteContext() }, parent);
        await flush();

        expect((ckProps.current.className as string)).toContain("word-wrap");
        expect(ckProps.current.isClassicEditor).toBe(true);
        // codeBlockTabWidth effect sets the CSS variable on the body.
        expect(document.body.style.getPropertyValue("--code-block-tab-width")).toBe("2");
    });

    it("passes the note language to the editor as contentLanguage", async () => {
        const note = buildNote({ id: "n3", title: "N3", "#language": "fr" });
        const parent = new Component();
        renderEditableText({ note, ntxId: "ntx1", viewScope: undefined, parentComponent: new Component(), noteContext: fakeNoteContext() }, parent);
        await flush();
        expect(ckProps.current.contentLanguage).toBe("fr");
    });

    it("refreshes the snippet templates on entitiesReloaded", async () => {
        const note = buildNote({ id: "tmpl1", title: "T", content: "<p>x</p>" });
        const parent = new Component();
        renderEditableText({ note, ntxId: "ntx1", viewScope: undefined, parentComponent: new Component(), noteContext: fakeNoteContext() }, parent);
        await flush();

        const loadResults = Object.assign(makeLoadResults({}), { getNoteIds: () => [] });
        fireEvent(parent, "entitiesReloaded", { loadResults });
        await flush();
        expect(updateTemplateCache).toHaveBeenCalledWith(loadResults, expect.any(Function));
    });
});

describe("onEditorInitialized", () => {
    it("sets up image opening, resolves init, restores content and triggers a refresh event", async () => {
        const note = buildNote({ id: "ei1", title: "EI", content: "<p>saved</p>" });
        const parent = new Component();
        const parentComponent = new Component();
        const triggerEvent = vi.spyOn(parentComponent, "triggerEvent").mockReturnValue(undefined);
        renderEditableText({ note, ntxId: "ntxA", viewScope: undefined, parentComponent, noteContext: fakeNoteContext() }, parent);
        await flush();

        const editor = makeEditor();
        attachEditor(editor);
        act(() => {
            (ckProps.current.onEditorInitialized as (e: FakeEditor) => void)(editor);
        });

        expect(setupImageOpening).toHaveBeenCalled();
        expect(editor.setData).toHaveBeenCalled();
        expect(triggerEvent).toHaveBeenCalledWith("textEditorRefreshed", expect.objectContaining({ ntxId: "ntxA", editor }));
    });

    it("onChange schedules an update which persists data via getData and dataSaved", async () => {
        const note = buildNote({ id: "save1", title: "Save", content: "<p>init</p>" });
        const noteContext = fakeNoteContext({ ntxId: "ntxSave" });
        const parent = new Component();
        renderEditableText({ note, ntxId: "ntxSave", viewScope: undefined, parentComponent: new Component(), noteContext }, parent);
        await flush();

        const editor = makeEditor();
        attachEditor(editor);

        act(() => { (ckProps.current.onChange as () => void)(); });
        // beforeNoteSwitch with matching ntx flushes the spaced update -> getData -> server.put.
        fireEvent(parent, "beforeNoteSwitch", { noteContext: { ntxId: "ntxSave" } });
        await flush();
        expect(server.put).toHaveBeenCalled();
    });

    it("onContentChange scrolls to the bookmark anchor when one is present in the view scope", async () => {
        const raf = vi.spyOn(window, "requestAnimationFrame").mockImplementation((cb: FrameRequestCallback) => {
            cb(0);
            return 0;
        });
        const domRoot = document.createElement("div");
        const anchor = document.createElement("div");
        anchor.id = "anchor1";
        const scrollIntoView = vi.fn();
        anchor.scrollIntoView = scrollIntoView;
        domRoot.appendChild(anchor);
        const editor = makeEditor(domRoot);
        preAttachedEditor.current = editor;

        const note = buildNote({ id: "bm1", title: "BM", content: "<p>body</p>" });
        const viewScope = { viewMode: "default" as const, bookmark: "anchor1" };
        const noteContext = fakeNoteContext({ ntxId: "bmNtx", viewScope });
        const parent = new Component();
        renderEditableText({ note, ntxId: "bmNtx", viewScope, parentComponent: new Component(), noteContext }, parent);
        await flush();

        expect(scrollIntoView).toHaveBeenCalled();
        expect(viewScope.bookmark).toBeUndefined();
        raf.mockRestore();
    });

    it("getData returns early (saves nothing) when there is no editor", async () => {
        const note = buildNote({ id: "noed1", title: "NoEd", content: "<p>x</p>" });
        const noteContext = fakeNoteContext({ ntxId: "noEdNtx" });
        const parent = new Component();
        renderEditableText({ note, ntxId: "noEdNtx", viewScope: undefined, parentComponent: new Component(), noteContext }, parent);
        await flush();

        attachEditor(undefined);
        act(() => { (ckProps.current.onChange as () => void)(); });
        fireEvent(parent, "beforeNoteSwitch", { noteContext: { ntxId: "noEdNtx" } });
        await flush();
        expect(server.put).not.toHaveBeenCalled();
    });

    it("getData returns empty content when the editor html is empty", async () => {
        const note = buildNote({ id: "save2", title: "Save2", content: "<p>init</p>" });
        const noteContext = fakeNoteContext({ ntxId: "ntxSave2" });
        const parent = new Component();
        renderEditableText({ note, ntxId: "ntxSave2", viewScope: undefined, parentComponent: new Component(), noteContext }, parent);
        await flush();

        const editor = makeEditor(undefined, { getData: () => "<p>&nbsp;</p>" });
        attachEditor(editor);
        act(() => { (ckProps.current.onChange as () => void)(); });
        fireEvent(parent, "beforeNoteSwitch", { noteContext: { ntxId: "ntxSave2" } });
        await flush();
        const lastCall = (server.put as ReturnType<typeof vi.fn>).mock.calls.at(-1);
        expect(lastCall?.[1]).toEqual({ content: "" });
    });
});

describe("Trilium events", () => {
    function setup(eventNtxId = "ntxEv") {
        const note = buildNote({ id: `ev-${eventNtxId}`, title: "Ev", content: "<p>x</p>" });
        const noteContext = fakeNoteContext({ ntxId: eventNtxId });
        const parent = new Component();
        renderEditableText({ note, ntxId: eventNtxId, viewScope: undefined, parentComponent: new Component(), noteContext }, parent);
        return { parent, note, noteContext };
    }

    it("scrollToEnd moves selection to end and focuses the editor", async () => {
        const { parent } = setup();
        await flush();
        const editor = makeEditor();
        attachEditor(editor);
        // resolve the deferred initialized promise so waitForEditor returns.
        act(() => { (ckProps.current.onEditorInitialized as (e: FakeEditor) => void)(editor); });

        fireEvent(parent, "scrollToEnd", {});
        expect(editor.editing.view.focus).toHaveBeenCalled();
    });

    it("scrollToEnd is a no-op without an editor", async () => {
        const { parent } = setup();
        await flush();
        attachEditor(undefined);
        expect(() => fireEvent(parent, "scrollToEnd", {})).not.toThrow();
    });

    it("focusOnDetail focuses the editor only for the matching ntxId", async () => {
        const { parent } = setup("focusNtx");
        await flush();
        const editor = makeEditor();
        attachEditor(editor);
        act(() => { (ckProps.current.onEditorInitialized as (e: FakeEditor) => void)(editor); });

        fireEvent(parent, "focusOnDetail", { ntxId: "other" });
        await flush();
        expect(editor.editing.view.focus).not.toHaveBeenCalled();

        fireEvent(parent, "focusOnDetail", { ntxId: "focusNtx" });
        await flush();
        expect(editor.editing.view.focus).toHaveBeenCalled();
    });

    it("refreshIncludedNote delegates to the util with the container", async () => {
        const { parent } = setup();
        await flush();
        fireEvent(parent, "refreshIncludedNote", { noteId: "incl1" });
        expect(refreshIncludedNote).toHaveBeenCalledWith(expect.anything(), "incl1");
    });

    it("executeWithTextEditor runs the callback and resolves for the matching ntxId", async () => {
        const { parent } = setup("execNtx");
        await flush();
        const editor = makeEditor();
        attachEditor(editor);
        act(() => { (ckProps.current.onEditorInitialized as (e: FakeEditor) => void)(editor); });

        const callback = vi.fn();
        const resolve = vi.fn();
        fireEvent(parent, "executeWithTextEditor", { ntxId: "execNtx", callback, resolve });
        await flush();
        expect(callback).toHaveBeenCalledWith(editor);
        expect(resolve).toHaveBeenCalledWith(editor);

        // A non-matching ntx is ignored.
        const callback2 = vi.fn();
        fireEvent(parent, "executeWithTextEditor", { ntxId: "nope", callback: callback2, resolve: vi.fn() });
        await flush();
        expect(callback2).not.toHaveBeenCalled();
    });

    it("addTextToActiveEditor inserts text when the context is active", async () => {
        const note = buildNote({ id: "att1", title: "ATT", content: "<p>x</p>" });
        const noteContext = fakeNoteContext({ ntxId: "attNtx", isActive: vi.fn(() => true) });
        const parent = new Component();
        renderEditableText({ note, ntxId: "attNtx", viewScope: undefined, parentComponent: new Component(), noteContext }, parent);
        await flush();
        const editor = makeEditor();
        attachEditor(editor);
        act(() => { (ckProps.current.onEditorInitialized as (e: FakeEditor) => void)(editor); });

        fireEvent(parent, "addTextToActiveEditor", { text: "hi" });
        await flush();
        expect(editor.editing).toBeDefined();
    });

    it("addTextToActiveEditor is ignored when the context is not active", async () => {
        const note = buildNote({ id: "att2", title: "ATT2" });
        const noteContext = fakeNoteContext({ ntxId: "attNtx2", isActive: vi.fn(() => false) });
        const parent = new Component();
        renderEditableText({ note, ntxId: "attNtx2", viewScope: undefined, parentComponent: new Component(), noteContext }, parent);
        await flush();
        expect(() => fireEvent(parent, "addTextToActiveEditor", { text: "hi" })).not.toThrow();
    });
});

describe("legacy imperative handlers (assigned to the parent component)", () => {
    function setupHandlers(noteContextOverrides: Record<string, unknown> = {}) {
        const note = buildNote({ id: "lh1", title: "LH", content: "<p>x</p>" });
        const noteContext = fakeNoteContext({ ntxId: "lhNtx", ...noteContextOverrides });
        const parent = new Component();
        const parentComponent = new Component();
        const triggerCommand = vi.spyOn(parentComponent, "triggerCommand").mockReturnValue(undefined);
        renderEditableText({ note, ntxId: "lhNtx", viewScope: undefined, parentComponent, noteContext }, parent);
        return { parent, parentComponent, triggerCommand, note, noteContext };
    }

    function handlers(parent: Component) {
        return parent as unknown as Record<string, (...args: unknown[]) => unknown>;
    }

    it("addLinkToTextCommand triggers showAddLinkDialog and the forwarded addLink delegates to the api", async () => {
        const { parent, triggerCommand } = setupHandlers();
        await flush();
        const editor = makeEditor();
        attachEditor(editor);
        act(() => { (ckProps.current.onEditorInitialized as (e: FakeEditor) => void)(editor); });
        const addLink = vi.fn();
        const api = getEditorApiRef();
        if (api) api.current = { getSelectedText: () => "sel", hasSelection: () => true, addLink };
        act(() => { handlers(parent).addLinkToTextCommand(); });
        expect(triggerCommand).toHaveBeenCalledWith("showAddLinkDialog", expect.any(Object));

        // Invoke the addLink callback that the command forwarded to the dialog.
        const dialogArg = triggerCommand.mock.calls[0][1] as { addLink: (n: string, t: string | null, e?: boolean) => Promise<unknown> };
        await act(async () => { await dialogArg.addLink("root/x", "Title", false); });
        expect(addLink).toHaveBeenCalledWith("root/x", "Title", false);
    });

    it("addLinkToTextCommand is a no-op when there is no editor api", async () => {
        const { parent, triggerCommand } = setupHandlers();
        await flush();
        const api = getEditorApiRef();
        if (api) api.current = null;
        act(() => { handlers(parent).addLinkToTextCommand(); });
        expect(triggerCommand).not.toHaveBeenCalled();
    });

    it("pasteMarkdownIntoTextCommand and addIncludeNoteToTextCommand and addLinkEmbedToTextCommand forward to dialogs", async () => {
        const { parent, triggerCommand } = setupHandlers();
        await flush();
        const api = getEditorApiRef();
        if (api) api.current = { getSelectedText: () => "", hasSelection: () => false, addLink: vi.fn() };
        act(() => { handlers(parent).pasteMarkdownIntoTextCommand(); });
        act(() => { handlers(parent).addIncludeNoteToTextCommand(); });
        act(() => { handlers(parent).addLinkEmbedToTextCommand(); });
        expect(triggerCommand).toHaveBeenCalledWith("showPasteMarkdownDialog", expect.any(Object));
        expect(triggerCommand).toHaveBeenCalledWith("showIncludeNoteDialog", expect.any(Object));
        expect(triggerCommand).toHaveBeenCalledWith("showLinkEmbedDialog", expect.any(Object));
    });

    it("insertDateTimeToTextCommand inserts the formatted date into the editor", async () => {
        const getSpy = vi.spyOn(options, "get").mockReturnValue("YYYY-MM-DD");
        const { parent } = setupHandlers();
        await flush();
        const editor = makeEditor();
        attachEditor(editor);
        act(() => { (ckProps.current.onEditorInitialized as (e: FakeEditor) => void)(editor); });
        const api = getEditorApiRef();
        if (api) api.current = { getSelectedText: () => "", hasSelection: () => false, addLink: vi.fn() };
        act(() => { handlers(parent).insertDateTimeToTextCommand(); });
        await flush();
        expect(getSpy).toHaveBeenCalledWith("customDateTimeFormat");
    });

    it("exposes link-embed helper handlers backed by the link_embed service", async () => {
        const { parent } = setupHandlers();
        await flush();
        const h = handlers(parent);
        const containerEl = document.createElement("div");
        await h.fetchLinkMetadata("http://x");
        h.detectEmbedType("http://x");
        h.renderLinkEmbed(containerEl, { url: "u" }, true);
        h.renderLinkMention(containerEl, { url: "u" }, true);
        expect(link_embed.fetchMetadata).toHaveBeenCalledWith("http://x");
        expect(link_embed.detectEmbedType).toHaveBeenCalledWith("http://x");
        expect(link_embed.renderEmbedPreview).toHaveBeenCalled();
        expect(link_embed.renderMentionPreview).toHaveBeenCalled();
    });

    it("loadIncludedNote handler is wired to the util", async () => {
        const { parent } = setupHandlers();
        await flush();
        expect(handlers(parent).loadIncludedNote).toBe(loadIncludedNote);
    });

    it("createNoteForReferenceLink creates a note and returns its best path", async () => {
        const { parent } = setupHandlers({ notePath: "root/parent" });
        await flush();
        const result = await handlers(parent).createNoteForReferenceLink("New title");
        expect(note_create.createNoteWithTypePrompt).toHaveBeenCalled();
        expect(result).toBe("root/created");
    });

    it("createNoteForReferenceLink returns early without a note path", async () => {
        const { parent } = setupHandlers({ notePath: undefined });
        await flush();
        const result = await handlers(parent).createNoteForReferenceLink("title");
        expect(result).toBeUndefined();
        expect(note_create.createNoteWithTypePrompt).not.toHaveBeenCalled();
    });

    it("saveNoteDetailNowCommand flushes the spaced update", async () => {
        const { parent } = setupHandlers();
        await flush();
        const editor = makeEditor();
        attachEditor(editor);
        act(() => { (ckProps.current.onChange as () => void)(); });
        await act(async () => { await handlers(parent).saveNoteDetailNowCommand(); });
        expect(server.put).toHaveBeenCalled();
    });

    it("cutIntoNoteCommand creates a note from the active selection", async () => {
        const activeNote = buildNote({ id: "active1", title: "Active" });
        Object.assign(appContext, {
            tabManager: {
                getActiveContext: vi.fn(() => null),
                getActiveContextNote: vi.fn(() => activeNote),
                getActiveContextNotePath: vi.fn(() => "root/active1")
            }
        });
        const { parent, noteContext } = setupHandlers();
        (noteContext.getTextEditor as ReturnType<typeof vi.fn>).mockResolvedValue(makeEditor());
        await flush();
        await act(async () => { await handlers(parent).cutIntoNoteCommand(); });
        expect(note_create.createNote).toHaveBeenCalledWith("root/active1", expect.objectContaining({ saveSelection: true }));
    });

    it("cutIntoNoteCommand is a no-op without an active note", async () => {
        Object.assign(appContext, {
            tabManager: {
                getActiveContext: vi.fn(() => null),
                getActiveContextNote: vi.fn(() => null),
                getActiveContextNotePath: vi.fn(() => null)
            }
        });
        const { parent } = setupHandlers();
        await flush();
        await act(async () => { await handlers(parent).cutIntoNoteCommand(); });
        expect(note_create.createNote).not.toHaveBeenCalled();
    });
});

describe("followLinkUnderCursorCommand", () => {
    function setupFollow() {
        const note = buildNote({ id: "fl1", title: "FL", content: "<p>x</p>" });
        const noteContext = fakeNoteContext({ ntxId: "flNtx" });
        const parent = new Component();
        renderEditableText({ note, ntxId: "flNtx", viewScope: undefined, parentComponent: new Component(), noteContext }, parent);
        return { parent };
    }
    function handlers(parent: Component) {
        return parent as unknown as Record<string, (...args: unknown[]) => Promise<unknown>>;
    }

    it("navigates to a reference link target note", async () => {
        const setNote = vi.fn(async () => undefined);
        Object.assign(appContext, { tabManager: { getActiveContext: vi.fn(() => ({ setNote })) } });
        const { parent } = setupFollow();
        await flush();
        const editor = makeEditor(undefined, {
            model: {
                change: (cb: (w: unknown) => void) => cb({}),
                document: {
                    getRoot: () => ({}),
                    selection: {
                        getLastPosition: () => "p",
                        getSelectedElement: () => ({ name: "reference", getAttribute: () => "#root/ref" }),
                        hasAttribute: () => false,
                        getAttribute: () => undefined
                    }
                }
            }
        });
        attachEditor(editor);
        act(() => { (ckProps.current.onEditorInitialized as (e: FakeEditor) => void)(editor); });
        await act(async () => { await handlers(parent).followLinkUnderCursorCommand(); });
        expect(setNote).toHaveBeenCalledWith("root/ref");
    });

    it("opens an external link when the selection has a non-note linkHref", async () => {
        const setNote = vi.fn(async () => undefined);
        Object.assign(appContext, { tabManager: { getActiveContext: vi.fn(() => ({ setNote })) } });
        const link = (await import("../../../services/link")).default as unknown as { getNotePathFromUrl: ReturnType<typeof vi.fn> };
        link.getNotePathFromUrl.mockReturnValueOnce(undefined);
        const openSpy = vi.spyOn(window, "open").mockReturnValue(null);
        const { parent } = setupFollow();
        await flush();
        const editor = makeEditor(undefined, {
            model: {
                change: (cb: (w: unknown) => void) => cb({}),
                document: {
                    getRoot: () => ({}),
                    selection: {
                        getLastPosition: () => "p",
                        getSelectedElement: () => undefined,
                        hasAttribute: (n: string) => n === "linkHref",
                        getAttribute: () => "https://example.com"
                    }
                }
            }
        });
        attachEditor(editor);
        act(() => { (ckProps.current.onEditorInitialized as (e: FakeEditor) => void)(editor); });
        await act(async () => { await handlers(parent).followLinkUnderCursorCommand(); });
        expect(openSpy).toHaveBeenCalledWith("https://example.com", "_blank");
    });

    it("navigates within the app when the linkHref resolves to a note path", async () => {
        const setNote = vi.fn(async () => undefined);
        Object.assign(appContext, { tabManager: { getActiveContext: vi.fn(() => ({ setNote })) } });
        const { parent } = setupFollow();
        await flush();
        const editor = makeEditor(undefined, {
            model: {
                change: (cb: (w: unknown) => void) => cb({}),
                document: {
                    getRoot: () => ({}),
                    selection: {
                        getLastPosition: () => "p",
                        getSelectedElement: () => undefined,
                        hasAttribute: (n: string) => n === "linkHref",
                        getAttribute: () => "#root/linked"
                    }
                }
            }
        });
        attachEditor(editor);
        act(() => { (ckProps.current.onEditorInitialized as (e: FakeEditor) => void)(editor); });
        await act(async () => { await handlers(parent).followLinkUnderCursorCommand(); });
        expect(setNote).toHaveBeenCalledWith("root/linked");
    });

    it("returns early when the selection has no link attribute", async () => {
        const setNote = vi.fn(async () => undefined);
        Object.assign(appContext, { tabManager: { getActiveContext: vi.fn(() => ({ setNote })) } });
        const { parent } = setupFollow();
        await flush();
        const editor = makeEditor();
        attachEditor(editor);
        act(() => { (ckProps.current.onEditorInitialized as (e: FakeEditor) => void)(editor); });
        await act(async () => { await handlers(parent).followLinkUnderCursorCommand(); });
        expect(setNote).not.toHaveBeenCalled();
    });
});

describe("watchdog crash handling (onWatchdogStateChange)", () => {
    async function setupWatchdog() {
        const note = buildNote({ id: "wd1", title: "WD", content: "<p>x</p>" });
        const parent = new Component();
        renderEditableText({ note, ntxId: "wdNtx", viewScope: undefined, parentComponent: new Component(), noteContext: fakeNoteContext() }, parent);
        await flush();
        return ckProps.current.onWatchdogStateChange as (wd: unknown) => void;
    }

    it("shows a persistent toast when the editor crashes", async () => {
        const onState = await setupWatchdog();
        act(() => onState({ state: "crashed", crashes: [ { date: 1 } ], editor: { focus: vi.fn() } }));
        expect(toast.showPersistent).toHaveBeenCalledWith(expect.objectContaining({ id: "editor-crashed" }));

        // The toast button click opens a details dialog.
        const toastArg = (toast.showPersistent as ReturnType<typeof vi.fn>).mock.calls[0][0];
        act(() => toastArg.buttons[0].onClick({ dismissToast: vi.fn() }));
        expect(dialog.info).toHaveBeenCalled();
    });

    it("shows a keeps-crashing dialog and enables read-only mode when crashed permanently", async () => {
        const onState = await setupWatchdog();
        const editor = { enableReadOnlyMode: vi.fn(), focus: vi.fn() };
        act(() => onState({ state: "crashedPermanently", crashes: [], editor }));
        expect(dialog.info).toHaveBeenCalled();
        expect(editor.enableReadOnlyMode).toHaveBeenCalledWith("crashed-editor");
    });

    it("refocuses the editor when recovering to ready after a crash", async () => {
        const onState = await setupWatchdog();
        const editor = { focus: vi.fn(), enableReadOnlyMode: vi.fn() };
        act(() => onState({ state: "crashed", crashes: [], editor }));
        act(() => onState({ state: "ready", crashes: [], editor }));
        expect(editor.focus).toHaveBeenCalled();
    });

    it("ignores benign non-crash states", async () => {
        const onState = await setupWatchdog();
        act(() => onState({ state: "initializing", crashes: [], editor: { focus: vi.fn() } }));
        expect(toast.showPersistent).not.toHaveBeenCalled();
        expect(dialog.info).not.toHaveBeenCalled();
    });
});

describe("onNotificationWarning", () => {
    async function getOnNotificationWarning() {
        const note = buildNote({ id: "nw1", title: "NW", content: "<p>x</p>" });
        const parent = new Component();
        renderEditableText({ note, ntxId: "nwNtx", viewScope: undefined, parentComponent: new Component(), noteContext: fakeNoteContext() }, parent);
        await flush();
        return ckProps.current.onNotificationWarning as (data: unknown, evt: unknown) => void;
    }

    it("shows title-and-message when both are present", async () => {
        const onWarn = await getOnNotificationWarning();
        const stop = vi.fn();
        onWarn({ title: "T", message: { message: "M" } }, { stop });
        expect(toast.showErrorTitleAndMessage).toHaveBeenCalledWith("T", "M");
        expect(stop).toHaveBeenCalled();
    });

    it("shows just the title when no message is present", async () => {
        const onWarn = await getOnNotificationWarning();
        const stop = vi.fn();
        onWarn({ title: "OnlyTitle", message: { message: undefined } }, { stop });
        expect(toast.showError).toHaveBeenCalledWith("OnlyTitle");
        expect(stop).toHaveBeenCalled();
    });
});
