import type { CKTextEditor } from "@triliumnext/ckeditor5";
import { render } from "preact";
import { act } from "preact/test-utils";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import type NoteContext from "../../../components/note_context";
import type FNote from "../../../entities/fnote";

const mocks = vi.hoisted(() => ({
    stored: {} as Record<string, string | boolean>,
    noteContext: null as unknown as ReturnType<typeof createNoteContext>,
    isMobile: false,
    tabManager: {
        noteContexts: [] as { ntxId: string; getMainContext(): { pinned: boolean } }[],
        getActiveContext: vi.fn(),
        removeNoteContext: vi.fn()
    },
    copyHtml: vi.fn(),
    copyText: vi.fn(),
    readClipboardText: vi.fn(),
    showPersistent: vi.fn(),
    save: vi.fn(),
    closeShortcutHints: vi.fn(() => true),
    shortcutHints: undefined as (() => unknown[]) | undefined
}));

vi.mock("../../../components/app_context", () => ({ default: { tabManager: mocks.tabManager } }));
vi.mock("../../../services/clipboard_ext", () => ({
    copyHtml: mocks.copyHtml,
    copyText: mocks.copyText,
    readClipboardText: mocks.readClipboardText
}));
vi.mock("../../../services/i18n", () => ({ t: (key: string) => key }));
vi.mock("../../../services/options", () => ({
    default: {
        get: (name: string) => mocks.stored[name],
        is: (name: string) => mocks.stored[name] === true,
        toggle: (name: string) => {
            mocks.stored[name] = mocks.stored[name] !== true;
            return Promise.resolve();
        },
        save: mocks.save
    }
}));
vi.mock("../../../services/toast", () => ({ default: { showPersistent: mocks.showPersistent } }));
vi.mock("../../../services/utils", () => ({ isMobile: () => mocks.isMobile }));
vi.mock("../../react/hooks", () => ({
    useContextualShortcutHints: (hints: () => unknown[]) => {
        mocks.shortcutHints = hints;
    },
    useNoteLabel: vi.fn(),
    useTriliumOption: (name: string) => [ mocks.stored[name] ?? "" ],
    useTriliumOptionBool: (name: string) => [ mocks.stored[name] === true ]
}));
vi.mock("../../shortcut_hints/shortcut_hints_panel", () => ({
    closeShortcutHints: mocks.closeShortcutHints
}));
vi.mock("./vim_key_reference", () => ({
    getVimHintSection: (vim: unknown) => ({ hints: [], vim })
}));
vi.mock("./editable_embed", () => ({
    findTextEditorAround: (element: HTMLElement | null) =>
        (element?.closest(".ck-editor__editable") as { ckeditorInstance?: unknown } | null)
            ?.ckeditorInstance
}));

import {
    buildVimConfig, isVimModeWanted, setCommandLineSlot, showVimModeNotice, useVimMode
} from "./vim_mode";

type FakeEditor = ReturnType<typeof createEditor>["editor"];

let container: HTMLElement;

beforeEach(() => {
    mocks.stored = { textNoteVimModeEnabled: true };
    mocks.noteContext = createNoteContext("a");
    mocks.isMobile = false;
    mocks.tabManager.noteContexts = [];
    container = document.body.appendChild(document.createElement("div"));
});

afterEach(() => {
    act(() => render(null, container));
    setCommandLineSlot(null);
    document.body.innerHTML = "";
    vi.resetAllMocks();
});

