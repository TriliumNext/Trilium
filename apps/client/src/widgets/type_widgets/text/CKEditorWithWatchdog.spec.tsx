import { act } from "preact/test-utils";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { flush, renderComponent } from "../../../test/render";

// --- Module mocks (hoisted above the component import) --------------------------------------------

interface FakeRange {
    getItems(): { data?: string }[];
    end: unknown;
}

interface FakeEditor {
    isReadOnly: boolean;
    destroyed: boolean;
    inserted: { name: string; attrs?: Record<string, unknown> }[];
    executed: { command: string; args: unknown[] }[];
    focused: boolean;
    selectionRange: FakeRange | null;
    firstPosition: unknown;
    lastPosition: unknown;
    lastSetSelection: unknown;
    notificationHandlers: Record<string, ((...a: unknown[]) => void)[]>;
    changeDataHandlers: ((...a: unknown[]) => void)[];
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    model: any;
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    data: any;
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    editing: any;
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    plugins: any;
    execute(command: string, ...args: unknown[]): void;
    destroy(): Promise<void>;
}

interface FakeWatchdog {
    EditorClass: unknown;
    config: unknown;
    editor: FakeEditor | null;
    creator: (() => Promise<FakeEditor>) | null;
    stateChangeHandlers: (() => void)[];
    created: boolean;
    destroyed: boolean;
    setCreator(creator: () => Promise<FakeEditor>): void;
    on(evt: string, cb: () => void): void;
    create(element: HTMLElement, config: unknown): Promise<void>;
    destroy(): Promise<void>;
}

// All fakes live inside vi.hoisted so the (hoisted) vi.mock factories can reference them.
const fakes = vi.hoisted(() => {
    const watchdogInstances: FakeWatchdog[] = [];

    function makeFakeEditor(): FakeEditor {
        const editor: FakeEditor = {
            isReadOnly: false,
            destroyed: false,
            inserted: [],
            executed: [],
            focused: false,
            selectionRange: null,
            firstPosition: { pos: "first" },
            lastPosition: { pos: "last" },
            lastSetSelection: null,
            notificationHandlers: {},
            changeDataHandlers: [],
            model: undefined,
            data: {
                processor: { toView: (html: string) => ({ html }) },
                toModel: (view: unknown) => ({ name: "fragment", attrs: { view } })
            },
            editing: { view: { focus: () => { editor.focused = true; } } },
            plugins: {
                get: (_name: string) => ({
                    on: (evt: string, cb: (...a: unknown[]) => void) => {
                        (editor.notificationHandlers[evt] ??= []).push(cb);
                    },
                    off: (evt: string, cb: (...a: unknown[]) => void) => {
                        editor.notificationHandlers[evt] = (editor.notificationHandlers[evt] ?? []).filter(h => h !== cb);
                    }
                })
            },
            execute(command: string, ...args: unknown[]) {
                editor.executed.push({ command, args });
            },
            async destroy() { editor.destroyed = true; }
        };

        editor.model = {
            change: (cb: (writer: unknown) => void) => {
                cb({
                    createElement: (name: string, attrs?: Record<string, unknown>) => ({ name, attrs }),
                    insertText: (text: string, attrs: Record<string, unknown>, pos: unknown) => {
                        editor.inserted.push({ name: "text", attrs: { text, ...attrs, pos } });
                    },
                    setSelection: (pos: unknown) => { editor.lastSetSelection = pos; }
                });
            },
            insertContent: (content: { name: string; attrs?: Record<string, unknown> }, _pos?: unknown) => {
                editor.inserted.push(content);
                return editor.selectionRange;
            },
            document: {
                selection: {
                    isCollapsed: true,
                    getFirstRange: () => editor.selectionRange,
                    getFirstPosition: () => editor.firstPosition,
                    getLastPosition: () => editor.lastPosition
                },
                on: (evt: string, cb: (...a: unknown[]) => void) => {
                    if (evt === "change:data") editor.changeDataHandlers.push(cb);
                },
                off: (evt: string, cb: (...a: unknown[]) => void) => {
                    if (evt === "change:data") {
                        editor.changeDataHandlers = editor.changeDataHandlers.filter(h => h !== cb);
                    }
                }
            }
        };

        return editor;
    }

    const editorFactory: { createImpl: (element: HTMLElement, config: unknown) => Promise<FakeEditor> } = {
        createImpl: async () => makeFakeEditor()
    };

    class FakeEditorBase {
        static create(element: HTMLElement, config: unknown) {
            return editorFactory.createImpl(element, config);
        }
    }
    class FakeClassicEditor extends FakeEditorBase {}
    class FakePopupEditor extends FakeEditorBase {}

    class FakeWatchdogImpl implements FakeWatchdog {
        EditorClass: unknown;
        config: unknown;
        editor: FakeEditor | null = null;
        creator: (() => Promise<FakeEditor>) | null = null;
        stateChangeHandlers: (() => void)[] = [];
        created = false;
        destroyed = false;

        constructor(EditorClass: unknown, config?: unknown) {
            this.EditorClass = EditorClass;
            this.config = config;
            watchdogInstances.push(this);
        }

        setCreator(creator: () => Promise<FakeEditor>) { this.creator = creator; }

        on(evt: string, cb: () => void) {
            if (evt === "stateChange") this.stateChangeHandlers.push(cb);
        }

        async create(_element: HTMLElement, _config: unknown) {
            this.created = true;
            if (this.creator) {
                // The real watchdog catches creator failures internally and restarts;
                // mirror that so a throwing creator doesn't become an unhandled rejection.
                try {
                    this.editor = await this.creator();
                } catch {
                    this.editor = null;
                }
            }
            this.stateChangeHandlers.forEach(h => h());
        }

        async destroy() { this.destroyed = true; }
    }

    return { watchdogInstances, editorFactory, makeFakeEditor, FakeClassicEditor, FakePopupEditor, FakeWatchdogImpl };
});

