import "../../theme/vim.css";

import type { Vim, vimState } from "@replit/codemirror-vim-core";
import {
    type Editor, env, keyCodes, type ModelElement, Plugin, type ViewDocumentKeyDownEvent
} from "ckeditor5";

import ContentEmbedCaret from "../content_embed/content_embed_caret.js";
import {
    getCaption, getContentEmbedAt, getContentEmbedDom, isContentEmbed
} from "../content_embed/content_embed.js";
import TriliumMentionUI from "../mention/trilium_mention_ui.js";
import { isFromEditable } from "../move_block_updown.js";
import VimAdapter, {
    type CloseDialog, type DialogOptions, VimPosition, type WidgetEntry
} from "./vim_adapter.js";
import { getDigraph } from "./vim_digraphs.js";
import { getLoadedVimEngine, loadVimEngine, runStartupCommands } from "./vim_engine.js";
import { createJumpList } from "./vim_jumps.js";
import { OBJECT_CHARACTER, toCharacterEdge } from "./vim_lines.js";
import { SEARCH_MARKER } from "./vim_search.js";
import VimUndo from "./vim_undo.js";

/** The modes of Vim, as the status line names them. */
export type VimMode = "normal" | "insert" | "replace" | "visual" | "visual-line";

/** A message of Vim, such as "Pattern not found" or the list of `:registers`. */
export interface VimMessage {
    text: string;
    /** Whether the message is a list that stays until the next key, rather than a short note. */
    isLong: boolean;
}

/** The command line of `:`, `/` and `?`, which the host shows in place of the breadcrumb. */
export interface VimCommandLine {
    readonly element: HTMLElement;
    focus(): void;
}

/** What the status line shows of the Vim mode of an editor. */
export interface VimStatus {
    /** The mode, or `null` while Vim mode is off. */
    mode: VimMode | null;
    /** Whether `Ctrl+O` in Insert mode runs one command before Insert mode comes back. */
    isOneCommand: boolean;
    /** The keys of the command being typed, such as `"a3d`. */
    pendingKeys: string;
    /** The register a macro is being recorded into, or `null`. */
    recording: string | null;
    message: VimMessage | null;
    /** The command line while it is open. */
    commandLine: VimCommandLine | null;
}

/** What the app does for the Vim mode of an editor. */
export interface VimHost {
    /**
     * Shows `element`, the command line, in the status bar. Returns `false` when the status bar
     * does not show this editor; the command line then opens under the editor.
     */
    mountCommandLine?(element: HTMLElement, editor: Editor): boolean;
    /** Saves the note now, for `:w`. */
    save?(): void;
    /**
     * Closes the tab of the note after the pending save, for `:q`. Returns `false` when it cannot.
     */
    closeTab?(): boolean;
    /** Follows the link at the cursor, for `gf`. */
    followLink?(): void;
    /** The text of the system clipboard, for `"+p`. */
    readClipboard?(): Promise<string>;
    /** Puts `text` on the system clipboard, with `html` as its formatted form, for `"+y`. */
    writeClipboard?(text: string, html: string | null): void;
}

/** The configuration of the Vim mode, `config.vim`. */
export interface VimConfig {
    /** Whether the editor starts with Vim mode on, in Normal mode. */
    enabled?: boolean;
    host?: VimHost;
    /** The Ex commands run when Vim mode starts, one per line, such as mappings. */
    getStartupCommands?(): string;
    /**
     * Whether `Ctrl+U`, `Ctrl+E`, `Ctrl+Y`, `Ctrl+K`, `Ctrl+V` and `Ctrl+A` follow Vim in Insert
     * mode.
     */
    isInsertKeysEnabled?(): boolean;
}

/** The status of an editor with Vim mode off. */
const OFF_STATUS: VimStatus = {
    mode: null, isOneCommand: false, pendingKeys: "", recording: null, message: null,
    commandLine: null
};

/** The marker of the block cursor on a character, and the one on an empty line. */
const CURSOR_MARKER = "vimCursor";
const EMPTY_CURSOR_MARKER = "vimCursorEmpty";

/** The Ctrl keys that follow Vim in Insert mode: five for safety and two as in code notes. */
const INSERT_KEYS = new Set([ "<C-w>", "<C-r>", "<C-o>", "<C-t>", "<C-d>" ]);
/** The Ctrl keys of Vim's completion, which do nothing in Insert mode. */
const SWALLOWED_INSERT_KEYS = new Set([ "<C-p>", "<C-n>" ]);
/** The Ctrl keys that follow Vim in Insert mode when the insert keys are turned on. */
const OPTIONAL_INSERT_KEYS = new Set([ "<C-u>", "<C-e>", "<C-y>", "<C-k>", "<C-v>", "<C-a>" ]);
/** The keys that move down or up a line, which leave the editor of an embed at its edges. */
const DOWN_KEYS = new Set([ "j", "<Down>", "<C-n>", "+", "<CR>" ]);
const UP_KEYS = new Set([ "k", "<Up>", "<C-p>", "-" ]);