describe("useVimMode", () => {
    it("starts in Normal mode, in Insert mode when the option turns it on, and stops", () => {
        const { editor, vim } = createEditor();
        show(editor, createNote("a"));
        expect(vim.setEnabled).toHaveBeenLastCalledWith(true, "normal");

        mocks.stored.textNoteVimModeEnabled = false;
        show(editor, createNote("a"));
        expect(vim.setEnabled).toHaveBeenLastCalledWith(false, "normal");

        mocks.stored.textNoteVimModeEnabled = true;
        show(editor, createNote("a"));
        expect(vim.setEnabled).toHaveBeenLastCalledWith(true, "insert");

        const rebuilt = createEditor();
        show(rebuilt.editor, createNote("a"));
        expect(rebuilt.vim.setEnabled).toHaveBeenLastCalledWith(true, "normal");
    });

    it("starts again in Normal mode for another note in the same editor, as its label says", () => {
        const { editor, vim } = createEditor();
        show(editor, createNote("a"));
        vim.setEnabled.mockClear();

        show(editor, createNote("b"));
        expect(vim.setEnabled.mock.calls).toEqual([ [ false ], [ true, "normal" ] ]);

        show(editor, createNote("c", "false"));
        expect(vim.setEnabled).toHaveBeenLastCalledWith(false, "normal");
    });

    it("runs the startup commands again when they change", () => {
        const { editor, vim } = createEditor();
        mocks.stored.textNoteVimStartupCommands = "imap jk <Esc>";
        show(editor, createNote("a"));
        expect(vim.refreshStartupCommands).toHaveBeenCalledTimes(1);

        show(editor, createNote("a"));
        mocks.stored.textNoteVimStartupCommands = "imap jj <Esc>";
        show(editor, createNote("a"));
        expect(vim.refreshStartupCommands).toHaveBeenCalledTimes(2);
    });

    it("offers the full key list of its Vim mode to the Shortcut Hints panel", () => {
        const { editor, vim } = createEditor();
        show(editor, createNote("a"));
        expect(mocks.shortcutHints?.()).toEqual([]);
        vim.isActive = true;
        expect(mocks.shortcutHints?.()).toEqual([ { hints: [], vim } ]);
    });

    it("shows the key hints again when their options change", () => {
        const { editor, vim } = createEditor();
        show(editor, createNote("a"));
        expect(vim.refreshHints).toHaveBeenCalledTimes(1);

        show(editor, createNote("a"));
        mocks.stored.vimModeHintStripShown = true;
        show(editor, createNote("a"));
        mocks.stored.vimModeHintsEnabled = true;
        show(editor, createNote("a"));
        expect(vim.refreshHints).toHaveBeenCalledTimes(3);
    });

    it("publishes the Vim mode for its note, again after a note switch, and clears its own", () => {
        const { editor, vim } = createEditor();
        mocks.noteContext.noteId = "b";
        show(editor, createNote("a"));
        expect(published()).toBeUndefined();
        show(editor, createNote("b"));
        expect(published()).toBe(vim);

        mocks.noteContext.data.clear();
        mocks.noteContext.noteId = "c";
        show(editor, createNote("c"));
        expect(published()).toBe(vim);

        const other = {};
        mocks.noteContext.data.set("vimMode", other);
        act(() => render(null, container));
        expect(published()).toBe(other);
        show(editor, createNote("c"));
        expect(published()).toBe(vim);
        act(() => render(null, container));
        expect(published()).toBeUndefined();
    });

    it("publishes the Vim mode of the editor, or of a focused embed until its editor goes", () => {
        const main = createEditor();
        const nested = createEditor();
        main.root.append(nested.root);
        show(main.editor, createNote("a"));
        expect(published()).toBe(main.vim);

        focusIn(nested.root);
        expect(published()).toBe(nested.vim);
        focusIn(main.root);
        expect(published()).toBe(main.vim);

        focusIn(nested.root);
        act(() => nested.fire("destroy"));
        expect(published()).toBe(main.vim);

        const withoutVim = createEditor({ hasVim: false });
        main.root.append(withoutVim.root);
        focusIn(nested.root);
        focusIn(withoutVim.root);
        expect(published()).toBe(nested.vim);
    });

    it("does nothing without an editor with Vim mode", () => {
        show(undefined, createNote("a"));
        expect(published()).toBeUndefined();

        const { editor } = createEditor({ hasVim: false });
        show(editor, createNote("a"));
        expect(published()).toBeUndefined();
    });
});

describe("isVimModeWanted", () => {
    it("follows the label over the option, and is never on in the mobile layout", () => {
        expect([ isVimModeWanted(null, true), isVimModeWanted(undefined, false) ])
            .toEqual([ true, false ]);
        expect([ isVimModeWanted("", false), isVimModeWanted("true", false) ])
            .toEqual([ true, true ]);
        expect(isVimModeWanted("false", true)).toBe(false);

        mocks.isMobile = true;
        expect(isVimModeWanted("true", true)).toBe(false);
    });
});