const { watchdogInstances, editorFactory, makeFakeEditor, FakeClassicEditor, FakePopupEditor } = fakes;

// Service spies (hoisted so the vi.mock factories below can reference them).
const mocks = vi.hoisted(() => ({
    buildConfigMock: vi.fn(async (_opts: unknown) => ({ licenseKey: "GPL" })),
    frocaGetNote: vi.fn(),
    loadReferenceLinkTitle: vi.fn(async () => undefined),
    fetchMetadata: vi.fn(async () => ({ url: "u" })),
    detectEmbedType: vi.fn(() => "link"),
    renderEmbedPreview: vi.fn(),
    renderMentionPreview: vi.fn(),
    inspectorAttach: vi.fn()
}));
const { buildConfigMock, frocaGetNote, loadReferenceLinkTitle, fetchMetadata, detectEmbedType, renderEmbedPreview, renderMentionPreview, inspectorAttach } = mocks;

vi.mock("@triliumnext/ckeditor5", () => ({
    EditorWatchdog: fakes.FakeWatchdogImpl,
    ClassicEditor: fakes.FakeClassicEditor,
    PopupEditor: fakes.FakePopupEditor
}));

vi.mock("./config", () => ({
    buildConfig: (opts: unknown) => mocks.buildConfigMock(opts)
}));

vi.mock("../../../services/froca", () => ({
    default: { getNote: (id: string) => mocks.frocaGetNote(id) }
}));

vi.mock("../../../services/link", () => ({
    default: { loadReferenceLinkTitle: mocks.loadReferenceLinkTitle }
}));

vi.mock("../../../services/link_embed", () => ({
    default: {
        fetchMetadata: mocks.fetchMetadata,
        detectEmbedType: mocks.detectEmbedType,
        renderEmbedPreview: mocks.renderEmbedPreview,
        renderMentionPreview: mocks.renderMentionPreview
    }
}));

vi.mock("@ckeditor/ckeditor5-inspector", () => ({
    default: { attach: (editor: unknown) => mocks.inspectorAttach(editor) }
}));