/**
 * Vim mode for text notes: modal editing with the motions, operators and commands of Vim, on the
 * engine that code notes use. With the option off, the plugin does nothing.
 */
export default class TriliumVim extends Plugin {

    /** @observable */
    declare status: VimStatus;

    private session: VimSession | null = null;
    private isWanted = false;

    static get pluginName() {
        return "TriliumVim" as const;
    }

    init() {
        this.set("status", OFF_STATUS);
        const conversion = this.editor.conversion;
        conversion.for("editingDowncast").markerToHighlight({
            model: CURSOR_MARKER,
            view: { classes: "ck-vim-cursor" }
        });
        conversion.for("editingDowncast").markerToElement({
            model: EMPTY_CURSOR_MARKER,
            view: (_data, { writer }) => writer.createUIElement("span", {
                class: "ck-vim-cursor ck-vim-cursor_empty"
            })
        });
        conversion.for("editingDowncast").markerToHighlight({
            model: SEARCH_MARKER,
            view: { classes: [ "ck-find-result", "ck-vim-search-result" ] }
        });

        if (this.editor.config.get("vim")?.enabled) {
            return this.setEnabled(true);
        }
        return undefined;
    }

    /** Whether Vim mode is on. */
    get isActive() {
        return !!this.session;
    }

    /**
     * Turns Vim mode on or off in place: the content, the cursor and the undo history stay. Vim
     * mode starts in `mode`.
     */
    async setEnabled(isEnabled: boolean, mode: "normal" | "insert" = "normal"): Promise<void> {
        this.isWanted = isEnabled;
        if (!isEnabled) {
            this.session?.destroy();
            this.session = null;
            this.status = OFF_STATUS;
            return;
        }
        if (this.session) {
            return;
        }
        const engine = getLoadedVimEngine() ?? await loadVimEngine();
        const start = () => {
            if (this.isWanted && !this.session && this.editor.state === "ready") {
                this.session = new VimSession(this, engine, mode);
            }
        };
        if (this.editor.state === "initializing") {
            this.editor.once("ready", start);
        } else {
            start();
        }
    }

    /** Runs the startup commands again, after they changed. */
    refreshStartupCommands() {
        this.session?.runStartupCommands();
    }

    /** Puts the editor in Insert mode at its caret, as `i` does. */
    enterInsertMode() {
        this.session?.enterInsertMode();
    }

    /**
     * Selects the embed that `nestedRoot`, the root of the editor in it, is in, and focuses this
     * editor.
     */
    selectEmbedOf(nestedRoot: HTMLElement): boolean {
        const embed = getContentEmbedAt(this.editor, nestedRoot);
        if (!embed) {
            return false;
        }
        this.editor.editing.view.focus();
        this.editor.model.change((writer) => writer.setSelection(embed, "on"));
        this.editor.editing.view.scrollToTheSelection();
        return true;
    }

    override destroy() {
        this.session?.destroy();
        this.session = null;
        this.status = OFF_STATUS;
        super.destroy();
    }
}

/** The Vim mode of an editor while it is on. */
class VimSession {

    readonly adapter: VimAdapter;
    private readonly editor: Editor;
    private readonly undo: VimUndo;
    private readonly root: HTMLElement;
    private pendingKeys = "";
    private isCommandDone = false;
    private isInsertStepOpen = false;
    private messageTimer: ReturnType<typeof setTimeout> | null = null;
    private commandLine: VimCommandLine | null = null;
    private closeCommandLine: (() => void) | null = null;
    /** The first key of a digraph that `Ctrl+K` waits for, or `""` while it waits for the first. */
    private digraph: string | null = null;
    private isLiteralNext = false;
    /** The characters that Replace mode wrote over, which Backspace puts back. */
    private replaced: { line: number; ch: number; original: string }[] = [];
    private readonly stopListening: (() => void)[] = [];
    private readonly jumpList = createJumpList();

