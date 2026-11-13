import "../../theme/vim.css";

import type { Pos, Vim, vimState } from "@replit/codemirror-vim-core";
import { isHttpUrl } from "@triliumnext/commons";
import {
    ClipboardPipeline, type ClipboardContentInsertionEvent, type Editor, env, keyCodes,
    type ModelElement, ModelLiveRange, type ModelPosition, type ModelRange, Plugin,
    type ViewDocumentKeyDownEvent
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
import { getYankedMessage, isUserMapped, startsUserMapping } from "./vim_commands.js";
import { getDigraph } from "./vim_digraphs.js";
import { getLoadedVimEngine, loadVimEngine, runStartupCommands } from "./vim_engine.js";
import { getPromptKind, PromptAssistant, type PromptKind } from "./vim_command_line.js";
import {
    getAfterSearchHints, getBreadcrumbHint, getCancelHint, getCommandHints, getKeyLabel,
    getModeHints, HINT_LIMIT,
    HINT_PAUSE, type HintContext, type PendingCommand, splitKeys, type Translate, type VimHint,
    type VimHints
} from "./vim_hints.js";
import { createJumpList } from "./vim_jumps.js";
import { getKeyReference, type VimHintSection } from "./vim_key_reference.js";
import { OBJECT_CHARACTER, toCharacterEdge } from "./vim_lines.js";
import { SEARCH_MARKER } from "./vim_search.js";
import { canFold, getParagraphObjectKind } from "./vim_structure.js";
import VimUndo from "./vim_undo.js";

/** The modes of Vim, as the status line names them. */
export type VimMode = "normal" | "insert" | "replace" | "visual" | "visual-line";

/** A message of Vim, such as "Pattern not found" or the list of `:registers`. */
export interface VimMessage {
    text: string;
    /** Whether the message is a list that stays until the next key, rather than a short note. */
    isLong: boolean;
    /** Keys to show in place of the text, such as those that follow a search. */
    hints?: VimHint[];
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
    /** The key hints that the status bar shows, or `null`. */
    hints: VimHints | null;
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
    /**
     * Switches between the keys of the mode and the breadcrumb, for `Esc` in Normal mode with
     * nothing else to do.
     */
    toggleHintStrip?(): void;
    /** Turns the key hints on or off, for `:set hints` and `:set nohints`. */
    setHintsEnabled?(isEnabled: boolean): void;
    /** Closes the full key list of the Shortcut Hints panel. Returns whether it was open. */
    closeKeyReference?(): boolean;
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
    /** Whether the status bar shows key hints. */
    areHintsEnabled?(): boolean;
    /** Whether Normal and Visual mode show their keys in place of the breadcrumb. */
    isHintStripShown?(): boolean;
}

/** A link that "follow the link" opens. */
export interface LinkUnderCursor {
    href: string | undefined;
    /** Whether the link is a note reference, rather than linked text. */
    isReference: boolean;
}

/** The status of an editor with Vim mode off. */
const OFF_STATUS: VimStatus = {
    mode: null, isOneCommand: false, pendingKeys: "", recording: null, message: null,
    commandLine: null, hints: null
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
/** How long keys that start a mapping wait for the rest of it, in milliseconds. */
const MAPPING_TIMEOUT = 1000;
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
    /** The mode that the last call of `setEnabled()` asks for, or `null` when it turns Vim off. */
    private wantedMode: "normal" | "insert" | null = null;

    static get pluginName() {
        return "TriliumVim" as const;
    }

    static get requires() {
        return [ ClipboardPipeline ] as const;
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
     * mode starts in the `mode` of the last call, which counts when several wait for the engine.
     */
    async setEnabled(isEnabled: boolean, mode: "normal" | "insert" = "normal"): Promise<void> {
        this.wantedMode = isEnabled ? mode : null;
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
            if (this.wantedMode && !this.session && this.editor.state === "ready") {
                this.session = new VimSession(this, engine, this.wantedMode);
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

    /** Shows the key hints again, after the options that govern them changed. */
    refreshHints() {
        this.session?.refreshHints();
    }

    /**
     * The full key list of the state of the editor, by topic, for the Shortcut Hints panel. Empty
     * while Vim mode is off.
     */
    getKeyReference(): VimHintSection[] {
        return this.session?.getKeyReference() ?? [];
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
    private hintTimer: ReturnType<typeof setTimeout> | null = null;
    /** Whether the hints for the command being typed show, once a pause brought them. */
    private areCommandHintsShown = false;
    private promptKind: PromptKind | null = null;
    /** The hints of the open prompt, or `null` for a prompt without hints. */
    private promptHints: VimHints | null = null;
    /** Whether the last keys moved the focus to another editable, until the next input. */
    private isFocusMoved = false;
    /** Whether keys wait in the engine for the rest of a mapping that they start. */
    private isHoldingKeys = false;
    private mappingTimer: ReturnType<typeof setTimeout> | null = null;
    /** Whether the keys held for a mapping run, which then wait for nothing. */
    private isReleasing = false;
    private readonly translate = (message: string, values?: string[]) =>
        this.editor.t(message, values);
    private readonly hintContext: HintContext = {
        isOnLink: () => getLinkUnderCursor(this.editor) !== null,
        canFold: () => canFold(this.adapter, this.adapter.getCursor().line),
        getParagraphObjectKind: () =>
            getParagraphObjectKind(this.adapter, this.adapter.getCursor().line),
        isMapped: isUserMapped
    };

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
                this.showMessage(translateMessage(getMessageText(template), this.translate),
                    duration),
            notify: (message) => this.showMessage(message, 5000),
            undo: () => this.undo.undo(),
            redo: () => this.redo(),
            onOperationEnd: () => this.onOperationEnd(),
            onHighlightsChange: () => this.updateStatus(),
            save: () => this.getHost()?.save?.(),
            closeTab: () => this.closeTab(),
            followLink: () => this.getHost()?.followLink?.(),
            readClipboard: () => this.readClipboard(),
            writeClipboard: (text, html) => this.writeClipboard(text, html),
            enterWidget: (widget, isAtEnd) => this.enterWidget(widget, isAtEnd)
        });

        engine.enterVimMode(this.adapter as never);
        // The engine enters Insert mode on a paste. `onPaste()` keeps the mode instead.
        const { onPasteFn } = this.vim as vimState & { onPasteFn: () => void };
        this.root.removeEventListener("paste", onPasteFn);
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
        this.clearHintTimer();
        this.clearMappingTimer();
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

        // Focusing another editable, as when a key leaves a tab panel, can make the browser report
        // its own caret at the start of the note once the key is done. The selection of Vim stays.
        const onSelectionChange = (evt: { stop(): void }) => {
            if (this.isFocusMoved) {
                this.isFocusMoved = false;
                evt.stop();
                editor.editing.view.forceRender();
            }
        };
        viewDocument.on("selectionChange", onSelectionChange, { priority: "highest" });
        this.stopListening.push(() => viewDocument.off("selectionChange", onSelectionChange));
        const onPointerDown = () => {
            this.isFocusMoved = false;
        };
        document.addEventListener("pointerdown", onPointerDown, { capture: true });
        this.stopListening.push(
            () => document.removeEventListener("pointerdown", onPointerDown, { capture: true }));

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

        const clipboard = editor.plugins.get(ClipboardPipeline);
        const onInsertion = (_evt: unknown, data: ClipboardContentInsertionEvent["args"][0]) => {
            // `ClipboardPipeline` sets the range in its listener of the "low" priority.
            this.onPaste(data.resultRange as ModelRange);
        };
        clipboard.on<ClipboardContentInsertionEvent>("contentInsertion", onInsertion,
            { priority: "lowest" });
        this.stopListening.push(() => clipboard.off("contentInsertion", onInsertion));
    }

    /**
     * Puts the cursor on the last character that a paste or a drop put outside Insert mode, once
     * the change is done. The mode stays.
     */
    private onPaste(resultRange: ModelRange) {
        if (this.vim.insertMode) {
            return;
        }
        const pasted = ModelLiveRange.fromRange(resultRange);
        this.editor.model.enqueueChange(() => {
            const start = this.adapter.locatePosition(pasted.start);
            const end = this.adapter.locatePosition(pasted.end);
            pasted.detach();
            let cursor: Pos = new VimPosition(end.line, end.ch - 1);
            if (end.ch === 0) {
                const line = Math.max(end.line - 1, start.line);
                cursor = new VimPosition(line, this.adapter.getLine(line).length - 1);
            }
            this.adapter.operation(() => this.adapter.setCursor(cursor));
            this.updateStatus();
            this.updateCursor();
        });
    }

    private onKeyDown(event: KeyboardEvent) {
        const vim = this.vim;
        this.isFocusMoved = false;
        if (event.defaultPrevented || event.isComposing
            || [ "Process", "Unidentified", "Dead" ].includes(event.key)) {
            return;
        }
        if (!isFromEditable(this.editor, event)) {
            this.onBalloonKey(event, vim);
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

    /**
     * Closes a balloon of the editor, such as that of a link, on `Ctrl+[`, and on `Ctrl+C` with no
     * text selected in it, as Escape does.
     */
    private onBalloonKey(event: KeyboardEvent, vim: vimState) {
        const target = event.target as HTMLInputElement;
        if (!this.editor.ui.view.body.bodyCollectionContainer.contains(target)) {
            return;
        }
        const key = this.engine.vimKeyFromEvent(event, vim);
        const hasSelectedText = typeof target.selectionStart === "number"
            && target.selectionStart !== target.selectionEnd;
        if ((key === "<C-[>" || (key === "<C-c>" && !hasSelectedText)) && this.dismissEditorUi()) {
            consume(event);
            this.editor.editing.view.focus();
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
        const pendingBefore = this.pendingKeys;
        const messageBefore = this.plugin.status.message;
        const focused = document.activeElement;
        this.engine.getVimGlobalState_().jumpList = this.jumpList;
        this.undo.open();
        try {
            for (const key of keys) {
                this.isCommandDone = false;
                if (this.holdForMapping(key)) {
                    isHandled = true;
                } else {
                    isHandled = !!this.engine.multiSelectHandleKey(this.adapter as never, key,
                        "user") || isHandled;
                }
                this.trackPendingKey(key);
            }
        } catch (error) {
            console.error(error);
            isHandled = true;
        } finally {
            this.undo.close();
        }
        this.isFocusMoved = document.activeElement !== focused;
        this.followCommandHints();
        this.followSearchMessage(keys, pendingBefore, messageBefore);
        this.updateStatus();
        this.updateCursor();
        return isHandled;
    }

    /**
     * Keeps `key` with the keys of the command being typed, without running them, while they start
     * a mapping of the user that they are a command of their own before, such as `,` before `,d`.
     * The last key of the mapping runs it. Another key, or a second without one, runs the keys
     * held as they were typed, as Vim does after 'timeoutlen'. Returns whether it kept the key.
     */
    private holdForMapping(key: string): boolean {
        this.clearMappingTimer();
        const vim = this.vim;
        const buffer = vim.inputState.keyBuffer;
        const context = vim.visualMode ? "visual" : "normal";
        const typed = `${buffer.join("")}${key}`.replace(/^[1-9]\d*/u, "");
        const wasHolding = this.isHoldingKeys;
        this.isHoldingKeys = false;
        if (vim.insertMode || vim.inputState.operator || key === "<Esc>" || this.isReleasing) {
            return false;
        }
        if (startsUserMapping(typed, context)) {
            buffer.push(key);
            this.isHoldingKeys = true;
            this.mappingTimer = setTimeout(() => this.releaseHeldKeys(), MAPPING_TIMEOUT);
            return true;
        }
        if (wasHolding && !isUserMapped(typed, context)) {
            for (const held of buffer.splice(0)) {
                this.engine.multiSelectHandleKey(this.adapter as never, held, "user");
            }
            this.isCommandDone = false;
        }
        return false;
    }

    /** Runs the keys that wait for the rest of a mapping as they were typed. */
    private releaseHeldKeys() {
        this.mappingTimer = null;
        this.isHoldingKeys = false;
        this.pendingKeys = "";
        this.isReleasing = true;
        try {
            this.runKeys(this.vim.inputState.keyBuffer.splice(0));
        } finally {
            this.isReleasing = false;
        }
    }

    private clearMappingTimer() {
        if (this.mappingTimer) {
            clearTimeout(this.mappingTimer);
            this.mappingTimer = null;
        }
    }

    /**
     * Shows the keys that follow a search after `*` and `#`, and keeps them while `n` and `N`
     * move through the matches. Any other key, or a message of the search, takes them away.
     */
    private followSearchMessage(keys: string[], pendingBefore: string, before: VimMessage | null) {
        if (this.plugin.status.message !== before) {
            return;
        }
        const isWordSearch = /^\d*g?$/u.test(pendingBefore) && /^[*#]$/u.test(keys.join(""));
        const isRepeat = !!before?.hints && keys.every((key) => key === "n" || key === "N");
        if (isWordSearch || isRepeat) {
            this.showSearchMessage();
        } else if (before?.hints) {
            this.closeMessage(before);
        }
    }

    /** Shows the keys that follow a search next to the mode, for five seconds. */
    private showSearchMessage() {
        if (this.areHintsEnabled()) {
            this.showMessage("", 5000, getAfterSearchHints(this.translate));
        }
    }

    /** Shows the key hints again, for options that changed. */
    refreshHints() {
        if (!this.areHintsEnabled()) {
            this.clearHintTimer();
            this.areCommandHintsShown = false;
        }
        this.updateStatus();
    }

    /**
     * Shows the hints for the command being typed after a pause, and from then on at once after
     * each key, until the command ends. Only keys that the user presses come here.
     */
    private followCommandHints() {
        if (!this.areHintsEnabled() || !this.resolveCommandHints()) {
            this.clearHintTimer();
            this.areCommandHintsShown = false;
            return;
        }
        if (this.areCommandHintsShown) {
            return;
        }
        this.clearHintTimer();
        this.hintTimer = setTimeout(() => {
            this.hintTimer = null;
            this.areCommandHintsShown = true;
            this.updateStatus();
        }, HINT_PAUSE);
    }

    private clearHintTimer() {
        if (this.hintTimer) {
            clearTimeout(this.hintTimer);
            this.hintTimer = null;
        }
    }

    private areHintsEnabled(): boolean {
        return this.editor.config.get("vim")?.areHintsEnabled?.() ?? false;
    }

    /** The hints that the status bar shows in `mode`. */
    private getHints(mode: VimMode): VimHints | null {
        if (!this.areHintsEnabled() || this.vim.insertModeReturn) {
            return null;
        }
        if (this.commandLine) {
            return this.promptHints;
        }
        const commandHints = this.areCommandHintsShown ? this.resolveCommandHints() : null;
        if (commandHints) {
            return commandHints;
        }
        const isStripShown = this.editor.config.get("vim")?.isHintStripShown?.() ?? true;
        if (!isStripShown || mode === "insert" || mode === "replace") {
            return null;
        }
        const context = mode === "normal" ? "normal" : "visual";
        const hints = getModeHints(context, isUserMapped, this.translate);
        // `Esc` clears the search highlights or leaves the embed before it shows the breadcrumb.
        if (context === "normal" && !this.adapter.highlights.isShown && !this.getOuterEditor()) {
            hints.push(getBreadcrumbHint(this.translate));
        }
        return { kind: "mode", typedKeys: [], hints };
    }

    /** The hints for the command being typed, or `null` when it waits for nothing they know. */
    private resolveCommandHints(): VimHints | null {
        const hints = this.getPendingHints();
        if (!hints) {
            return null;
        }
        return {
            kind: "command",
            typedKeys: splitKeys(this.pendingKeys || this.vim.inputState.keyBuffer.join(""))
                .map(getKeyLabel),
            hints: [ ...hints.slice(0, HINT_LIMIT), getCancelHint(this.translate) ]
        };
    }

    /** Every key that can follow the command being typed, or `null`. */
    private getPendingHints(): VimHint[] | null {
        const vim = this.vim;
        const input = vim.inputState;
        const buffer = input.keyBuffer.join("");
        const [ , digits, keys ] = /^(\d*)(.*)$/su.exec(buffer) as RegExpExecArray;
        const command: PendingCommand = {
            context: vim.insertMode ? "insert" : vim.visualMode ? "visual" : "normal",
            keyBuffer: keys,
            operator: getOperatorKeys(input),
            hasCount: !!digits || input.prefixRepeat.length > 0 || input.motionRepeat.length > 0,
            registerName: input.registerName ?? ""
        };
        const hints = getCommandHints(command, this.hintContext, this.translate);
        return hints?.length ? hints : null;
    }

    /** The full key list of the state of the editor, for the Shortcut Hints panel. */
    getKeyReference(): VimHintSection[] {
        const vim = this.vim;
        const t = this.translate;
        if (this.commandLine) {
            const kind = this.promptKind === "command" || this.promptKind === "confirm"
                ? this.promptKind
                : "search";
            return getKeyReference({ kind }, t);
        }
        const pending = this.getPendingHints();
        if (pending) {
            return getKeyReference({ kind: "pending", hints: pending }, t);
        }
        if (vim.insertMode) {
            const areInsertKeysEnabled =
                !!this.editor.config.get("vim")?.isInsertKeysEnabled?.();
            return getKeyReference({ kind: "insert", areInsertKeysEnabled }, t);
        }
        return getKeyReference({ kind: vim.visualMode ? "visual" : "normal" }, t);
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
     * Does what Escape does, one thing at a time: closes the open balloon, list or long message,
     * cancels the keys of a command, leaves Visual or Insert mode, clears the search highlights, in
     * the editor of an embed goes back to the editor around it, and else switches between the keys
     * of the mode and the breadcrumb. Returns whether it did something.
     */
    private escape(): boolean {
        const message = this.plugin.status.message;
        if (message?.hints) {
            this.closeMessage(message);
        }
        if (this.getHost()?.closeKeyReference?.() || this.dismissEditorUi()) {
            return true;
        }
        const closeLongMessage = this.adapter.state.closeVimNotification as (() => void) | null;
        if (closeLongMessage) {
            this.adapter.state.closeVimNotification = null;
            closeLongMessage();
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
            // `handleEx()` records `nohlsearch` in the `:` register, so the last command goes back.
            const register = this.engine.getRegisterController().getRegister(":");
            const lastCommand = register.toString();
            this.adapter.operation(() => this.engine.handleEx(this.adapter as never, "nohlsearch"));
            register.setText(lastCommand);
            return true;
        }
        if (!this.leaveEmbed() && this.areHintsEnabled()) {
            this.getHost()?.toggleHintStrip?.();
            this.updateStatus();
        }
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
        const outer = this.getOuterEditor();
        if (!outer) {
            return false;
        }
        if (outer.plugins.has(TriliumVim) && outer.plugins.get(TriliumVim).isActive) {
            return outer.plugins.get(TriliumVim).selectEmbedOf(this.root);
        }
        return outer.plugins.has(ContentEmbedCaret)
            && outer.plugins.get(ContentEmbedCaret).leaveEmbed(this.root, "end");
    }

    /** The editor around this one when this is the editor of an embed, else `undefined`. */
    private getOuterEditor(): Editor | undefined {
        const outerRoot = this.root.parentElement?.closest<HTMLElement>(".ck-editor__editable");
        return (outerRoot as { ckeditorInstance?: Editor } | null)?.ckeditorInstance;
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

    /** Redoes one step, and leaves the cursor at the start of what it changed, as `u` does. */
    private redo() {
        this.undo.redo();
        this.adapter.setCursor(this.adapter.getCursor("start"));
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
        const hints = this.getHints(mode);
        const next: VimStatus = {
            ...previous,
            mode,
            isOneCommand: !!vim.insertModeReturn,
            pendingKeys: this.pendingKeys,
            commandLine: this.commandLine,
            hints: areHintsEqual(previous.hints, hints) ? previous.hints : hints
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
    private showMessage(text: string, duration: number, hints?: VimHint[]): () => void {
        const message: VimMessage = { text, isLong: duration === 0, ...hints ? { hints } : {} };
        this.clearMessageTimer();
        this.plugin.status = { ...this.plugin.status, message };
        const close = () => this.closeMessage(message);
        if (duration > 0) {
            this.messageTimer = setTimeout(close, duration);
        }
        return close;
    }

    private closeMessage(message: VimMessage) {
        if (this.plugin.status.message === message) {
            this.clearMessageTimer();
            this.plugin.status = { ...this.plugin.status, message: null };
        }
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
        const kind = getPromptKind(prefix.textContent);
        this.promptKind = kind;
        const assistant = new PromptAssistant(kind, input, element, {
            translate: this.translate,
            areHintsEnabled: () => this.areHintsEnabled(),
            isJavaScriptRegex: () => this.engine.getOption("pcre") !== false,
            getEditorCommands: () => [ ...this.editor.commands.names() ].map((name) => ({
                name, isEnabled: !!this.editor.commands.get(name)?.isEnabled
            })),
            showHints: (hints) => {
                this.promptHints = hints.length ? { kind: "prompt", typedKeys: [], hints } : null;
                this.updateStatus();
            }
        });
        const close: CloseDialog = (value) => {
            if (typeof value === "string") {
                input.value = value;
                return;
            }
            if (isClosed) {
                return;
            }
            isClosed = true;
            assistant.destroy();
            this.undo.close();
            element.remove();
            fallbackPanel?.remove();
            if (this.commandLine === commandLine) {
                this.commandLine = null;
                this.closeCommandLine = null;
                this.promptHints = null;
                this.updateStatus();
                this.adapter.focus();
                this.onOperationEnd();
            }
            options.onClose?.(element);
        };

        input.addEventListener("keydown", (event) => {
            event.stopPropagation();
            if (assistant.onKeyDown(event) || options.onKeyDown?.(event, input.value, close)) {
                return;
            }
            const isEnter = event.key === "Enter";
            try {
                // The command, or the operator that a search completes, runs as a key does.
                if (isEnter && onEnter) {
                    const isCursorSearch = kind === "search" && !this.vim.inputState.operator;
                    const messageBefore = this.plugin.status.message;
                    this.adapter.asVimOperation(() => onEnter(input.value));
                    if (isCursorSearch && this.plugin.status.message === messageBefore) {
                        this.showSearchMessage();
                    }
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
            assistant.update();
        });
        input.addEventListener("input", (event) => {
            options.onInput?.(event, input.value, close);
            assistant.onInput();
        });
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
        this.promptHints = null;
        if (!this.getHost()?.mountCommandLine?.(element, this.editor)) {
            fallbackPanel = this.mountCommandLineUnderEditor(element);
        }
        assistant.update();
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

/**
 * The link that "follow the link" opens: the selected note reference or link preview, or the link
 * of the text at the caret. In Normal mode of Vim, the reference, link preview or linked character
 * under the block cursor, which the caret is before. A link preview counts only with a web address.
 */
export function getLinkUnderCursor(editor: Editor): LinkUnderCursor | null {
    const selection = editor.model.document.selection;
    const vim = editor.plugins.has(TriliumVim) ? editor.plugins.get(TriliumVim) : null;
    const isBlockCursor = vim?.status.mode === "normal" && selection.isCollapsed;
    const position = selection.getFirstPosition() as ModelPosition;
    const node = isBlockCursor
        ? position.textNode ?? position.nodeAfter
        : selection.getSelectedElement();
    if (node?.is("element", "reference")) {
        return { href: node.getAttribute("href") as string | undefined, isReference: true };
    }
    if (node?.is("element", "linkMention") || node?.is("element", "linkEmbed")) {
        const url = node.getAttribute("url") as string | undefined;
        return isHttpUrl(url) ? { href: url, isReference: false } : null;
    }
    const href = isBlockCursor
        ? node?.getAttribute("linkHref")
        : selection.getAttribute("linkHref");
    return typeof href === "string" ? { href, isReference: false } : null;
}

/** The text of a message of the engine, its lines kept. */
function getMessageText(template: Node): string {
    const blocks = [ ...template.childNodes ].filter((node) => node instanceof HTMLElement);
    return blocks.length > 1
        ? blocks.map((block) => block.textContent).join("\n")
        : template.textContent as string;
}

/** `text`, a message of the engine, in the language of the editor when it is a yank message. */
function translateMessage(text: string, t: Translate): string {
    const yanked = /^(\d+) lines yanked(?: into "(.))?$/u.exec(text);
    return yanked ? getYankedMessage(t, Number(yanked[1]), yanked[2]) : text;
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

/**
 * The keys of the operator that waits for its motion, such as `d` or `gu`. The engine keeps the
 * keys of an operator of two keys only, and the name of the others.
 */
function getOperatorKeys(input: vimState["inputState"]): string {
    if (!input.operator) {
        return "";
    }
    if (input.operatorShortcut) {
        return input.operatorShortcut;
    }
    switch (input.operator) {
        case "delete":
            return "d";
        case "yank":
            return "y";
        case "change":
            return "c";
        case "indent":
            return input.operatorArgs?.indentRight ? ">" : "<";
        default:
            return input.operator;
    }
}

/** Whether `a` and `b` show the same, so that the status keeps the hints it has. */
function areHintsEqual(a: VimHints | null, b: VimHints | null): boolean {
    return a === b || (!!a && !!b && JSON.stringify(a) === JSON.stringify(b));
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