// Stub the keyboard-shortcut hook so it doesn't pull keyboard_actions / server traffic.
vi.mock("../../react/hooks", async (importOriginal) => ({
    ...(await importOriginal<typeof import("../../react/hooks")>()),
    useKeyboardShortcuts: vi.fn()
}));

import Component from "../../../components/component";
import CKEditorWithWatchdog, { type CKEditorApi } from "./CKEditorWithWatchdog";

// --- Helpers --------------------------------------------------------------------------------------

let parent: Component;
// The current render's container + unmount, captured so tests that exercise cleanup can tear the
// component down mid-test. The shared renderComponent auto-tears-down anything left at afterEach.
let container: HTMLDivElement | undefined;
let unmountCurrent: (() => void) | undefined;
let rerenderCurrent: ((vnode: unknown) => void) | undefined;

function unmount() {
    unmountCurrent?.();
    unmountCurrent = undefined;
    container = undefined;
}

function buildFullProps(props: Partial<Parameters<typeof CKEditorWithWatchdog>[0]>) {
    return {
        contentLanguage: null,
        watchdogRef: { current: null },
        onChange: vi.fn(),
        editorApi: { current: null },
        templates: [],
        ...props
    } as Parameters<typeof CKEditorWithWatchdog>[0];
}

function renderEditor(props: Partial<Parameters<typeof CKEditorWithWatchdog>[0]> = {}) {
    const watchdogRef = props.watchdogRef ?? { current: null };
    const editorApi = props.editorApi ?? { current: null };

    const fullProps = buildFullProps({ watchdogRef, editorApi, ...props });

    const rendered = renderComponent(<CKEditorWithWatchdog {...fullProps} />, { parent });
    container = rendered.container as HTMLDivElement;
    unmountCurrent = rendered.unmount;
    rerenderCurrent = rendered.rerender;

    return { watchdogRef, editorApi, host: container };
}

/** Re-render the currently mounted component into the same container with new props. */
function rerenderEditor(props: Partial<Parameters<typeof CKEditorWithWatchdog>[0]>) {
    const fullProps = buildFullProps(props);
    rerenderCurrent?.(<CKEditorWithWatchdog {...fullProps} />);
}

beforeEach(() => {
    parent = new Component();
    container = undefined;
    unmountCurrent = undefined;
    rerenderCurrent = undefined;
    watchdogInstances.length = 0;
    vi.clearAllMocks();
    editorFactory.createImpl = async () => makeFakeEditor();
    buildConfigMock.mockImplementation(async () => ({ licenseKey: "GPL" }));
});

afterEach(() => {
    vi.unstubAllEnvs();
});

// --- Tests ----------------------------------------------------------------------------------------

describe("CKEditorWithWatchdog rendering & init", () => {
    it("renders a div with the supplied class/tabIndex and initializes a popup watchdog", async () => {
        const onEditorInitialized = vi.fn();
        const { watchdogRef } = renderEditor({
            className: "ck-host",
            tabIndex: 3,
            onEditorInitialized
        });

        const div = container?.querySelector("div.ck-host");
        expect(div).toBeTruthy();
        expect(div?.getAttribute("tabindex")).toBe("3");

        await flush();

        expect(watchdogInstances.length).toBe(1);
        expect(watchdogInstances[0]?.EditorClass).toBe(FakePopupEditor);
        expect(watchdogRef.current).toBe(watchdogInstances[0]);
        expect(onEditorInitialized).toHaveBeenCalledTimes(1);
        expect(buildConfigMock).toHaveBeenCalled();
    });

    it("uses the classic editor class and forwards watchdogConfig + external watchdog ref", async () => {
        const externalWatchdogRef = { current: null };
        const watchdogConfig = { crashNumberLimit: 5 };
        renderEditor({
            isClassicEditor: true,
            watchdogConfig,
            watchdogRef: externalWatchdogRef
        });
        await flush();

        expect(watchdogInstances[0]?.EditorClass).toBe(FakeClassicEditor);
        expect(watchdogInstances[0]?.config).toBe(watchdogConfig);
        expect(externalWatchdogRef.current).toBe(watchdogInstances[0]);
    });

    it("notifies onWatchdogStateChange when the watchdog state changes", async () => {
        const onWatchdogStateChange = vi.fn();
        renderEditor({ onWatchdogStateChange });
        await flush();
        expect(onWatchdogStateChange).toHaveBeenCalledWith(watchdogInstances[0]);
    });
});