    constructor(
        private readonly plugin: TriliumVim, private readonly engine: Vim, mode: "normal" | "insert"
    ) {
        const editor = plugin.editor;
        this.editor = editor;
        this.root = editor.editing.view.getDomRoot() as HTMLElement;
        this.undo = new VimUndo(editor);
        this.adapter = new VimAdapter(editor, {
            openDialog: (template, onEnter, options) => this.openDialog(template, onEnter, options),
            openNotification: (template, duration) =>
                this.showMessage(getMessageText(template), duration),
            notify: (message) => this.showMessage(message, 5000),
            undo: () => this.undo.undo(),
            redo: () => this.undo.redo(),
            onOperationEnd: () => this.onOperationEnd(),
            save: () => this.getHost()?.save?.(),
            closeTab: () => this.closeTab(),
            followLink: () => this.getHost()?.followLink?.(),
            readClipboard: () => this.readClipboard(),
            writeClipboard: (text, html) => this.writeClipboard(text, html),
            enterWidget: (widget, isAtEnd) => this.enterWidget(widget, isAtEnd)
        });

        engine.enterVimMode(this.adapter as never);
        this.adapter.on("vim-mode-change",
            (event: { mode: string; subMode?: string }) => this.onModeChange(event));
        this.adapter.on("vim-command-done", () => {
            this.isCommandDone = true;
        });
        this.runStartupCommands();
        this.listen();
        if (mode === "insert") {
            this.enterInsertMode();
        }
        this.updateStatus();
        this.updateCursor();
    }

    /** The state of the engine, which is there while the session lasts. */
    private get vim(): vimState {
        return this.adapter.state.vim as vimState;
    }

    /** Runs the startup commands of the configuration, when they changed since they last ran. */
    runStartupCommands() {
        const commands = this.editor.config.get("vim")?.getStartupCommands?.() ?? "";
        runStartupCommands(this.engine, this.adapter, commands);
    }

    enterInsertMode() {
        const vim = this.vim;
        if (!vim.insertMode) {
            if (vim.visualMode) {
                this.engine.exitVisualMode(this.adapter as never, false);
            }
            this.runKeys([ "i" ]);
        }
    }

    destroy() {
        for (const stop of this.stopListening) {
            stop();
        }
        if (this.vim.insertMode) {
            this.engine.exitInsertMode(this.adapter as never, true);
        } else if (this.vim.visualMode) {
            this.engine.exitVisualMode(this.adapter as never, false);
        }
        this.closeCommandLine?.();
        this.engine.leaveVimMode(this.adapter as never);
        this.adapter.endReveal();
        this.adapter.destroy();
        this.undo.destroy();
        this.clearMessageTimer();
        this.setCommandModeClass(false);
        this.editor.model.enqueueChange((writer) => {
            for (const name of [ CURSOR_MARKER, EMPTY_CURSOR_MARKER ]) {
                if (this.editor.model.markers.has(name)) {
                    writer.removeMarker(name);
                }
            }
        });
    }

    private listen() {
        const editor = this.editor;
        const viewDocument = editor.editing.view.document;
        const onKeyDown = (event: KeyboardEvent) => this.onKeyDown(event);
        document.addEventListener("keydown", onKeyDown, { capture: true });
        this.stopListening.push(
            () => document.removeEventListener("keydown", onKeyDown, { capture: true }));

        // Escape belongs to the open balloon or list first, and comes before `Widget`, which
        // selects the widget around a caption or a cell.
        const onEscape = (evt: { stop(): void }, data: ViewDocumentKeyDownEvent["args"][0]) => {
            const isPlainEscape = data.keyCode === keyCodes.esc && !data.ctrlKey && !data.altKey
                && !data.metaKey && !data.shiftKey;
            if (isPlainEscape && this.escape()) {
                data.preventDefault();
                evt.stop();
            }
        };
        viewDocument.on<ViewDocumentKeyDownEvent>("keydown", onEscape, { context: "$capture" });
        this.stopListening.push(() => viewDocument.off("keydown", onEscape));

        // Text from an input method or a dead key is a key of a command outside Insert mode.
        const onInsertText = (
            evt: { stop(): void }, data: { text?: string; preventDefault(): void }
        ) => {
            if (this.vim.insertMode) {
                return;
            }
            data.preventDefault();
            evt.stop();
            if (data.text && [ ...data.text ].length === 1) {
                this.runKeys([ data.text ]);
            }
        };
        viewDocument.on("insertText", onInsertText as never, { priority: "highest" });
        this.stopListening.push(() => viewDocument.off("insertText", onInsertText as never));

        // `Ctrl+C` copies a Visual selection, then leaves Visual mode.
        const onCopy = () => {
            if (this.vim.visualMode) {
                void Promise.resolve().then(() => this.runKeys([ "<Esc>" ]));
            }
        };
        this.root.addEventListener("copy", onCopy);
        this.stopListening.push(() => this.root.removeEventListener("copy", onCopy));
    }