describe("buildVimConfig", () => {
    it("saves, follows links and reads the options through the app", async () => {
        const triggerHostCommand = vi.fn();
        const { host, getStartupCommands, isInsertKeysEnabled } = buildVimConfig({
            getContainer: () => null, triggerHostCommand
        });
        host?.save?.();
        host?.followLink?.();
        expect(triggerHostCommand.mock.calls).toEqual([
            [ "saveNoteDetailNow" ], [ "followLinkUnderCursor" ]
        ]);

        mocks.stored.textNoteVimStartupCommands = "nmap Y y$";
        mocks.stored.textNoteVimInsertKeysEnabled = true;
        expect([ getStartupCommands?.(), isInsertKeysEnabled?.() ]).toEqual([ "nmap Y y$", true ]);
        delete mocks.stored.textNoteVimStartupCommands;
        expect(getStartupCommands?.()).toBe("");

        const { areHintsEnabled, isHintStripShown } = buildVimConfig({
            getContainer: () => null, triggerHostCommand
        });
        mocks.stored.vimModeHintsEnabled = true;
        expect([ areHintsEnabled?.(), isHintStripShown?.() ]).toEqual([ true, false ]);
        host?.toggleHintStrip?.();
        expect(isHintStripShown?.()).toBe(true);
        host?.setHintsEnabled?.(false);
        expect(mocks.save).toHaveBeenCalledWith("vimModeHintsEnabled", "false");
        expect(host?.closeKeyReference?.()).toBe(true);

        mocks.readClipboardText.mockResolvedValue("pasted");
        await expect(host?.readClipboard?.()).resolves.toBe("pasted");
        host?.writeClipboard?.("text", "<b>text</b>");
        host?.writeClipboard?.("text", null);
        expect(mocks.copyHtml).toHaveBeenCalledWith("<b>text</b>", "text");
        expect(mocks.copyText).toHaveBeenCalledWith("text");
    });

    it("closes the split that shows the editor after a save, unless it is pinned", () => {
        const split = document.body.appendChild(document.createElement("div"));
        split.setAttribute("data-ntx-id", "split1");
        const editorContainer = split.appendChild(document.createElement("div"));
        const mainContext = { pinned: false };
        mocks.tabManager.noteContexts = [ { ntxId: "split1", getMainContext: () => mainContext } ];
        const triggerHostCommand = vi.fn();
        const { host } = buildVimConfig({
            getContainer: () => editorContainer, triggerHostCommand
        });

        expect(host?.closeTab?.()).toBe(true);
        expect(triggerHostCommand).toHaveBeenCalledWith("saveNoteDetailNow");
        expect(mocks.tabManager.removeNoteContext).toHaveBeenCalledWith("split1");

        mainContext.pinned = true;
        expect(host?.closeTab?.()).toBe(false);
        const outside = buildVimConfig({
            getContainer: () => document.createElement("div"), triggerHostCommand
        });
        expect(outside.host?.closeTab?.()).toBe(false);
        expect(mocks.tabManager.removeNoteContext).toHaveBeenCalledTimes(1);
    });

    it("shows the command line in the status bar only while the bar shows that editor", () => {
        const { editor, vim } = createEditor();
        const { host } = buildVimConfig({ getContainer: () => null, triggerHostCommand: vi.fn() });
        const mount = (element: HTMLElement) =>
            host?.mountCommandLine?.(element, editor as unknown as CKTextEditor);
        const commandLine = document.createElement("div");
        expect(mount(commandLine)).toBe(false);

        const slot = document.body.appendChild(document.createElement("div"));
        const rects = vi.spyOn(slot, "getClientRects")
            .mockReturnValue([ new DOMRect() ] as unknown as DOMRectList);
        setCommandLineSlot(slot);
        mocks.tabManager.getActiveContext.mockReturnValue({ getContextData: () => ({}) });
        expect(mount(commandLine)).toBe(false);

        mocks.tabManager.getActiveContext.mockReturnValue({ getContextData: () => vim });
        rects.mockReturnValue([] as unknown as DOMRectList);
        expect(mount(commandLine)).toBe(false);
        rects.mockReturnValue([ new DOMRect() ] as unknown as DOMRectList);
        expect(mount(commandLine)).toBe(true);
        expect(commandLine.parentElement).toBe(slot);
    });
});

describe("showVimModeNotice", () => {
    it("explains Vim mode in a notice that stays until it is closed", () => {
        showVimModeNotice();
        expect(mocks.showPersistent).toHaveBeenCalledWith({
            id: "vim-mode-notice",
            icon: "bx bx-info-circle",
            title: "vim_mode.notice_title",
            message: "vim_mode.notice"
        });
    });
});

function Harness({ editor, note }: { editor: FakeEditor | undefined; note: FNote }) {
    const noteContext = mocks.noteContext as unknown as NoteContext;
    useVimMode(editor as unknown as CKTextEditor, note, noteContext);
    return null;
}

function published() {
    return mocks.noteContext.data.get("vimMode");
}

function createNoteContext(noteId: string) {
    const data = new Map<string, unknown>();
    return {
        noteId,
        data,
        setContextData: (key: string, value: unknown) => data.set(key, value),
        getContextData: (key: string) => data.get(key),
        clearContextData: (key: string) => data.delete(key)
    };
}

function show(editor: FakeEditor | undefined, note: FNote) {
    act(() => render(<Harness editor={editor} note={note} />, container));
}

function focusIn(element: HTMLElement) {
    act(() => {
        element.dispatchEvent(new FocusEvent("focusin", { bubbles: true }));
    });
}

function createNote(noteId: string, vimMode?: string) {
    return { noteId, getLabelValue: () => vimMode ?? null } as unknown as FNote;
}

function createEditor({ hasVim = true } = {}) {
    const root = document.createElement("div");
    root.className = "ck-editor__editable";
    const vim = {
        setEnabled: vi.fn(), refreshStartupCommands: vi.fn(), refreshHints: vi.fn(),
        isActive: false
    };
    const listeners = new Map<string, () => void>();
    const editor = {
        plugins: { has: () => hasVim, get: () => vim },
        editing: { view: { getDomRoot: () => root } },
        on: (event: string, callback: () => void) => listeners.set(event, callback),
        off: (event: string) => listeners.delete(event)
    };
    Object.assign(root, { ckeditorInstance: editor });
    return { editor, vim, root, fire: (event: string) => listeners.get(event)?.() };
}