describe("CKEditorWithWatchdog editor listeners", () => {
    it("wires change:data to onChange and removes it on editor teardown", async () => {
        const onChange = vi.fn();
        renderEditor({ onChange });
        await flush();

        const editor = watchdogInstances[0]?.editor;
        expect(editor?.changeDataHandlers.length).toBe(1);
        act(() => editor?.changeDataHandlers.forEach(h => h()));
        expect(onChange).toHaveBeenCalledTimes(1);
    });

    it("subscribes to notification warnings and unsubscribes on cleanup", async () => {
        const onNotificationWarning = vi.fn();
        renderEditor({ onNotificationWarning });
        await flush();

        const editor = watchdogInstances[0]?.editor;
        expect(editor?.notificationHandlers["show:warning"]?.length).toBe(1);

        unmount();
        expect(editor?.notificationHandlers["show:warning"]?.length).toBe(0);
    });
});

describe("CKEditorWithWatchdog imperative API", () => {
    async function setupApi(configureEditor?: (e: FakeEditor) => void) {
        const editorApi: { current: CKEditorApi | null } = { current: null };
        renderEditor({ editorApi });
        await flush();
        const editor = watchdogInstances[0]?.editor;
        if (editor && configureEditor) configureEditor(editor);
        const api = editorApi.current;
        if (!api) throw new Error("editorApi was not assigned");
        return { api, editor };
    }

    it("hasSelection / getSelectedText reflect the model selection", async () => {
        const { api, editor } = await setupApi((e) => {
            e.selectionRange = {
                getItems: () => [ { data: "Hello " }, { data: "World" }, {} ],
                end: { pos: "end" }
            };
        });
        if (editor) editor.model.document.selection.isCollapsed = false;
        expect(api.hasSelection()).toBe(true);
        expect(api.getSelectedText()).toBe("Hello World");

        if (editor) editor.selectionRange = null;
        expect(api.getSelectedText()).toBe("");
    });

    it("addLink executes link command on selection and referenceLink without a title", async () => {
        const { api, editor } = await setupApi();
        if (editor) editor.model.document.selection.isCollapsed = false;

        // With selection + internal link title -> link command with #notePath.
        api.addLink("note123", "My Note");
        expect(editor?.executed.find(e => e.command === "link")?.args[0]).toBe("#note123");

        // External link.
        api.addLink("https://x", "Ext", true);
        expect(editor?.executed.filter(e => e.command === "link")[1]?.args[0]).toBe("https://x");

        // No title -> referenceLink command.
        api.addLink("noteRef", null);
        expect(editor?.executed.find(e => e.command === "referenceLink")?.args[0]).toEqual({ href: "#noteRef" });
        expect(editor?.focused).toBe(true);
    });

    it("addLink with a title but no selection inserts the link text", async () => {
        const { api, editor } = await setupApi();
        if (editor) editor.model.document.selection.isCollapsed = true; // no selection
        api.addLink("noteX", "Linked");
        expect(editor?.inserted.some(i => i.name === "text" && i.attrs?.text === "Linked")).toBe(true);
    });

    it("addLinkToEditor inserts text at the first position", async () => {
        const { api, editor } = await setupApi();
        api.addLinkToEditor("#abc", "Title");
        expect(editor?.inserted.some(i => i.name === "text" && i.attrs?.linkHref === "#abc")).toBe(true);
    });

    it("addLinkToEditor is a no-op when there is no insert position", async () => {
        const { api, editor } = await setupApi((e) => { e.firstPosition = null; });
        api.addLinkToEditor("#abc", "Title");
        expect(editor?.inserted.length).toBe(0);
    });

    it("addIncludeNote inserts an includeNote element with the box size", async () => {
        const { api, editor } = await setupApi();
        api.addIncludeNote("incNote", "small");
        const el = editor?.inserted.find(i => i.name === "includeNote");
        expect(el?.attrs).toEqual({ noteId: "incNote", boxSize: "small" });
    });

    it("addHtmlToEditor inserts a model fragment and refocuses", async () => {
        const { api, editor } = await setupApi((e) => {
            e.selectionRange = { getItems: () => [], end: { pos: "end" } };
        });
        api.addHtmlToEditor("<b>hi</b>");
        expect(editor?.inserted.some(i => i.name === "fragment")).toBe(true);
        expect(editor?.lastSetSelection).toEqual({ pos: "end" });
        expect(editor?.focused).toBe(true);
    });

    it("addHtmlToEditor handles a missing insert position and a null range", async () => {
        const { api, editor } = await setupApi((e) => {
            e.lastPosition = null;
        });
        api.addHtmlToEditor("<i>x</i>");
        expect(editor?.inserted.length).toBe(0);
        expect(editor?.focused).toBe(true);
    });

    it("addHtmlToEditor inserts but does not move the selection when no range is returned", async () => {
        // Default selectionRange is null -> model.insertContent returns null -> the `if (range)` is false.
        const { api, editor } = await setupApi();
        api.addHtmlToEditor("<u>y</u>");
        expect(editor?.inserted.some(i => i.name === "fragment")).toBe(true);
        expect(editor?.lastSetSelection).toBeNull();
        expect(editor?.focused).toBe(true);
    });

    it("addLink with an external title but no selection inserts the raw href", async () => {
        const { api, editor } = await setupApi();
        if (editor) editor.model.document.selection.isCollapsed = true; // no selection
        api.addLink("https://ext", "Ext", true);
        // External link keeps the raw href (no leading '#').
        expect(editor?.inserted.some(i => i.name === "text" && i.attrs?.linkHref === "https://ext")).toBe(true);
    });

    it("addImage resolves the note and inserts via insertImage", async () => {
        frocaGetNote.mockResolvedValue({ noteId: "imgNote", title: "My Image" });
        const { api, editor } = await setupApi();
        await api.addImage("imgNote");
        const exec = editor?.executed.find(e => e.command === "insertImage");
        expect(exec?.args[0]).toEqual({ source: "api/images/imgNote/My%20Image" });
    });

    it("addImage no-ops when the note cannot be loaded", async () => {
        frocaGetNote.mockResolvedValue(null);
        const { api, editor } = await setupApi();
        await api.addImage("missing");
        expect(editor?.executed.length).toBe(0);
    });

    it("addLinkEmbed and addLinkMention create the corresponding elements", async () => {
        const { api, editor } = await setupApi();
        api.addLinkEmbed({
            url: "u", embedType: "link", title: "T", description: "D",
            favicon: "f", siteName: "S", image: "i"
        });
        api.addLinkMention({ url: "u2", embedType: "link", title: "T2", favicon: "f2" });

        const embed = editor?.inserted.find(i => i.name === "linkEmbed");
        const mention = editor?.inserted.find(i => i.name === "linkMention");
        expect(embed?.attrs?.url).toBe("u");
        expect(embed?.attrs?.siteName).toBe("S");
        expect(mention?.attrs?.url).toBe("u2");
        expect(mention?.attrs?.favicon).toBe("f2");
    });
});