    private onKeyDown(event: KeyboardEvent) {
        const vim = this.vim;
        if (event.defaultPrevented || !isFromEditable(this.editor, event)
            || event.isComposing || [ "Process", "Unidentified", "Dead" ].includes(event.key)) {
            return;
        }
        if (vim.insertMode && this.typeInsertSequence(event)) {
            return;
        }
        const key = this.engine.vimKeyFromEvent(event, vim);
        if (!key) {
            return;
        }
        if (vim.insertMode) {
            this.onInsertKey(event, key, vim);
        } else {
            this.onCommandKey(event, key, vim);
        }
    }

    /** Routes a key of Normal or Visual mode: the keys of Vim, and no typing. */
    private onCommandKey(event: KeyboardEvent, key: string, vim: vimState) {
        if (key === "<Esc>" || event.altKey || /^F\d+$/.test(event.key)) {
            return;
        }
        if (event.metaKey) {
            const undoKeys = env.isMac && !event.ctrlKey && event.key.toLowerCase() === "z"
                ? this.getUndoKeys(event.shiftKey ? "<C-r>" : "u", vim)
                : null;
            if (undoKeys) {
                consume(event);
                this.runKeys(undoKeys);
            }
            return;
        }
        const hasSelection = !this.editor.model.document.selection.isCollapsed;
        if (key === "<C-c>" && hasSelection) {
            return;
        }
        if (key === "<C-[>" || key === "<C-c>") {
            consume(event);
            this.escape();
            return;
        }
        if (key === "<C-v>" || key === "<C-q>") {
            return;
        }
        if (this.leaveEmbedAtEdge(key, vim)) {
            consume(event);
            return;
        }
        let keys = [ key ];
        if (key === "<C-z>") {
            keys = this.getUndoKeys("u", vim);
        } else if (key === "<C-S-Z>" || key === "<C-S-z>") {
            keys = this.getUndoKeys("<C-r>", vim);
        }
        if (this.runKeys(keys) || isTypingKey(event)) {
            consume(event);
        }
    }

    /** The keys of an undo or a redo, after leaving Visual mode. */
    private getUndoKeys(key: string, vim: vimState): string[] {
        return vim.visualMode ? [ "<Esc>", key ] : [ key ];
    }

    /** Routes a key of Insert mode, which is the editor of today but for a few keys. */
    private onInsertKey(event: KeyboardEvent, key: string, vim: vimState) {
        if (key === "<Esc>") {
            return;
        }
        const isCollapsed = this.editor.model.document.selection.isCollapsed;
        if (key === "<C-[>" || (key === "<C-c>" && isCollapsed)) {
            consume(event);
            this.escape();
            return;
        }
        if (event.altKey || event.metaKey) {
            return;
        }
        const isPending = vim.inputState.keyBuffer.length > 0;
        if (event.ctrlKey && !isPending) {
            if (SWALLOWED_INSERT_KEYS.has(key)) {
                consume(event);
                return;
            }
            const areInsertKeysEnabled = !!this.editor.config.get("vim")?.isInsertKeysEnabled?.();
            if (areInsertKeysEnabled && OPTIONAL_INSERT_KEYS.has(key) && key !== "<C-u>") {
                consume(event);
                this.runInsertKey(key);
                return;
            }
            const isVimKey = INSERT_KEYS.has(key) || (areInsertKeysEnabled && key === "<C-u>");
            if (!isVimKey) {
                return;
            }
        }
        if (this.runKeys([ key ])) {
            consume(event);
            return;
        }
        if (this.adapter.state.overwrite && !event.ctrlKey) {
            if (event.key.length === 1) {
                consume(event);
                this.overwrite(event.key);
            } else if (key === "<BS>") {
                consume(event);
                this.restoreReplaced();
            }
        }
    }

    /** Writes `character` over the character at the cursor, as Replace mode types. */
    private overwrite(character: string) {
        const head = this.adapter.getCursor();
        const original = this.adapter.getLine(head.line).charAt(head.ch);
        this.replaced.push({ line: head.line, ch: head.ch, original });
        this.adapter.operation(() => this.adapter.overWriteSelection(character));
    }

    /** Moves left in Replace mode, and puts back the character that the last key wrote over. */
    private restoreReplaced() {
        const head = this.adapter.getCursor();
        const last = this.replaced.at(-1);
        this.adapter.operation(() => {
            if (last && last.line === head.line && last.ch === head.ch - 1) {
                this.replaced.pop();
                const from = new VimPosition(last.line, last.ch);
                this.adapter.replaceRange(last.original, from, new VimPosition(last.line, head.ch));
                this.adapter.setCursor(from);
            } else {
                this.replaced = [];
                this.adapter.moveH(-1);
            }
        });
    }

    /**
     * Types the key after `Ctrl+V`, or the digraph after `Ctrl+K`. Returns whether it took the key.
     */
    private typeInsertSequence(event: KeyboardEvent): boolean {
        if (!this.isLiteralNext && this.digraph === null) {
            return false;
        }
        if (event.key === "Escape") {
            this.isLiteralNext = false;
            this.digraph = null;
            consume(event);
            return true;
        }
        const character = event.key === "Tab" ? "\t" : event.key;
        if ([ ...character ].length !== 1) {
            return false;
        }
        consume(event);
        if (this.isLiteralNext) {
            this.isLiteralNext = false;
            this.insertText(character);
        } else if (this.digraph === "") {
            this.digraph = character;
        } else {
            const first = this.digraph as string;
            this.digraph = null;
            this.insertText(getDigraph(first, character) ?? character);
        }
        return true;
    }

    /** Runs a Ctrl key of Insert mode that the engine does not have. */
    private runInsertKey(key: string) {
        const cursor = this.adapter.getCursor();
        switch (key) {
            case "<C-e>":
            case "<C-y>": {
                const line = cursor.line + (key === "<C-e>" ? 1 : -1);
                const character = this.adapter.getLine(line).charAt(cursor.ch);
                if (character && character !== OBJECT_CHARACTER) {
                    this.insertText(character);
                }
                break;
            }
            case "<C-a>":
                this.insertText(this.engine.getRegisterController().getRegister(".").toString());
                break;
            case "<C-v>":
                this.isLiteralNext = true;
                break;
            default:
                this.digraph = "";
        }
    }

    private insertText(text: string) {
        if (text) {
            this.adapter.operation(() => this.adapter.replaceSelection(text));
        }
    }

    /** Runs `keys` in the engine as one undo step. Returns whether the engine took them. */
    private runKeys(keys: string[]): boolean {
        let isHandled = false;
        this.engine.getVimGlobalState_().jumpList = this.jumpList;
        this.undo.open();
        try {
            for (const key of keys) {
                this.isCommandDone = false;
                isHandled = !!this.engine.multiSelectHandleKey(this.adapter as never, key, "user")
                    || isHandled;
                this.trackPendingKey(key);
            }
        } catch (error) {
            console.error(error);
            isHandled = true;
        } finally {
            this.undo.close();
        }
        this.updateStatus();
        this.updateCursor();
        return isHandled;
    }

    /** Adds `key` to the keys of the command being typed, or starts again after a command. */
    private trackPendingKey(key: string) {
        const vim = this.vim;
        if (vim.insertMode || this.commandLine) {
            this.pendingKeys = "";
        } else if (this.isCommandDone) {
            this.pendingKeys = vim.inputState.registerName ? `"${vim.inputState.registerName}` : "";
        } else {
            this.pendingKeys += key;
        }
    }

    /**
     * Does what Escape does, one thing at a time: closes the open balloon or list, cancels the keys
     * of a command, leaves Visual or Insert mode, clears the search highlights, and in the editor
     * of an embed, goes back to the editor around it. Returns whether it did something.
     */
    private escape(): boolean {
        if (this.dismissEditorUi()) {
            return true;
        }
        const vim = this.vim;
        const input = vim.inputState;
        const hasPendingKeys = input.keyBuffer.length > 0 || !!input.operator
            || !!input.registerName
            || input.prefixRepeat.length > 0 || input.motionRepeat.length > 0;
        if (hasPendingKeys || vim.visualMode || vim.insertMode || vim.insertModeReturn) {
            this.runKeys([ "<Esc>" ]);
            return true;
        }
        if (this.adapter.highlights.isShown) {
            this.adapter.operation(() => this.engine.handleEx(this.adapter as never, "nohlsearch"));
            return true;
        }
        this.leaveEmbed();
        return true;
    }

    /** Closes the mention list or a balloon of the editor, as Escape does. */
    private dismissEditorUi(): boolean {
        const editor = this.editor;
        if (editor.plugins.has(TriliumMentionUI)
            && editor.plugins.get(TriliumMentionUI).dismiss()) {
            return true;
        }
        const data = {
            keyCode: keyCodes.esc, ctrlKey: false, altKey: false, shiftKey: false, metaKey: false,
            isPrevented: false,
            preventDefault() {
                this.isPrevented = true;
            },
            stopPropagation() {
                // The key event itself is stopped by the caller.
            }
        };
        editor.keystrokes.press(data);
        return data.isPrevented;
    }