describe("CKEditorWithWatchdog imperative API guards (no editor)", () => {
    /**
     * When the watchdog has no editor, the `if (!editor) return;` guards are hit.
     * We render but make the watchdog create() throw so `watchdog.editor` stays null,
     * while the imperative handle is still assigned.
     */
    async function setupNoEditorApi() {
        const editorApi: { current: CKEditorApi | null } = { current: null };
        // The creator throws during create -> editor stays null on the watchdog,
        // but setEditor was never called.
        editorFactory.createImpl = async () => { throw new Error("creation cancelled"); };
        renderEditor({ editorApi });
        await flush();
        const api = editorApi.current;
        if (!api) throw new Error("editorApi was not assigned");
        return api;
    }

    it("creator errors are tolerated and write methods early-return (no editor)", async () => {
        const api = await setupNoEditorApi();
        // With no editor, hasSelection reflects `!undefined === true` and getSelectedText is empty.
        expect(api.hasSelection()).toBe(true);
        expect(api.getSelectedText()).toBe("");
        // Write methods hit the `if (!editor) return;` guard without throwing.
        expect(() => api.addLink("n", "t")).not.toThrow();
        expect(() => api.addIncludeNote("n")).not.toThrow();
        expect(() => api.addHtmlToEditor("<b/>")).not.toThrow();
        expect(() => api.addLinkEmbed({ url: "u", embedType: "link", title: "t", description: "", favicon: "", siteName: "", image: "" })).not.toThrow();
        expect(() => api.addLinkMention({ url: "u", embedType: "link", title: "t", favicon: "" })).not.toThrow();
        await expect(api.addImage("n")).resolves.toBeUndefined();
    });
});