    /** Leaves the editor of an embed for the editor around it, which then selects the embed. */
    private leaveEmbed(): boolean {
        const outerRoot = this.root.parentElement?.closest<HTMLElement>(".ck-editor__editable");
        const outer = (outerRoot as { ckeditorInstance?: Editor } | null)?.ckeditorInstance;
        if (!outer) {
            return false;
        }
        if (outer.plugins.has(TriliumVim) && outer.plugins.get(TriliumVim).isActive) {
            return outer.plugins.get(TriliumVim).selectEmbedOf(this.root);
        }
        return outer.plugins.has(ContentEmbedCaret)
            && outer.plugins.get(ContentEmbedCaret).leaveEmbed(this.root, "end");
    }

    /**
     * Leaves the editor of an embed when a key moves down from its last line or up from its first.
     */
    private leaveEmbedAtEdge(key: string, vim: vimState): boolean {
        const isDown = DOWN_KEYS.has(key);
        if (!isDown && !UP_KEYS.has(key) || vim.visualMode || vim.inputState.keyBuffer.length
            || vim.inputState.operator || vim.inputState.prefixRepeat.length) {
            return false;
        }
        const line = this.adapter.getCursor().line;
        const isAtEdge = isDown ? line === this.adapter.lastLine() : line === 0;
        return isAtEdge && this.leaveEmbed();
    }

    /** Enters the editable part of `widget`: the editor of an embed, or its caption. */
    private enterWidget(widget: ModelElement, isAtEnd: boolean): WidgetEntry | null {
        const editor = this.editor;
        if (isContentEmbed(widget)) {
            const dom = getContentEmbedDom(editor, widget) as HTMLElement;
            const edge = isAtEnd ? "end" : "start";
            const isEntered = !!editor.config.get("contentEmbed")?.enter?.(dom, edge);
            if (isEntered) {
                const nested = findNestedEditor(dom);
                if (nested?.plugins.has(TriliumVim)) {
                    nested.plugins.get(TriliumVim).enterInsertMode();
                }
                return { kind: "embed" };
            }
        }
        let caption = getCaption(widget);
        if (!caption && widget.is("element", "imageBlock")
            && editor.commands.get("toggleImageCaption")?.isEnabled) {
            editor.execute("toggleImageCaption", { focusCaptionOnShow: true });
            caption = getCaption(widget);
        }
        const position = caption && editor.model.createPositionAt(caption, isAtEnd ? "end" : 0);
        return position ? { kind: "caption", position } : null;
    }

    private closeTab() {
        if (this.getHost()?.closeTab?.() === false || !this.getHost()?.closeTab) {
            this.showMessage(this.editor.t("This tab cannot be closed"), 5000);
        }
    }

    private onModeChange({ mode, subMode }: { mode: string; subMode?: string }) {
        if (mode === "replace") {
            this.replaced = [];
        }
        const isInsert = mode === "insert" || mode === "replace";
        if (isInsert && !this.isInsertStepOpen) {
            this.isInsertStepOpen = true;
            this.undo.open();
        } else if (!isInsert && this.isInsertStepOpen) {
            this.isInsertStepOpen = false;
            this.undo.close();
        }
        this.updateStatus();
        this.updateCursor();
        if (subMode !== undefined || mode === "normal") {
            this.adapter.endReveal();
        }
    }

    private onOperationEnd() {
        const vim = this.vim;
        // After `Ctrl+O`, Insert mode comes back where the cursor is, which can be past the end.
        if (!vim.insertMode && !vim.visualMode && !vim.insertModeReturn && !this.commandLine) {
            this.keepCursorOnCharacter();
        }
        if (!this.commandLine) {
            this.adapter.endReveal();
        }
        this.updateCursor();
    }

    /** Puts a caret that a click left past the end of a line on its last character, as in Vim. */
    private keepCursorOnCharacter() {
        const selection = this.editor.model.document.selection;
        if (!selection.isCollapsed) {
            return;
        }
        const cursor = this.adapter.getCursor();
        const length = this.adapter.getLine(cursor.line).length;
        if (length && cursor.ch >= length) {
            const position = this.adapter.toModelPosition(new VimPosition(cursor.line, length - 1));
            this.editor.model.enqueueChange((writer) => writer.setSelection(position));
        }
    }

    private updateStatus() {
        const vim = this.vim;
        let mode: VimMode = "normal";
        if (vim.insertMode) {
            mode = this.adapter.state.overwrite ? "replace" : "insert";
        } else if (vim.visualMode) {
            mode = vim.visualLine ? "visual-line" : "visual";
        }
        const previous = this.plugin.status;
        const next: VimStatus = {
            ...previous,
            mode,
            isOneCommand: !!vim.insertModeReturn,
            pendingKeys: this.pendingKeys,
            commandLine: this.commandLine
        };
        if (!shallowEqual(previous, next)) {
            this.plugin.status = next;
        }
        this.setCommandModeClass(mode !== "insert" && mode !== "replace");
    }

    /** Marks the editing root while keys run commands, which hides the caret of the browser. */
    private setCommandModeClass(isCommandMode: boolean) {
        const view = this.editor.editing.view;
        const root = view.document.getRoot();
        if (!root || root.hasClass("ck-vim-command-mode") === isCommandMode) {
            return;
        }
        view.change((writer) => {
            if (isCommandMode) {
                writer.addClass("ck-vim-command-mode", root);
            } else {
                writer.removeClass("ck-vim-command-mode", root);
            }
        });
    }

    /** Shows the block cursor on the character at the cursor, outside Insert mode. */
    private updateCursor() {
        const editor = this.editor;
        const model = editor.model;
        const vim = this.vim;
        let range: ReturnType<typeof model.createRange> | null = null;
        let isEmpty = false;
        if (!vim.insertMode && this.adapter.getSelectedObjectLine() === null) {
            const head = vim.visualMode ? this.adapter.clipPos(vim.sel.head)
                : this.adapter.getCursor();
            const text = this.adapter.getLine(head.line);
            const lastCh = Math.min(head.ch, Math.max(text.length - 1, 0));
            const ch = toCharacterEdge(text, lastCh, false);
            const start = this.adapter.toModelPosition(new VimPosition(head.line, ch));
            const end = new VimPosition(head.line, toCharacterEdge(text, ch + 1, true));
            isEmpty = !text;
            range = model.createRange(start, isEmpty ? start : this.adapter.toModelPosition(end));
        }
        const current = model.markers.get(
            isEmpty ? EMPTY_CURSOR_MARKER : CURSOR_MARKER)?.getRange();
        const other = model.markers.get(isEmpty ? CURSOR_MARKER : EMPTY_CURSOR_MARKER);
        if (range && current?.isEqual(range) && !other) {
            return;
        }
        if (!range && !current && !other) {
            return;
        }
        model.enqueueChange((writer) => {
            for (const name of [ CURSOR_MARKER, EMPTY_CURSOR_MARKER ]) {
                const isWanted = range && name === (isEmpty ? EMPTY_CURSOR_MARKER : CURSOR_MARKER);
                if (isWanted && range) {
                    if (model.markers.has(name)) {
                        writer.updateMarker(name, { range });
                    } else {
                        writer.addMarker(name,
                            { range, usingOperation: false, affectsData: false });
                    }
                } else if (model.markers.has(name)) {
                    writer.removeMarker(name);
                }
            }
        });
    }

    /**
     * Shows `text` in the status line for `duration` milliseconds, or until the next key with 0.
     */
    private showMessage(text: string, duration: number): () => void {
        const message: VimMessage = { text, isLong: duration === 0 };
        this.clearMessageTimer();
        this.plugin.status = { ...this.plugin.status, message };
        const close = () => {
            if (this.plugin.status.message === message) {
                this.clearMessageTimer();
                this.plugin.status = { ...this.plugin.status, message: null };
            }
        };
        if (duration > 0) {
            this.messageTimer = setTimeout(close, duration);
        }
        return close;
    }

    private clearMessageTimer() {
        if (this.messageTimer) {
            clearTimeout(this.messageTimer);
            this.messageTimer = null;
        }
    }