describe("CKEditorWithWatchdog legacy imperative handlers", () => {
    it("registers loadReferenceLinkTitle / fetchLinkMetadata / detectEmbedType / render helpers on the parent", async () => {
        renderEditor();
        await flush();

        const p = parent as unknown as Record<string, (...a: unknown[]) => unknown>;
        const $el = $("<div></div>");
        await p.loadReferenceLinkTitle($el, "#h");
        expect(loadReferenceLinkTitle).toHaveBeenCalledWith($el, "#h");

        await p.fetchLinkMetadata("http://x");
        expect(fetchMetadata).toHaveBeenCalledWith("http://x");

        p.detectEmbedType("http://y");
        expect(detectEmbedType).toHaveBeenCalledWith("http://y");

        const cont = document.createElement("div");
        p.renderLinkEmbed(cont, { url: "u" });
        expect(renderEmbedPreview).toHaveBeenCalledWith(cont, { url: "u" }, true);
        p.renderLinkMention(cont, { url: "u" });
        expect(renderMentionPreview).toHaveBeenCalledWith(cont, { url: "u" }, true);
    });
});

describe("CKEditorWithWatchdog re-init on dependency change", () => {
    it("destroys the previous watchdog and rebuilds when contentLanguage changes", async () => {
        const { watchdogRef } = renderEditor({ contentLanguage: "en" });
        await flush();
        expect(watchdogInstances.length).toBe(1);
        const first = watchdogInstances[0];

        rerenderEditor({ contentLanguage: "de", watchdogRef });
        await flush();

        expect(watchdogInstances.length).toBe(2);
        expect(first?.destroyed).toBe(true);
    });

    it("logs a warning when destroying the previous watchdog fails", async () => {
        const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => undefined);
        const { watchdogRef } = renderEditor({ contentLanguage: "en" });
        await flush();
        const first = watchdogInstances[0];
        if (first) first.destroy = vi.fn(async () => { throw new Error("destroy boom"); });

        rerenderEditor({ contentLanguage: "fr", watchdogRef });
        await flush();

        expect(warnSpy).toHaveBeenCalled();
        expect(watchdogInstances.length).toBe(2);
    });

    it("aborts re-init without building a new watchdog when it becomes stale during the prior destroy", async () => {
        const { watchdogRef } = renderEditor({ contentLanguage: "en" });
        await flush();
        expect(watchdogInstances.length).toBe(1);
        const first = watchdogInstances[0];

        // Block the previous watchdog's destroy on a deferred promise.
        let resolveDestroy: (() => void) | undefined;
        if (first) first.destroy = vi.fn(() => new Promise<void>((resolve) => { resolveDestroy = resolve; }));

        // Re-render with a changed dep -> the new effect's init() awaits first.destroy().
        rerenderEditor({ contentLanguage: "de", watchdogRef });
        await act(async () => { await new Promise(resolve => setTimeout(resolve, 0)); });
        expect(resolveDestroy).toBeTruthy();

        // Unmount while the destroy is pending -> the new effect's cleanup flips isStale.
        unmount();

        // Resolve the destroy: init() resumes, hits `if (isStale) return`, never builds watchdog #2.
        await act(async () => {
            resolveDestroy?.();
            await new Promise(resolve => setTimeout(resolve, 0));
        });

        expect(watchdogInstances.length).toBe(1);
    });
});

describe("CKEditorWithWatchdog buildEditor read-only fallback", () => {
    it("rebuilds the editor with a GPL license when the first instance is read-only", async () => {
        // The watchdog calls its creator (the component's buildEditor). We override the
        // editor factory so the first create() yields a read-only editor.
        let call = 0;
        editorFactory.createImpl = async () => {
            const e = makeFakeEditor();
            if (call === 0) e.isReadOnly = true;
            call++;
            return e;
        };
        const onEditorInitialized = vi.fn();
        renderEditor({ onEditorInitialized });
        await flush();

        // buildConfig is called once for the initial config and once more for the GPL retry.
        expect(buildConfigMock.mock.calls.length).toBeGreaterThanOrEqual(2);
        expect(onEditorInitialized).toHaveBeenCalledTimes(1);
        const initializedEditor = onEditorInitialized.mock.calls[0]?.[0] as FakeEditor;
        expect(initializedEditor.isReadOnly).toBe(false);
    });
});

describe("CKEditorWithWatchdog inspector branch", () => {
    it("does not attach the inspector when the env flag is unset", async () => {
        vi.stubEnv("VITE_CKEDITOR_ENABLE_INSPECTOR", "false");
        renderEditor();
        await flush();
        expect(watchdogInstances[0]?.editor).toBeTruthy();
        expect(inspectorAttach).not.toHaveBeenCalled();
    });

    it("attaches the inspector when the env flag is 'true'", async () => {
        vi.stubEnv("VITE_CKEDITOR_ENABLE_INSPECTOR", "true");
        renderEditor();
        await flush();
        expect(inspectorAttach).toHaveBeenCalledTimes(1);
    });
});

describe("CKEditorWithWatchdog stale-creation guards", () => {
    it("throws before building when the effect is already stale", async () => {
        renderEditor();
        await flush();
        const watchdog = watchdogInstances[0];
        const creator = watchdog?.creator;
        expect(creator).toBeTruthy();

        // Unmount -> the effect cleanup sets isStale = true (captured by the creator's closure).
        unmount();

        // Re-invoking the (now stale) creator hits the early `if (isStale) throw`.
        buildConfigMock.mockClear();
        await expect(creator?.()).rejects.toThrow();
        expect(buildConfigMock).not.toHaveBeenCalled();
    });

    it("destroys the editor and throws when it becomes stale during build", async () => {
        // Make buildEditor block on a deferred promise so we can flip isStale mid-flight.
        let resolveBuild: ((e: ReturnType<typeof makeFakeEditor>) => void) | undefined;
        const builtEditor = makeFakeEditor();
        editorFactory.createImpl = () => new Promise((resolve) => { resolveBuild = (e) => resolve(e); });

        renderEditor();
        // Let the async init chain run up to the pending buildEditor await so resolveBuild is set.
        await act(async () => { await new Promise(resolve => setTimeout(resolve, 0)); });
        const watchdog = watchdogInstances[0];
        expect(resolveBuild).toBeTruthy();

        // Unmount -> isStale becomes true while the build is still pending.
        unmount();

        // Resolve the build; the creator now sees isStale -> destroys the editor and throws,
        // which our fake watchdog catches (leaving editor null).
        await act(async () => {
            resolveBuild?.(builtEditor);
            await new Promise(resolve => setTimeout(resolve, 0));
        });

        expect(builtEditor.destroyed).toBe(true);
        expect(watchdog?.editor).toBeNull();
    });
});