    /**
     * Opens the command line for the prompt that the engine built in `template`, in the status bar
     * of the app, or under the editor when the status bar does not show this editor. A template
     * without an input field is the message that a macro is being recorded.
     */
    private openDialog(
        template: Element, onEnter: ((value: string) => void) | undefined, options: DialogOptions
    ): CloseDialog {
        const templateInput = template.querySelector("input");
        if (!templateInput) {
            const register = (/@(.)/.exec(template.textContent as string) as RegExpExecArray)[1];
            this.plugin.status = { ...this.plugin.status, recording: register };
            return () => {
                this.plugin.status = { ...this.plugin.status, recording: null };
            };
        }

        const element = document.createElement("div");
        element.className = "ck-vim-command-line";
        const prefix = document.createElement("span");
        prefix.className = "ck-vim-command-line__prefix";
        prefix.textContent = (templateInput.parentElement as HTMLElement).textContent;
        const input = document.createElement("input");
        input.className = "ck-vim-command-line__input";
        input.type = "text";
        input.spellcheck = false;
        input.autocomplete = "off";
        input.setAttribute("autocapitalize", "off");
        input.setAttribute("aria-label", prefix.textContent);
        element.append(prefix, input);
        input.value = options.value ?? "";

        let isClosed = false;
        let fallbackPanel: HTMLElement | null = null;
        const commandLine: VimCommandLine = { element, focus: () => input.focus() };
        const close: CloseDialog = (value) => {
            if (typeof value === "string") {
                input.value = value;
                return;
            }
            if (isClosed) {
                return;
            }
            isClosed = true;
            this.undo.close();
            element.remove();
            fallbackPanel?.remove();
            if (this.commandLine === commandLine) {
                this.commandLine = null;
                this.closeCommandLine = null;
                this.updateStatus();
                this.adapter.focus();
                this.onOperationEnd();
            }
            options.onClose?.(element);
        };

        input.addEventListener("keydown", (event) => {
            event.stopPropagation();
            if (options.onKeyDown?.(event, input.value, close)) {
                return;
            }
            const isEnter = event.key === "Enter";
            try {
                // The command, or the operator that a search completes, runs as a key does.
                if (isEnter && onEnter) {
                    this.adapter.operation(() => onEnter(input.value));
                }
            } finally {
                if (event.key === "Escape" || (isEnter && options.closeOnEnter !== false)) {
                    input.blur();
                    event.preventDefault();
                    close();
                }
            }
        });
        input.addEventListener("keyup", (event) => {
            event.stopPropagation();
            options.onKeyUp?.(event, input.value, close);
        });
        input.addEventListener("input", (event) => options.onInput?.(event, input.value, close));
        input.addEventListener("blur", () => setTimeout(() => {
            if (document.activeElement !== input) {
                close();
            }
        }));

        // A command and the prompts it opens, such as the confirmation of `:s///c`, undo as one
        // step.
        this.undo.open();
        this.closeCommandLine?.();
        this.commandLine = commandLine;
        this.closeCommandLine = () => close();
        if (!this.getHost()?.mountCommandLine?.(element, this.editor)) {
            fallbackPanel = this.mountCommandLineUnderEditor(element);
        }
        this.updateStatus();
        input.focus();
        return close;
    }

    /** Shows the command line at the bottom of the visible part of the editor. */
    private mountCommandLineUnderEditor(element: HTMLElement): HTMLElement {
        const panel = document.createElement("div");
        panel.className = "ck-vim-command-line-panel";
        const rect = this.root.getBoundingClientRect();
        const bottom = Math.min(rect.bottom, window.innerHeight);
        panel.style.left = `${rect.left}px`;
        panel.style.width = `${rect.width}px`;
        panel.style.top = `${Math.max(bottom - 32, rect.top)}px`;
        panel.append(element);
        document.body.append(panel);
        return panel;
    }

    private readClipboard(): Promise<string | null> {
        const host = this.getHost();
        if (host?.readClipboard) {
            return host.readClipboard();
        }
        return navigator.clipboard ? navigator.clipboard.readText() : Promise.resolve(null);
    }

    private writeClipboard(text: string, html: string | null) {
        const host = this.getHost();
        if (host?.writeClipboard) {
            host.writeClipboard(text, html);
        } else {
            void navigator.clipboard?.writeText(text).catch(() => undefined);
        }
    }

    private getHost(): VimHost | undefined {
        return this.editor.config.get("vim")?.host;
    }
}

/** The text of a message of the engine, its lines kept. */
function getMessageText(template: Node): string {
    const blocks = [ ...template.childNodes ].filter((node) => node instanceof HTMLElement);
    return blocks.length > 1
        ? blocks.map((block) => block.textContent).join("\n")
        : template.textContent as string;
}

/** The editor in the content of the embed `dom`, once it shows. */
function findNestedEditor(dom: HTMLElement): Editor | undefined {
    const root = dom.querySelector(".ck-editor__editable");
    return (root as { ckeditorInstance?: Editor } | null)?.ckeditorInstance;
}

/** Whether `event` types or deletes text, which a key outside Insert mode never does. */
function isTypingKey(event: KeyboardEvent): boolean {
    return event.key === "Backspace" || event.key === "Delete"
        || (!event.ctrlKey
            && (event.key.length === 1 || event.key === "Enter" || event.key === "Tab"));
}

function consume(event: KeyboardEvent) {
    event.preventDefault();
    event.stopImmediatePropagation();
}

function shallowEqual(a: object, b: object): boolean {
    const keys = Object.keys(a) as (keyof typeof a)[];
    return keys.length === Object.keys(b).length && keys.every((key) => a[key] === b[key]);
}


declare module "ckeditor5" {
    interface PluginsMap {
        [TriliumVim.pluginName]: TriliumVim;
    }

    interface EditorConfig {
        vim?: VimConfig;
    }
}
