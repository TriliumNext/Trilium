import { isHttpUrl } from "@triliumnext/commons/src/lib/link_embed.js";
import { ClipboardPipeline, type Editor, type ModelPosition, Plugin } from "ckeditor5";

import { getContentEmbedAt } from "../content_embed/content_embed.js";
import type { VimHint, VimHints } from "./vim_hints.js";
import type { VimHintSection } from "./vim_key_reference.js";
import type VimSession from "./vim_session.js";

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
export const CURSOR_MARKER = "vimCursor";
export const EMPTY_CURSOR_MARKER = "vimCursorEmpty";
/** The group of the markers that highlight the matches of a search. */
export const SEARCH_MARKER = "vimSearch";

/** The module of `VimSession`, once loaded. */
let sessionModule: typeof import("./vim_session.js") | undefined;

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
        sessionModule ??= await import("./vim_session.js");
        const { default: VimSession, getLoadedVimEngine, loadVimEngine } = sessionModule;
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



declare module "ckeditor5" {
    interface PluginsMap {
        [TriliumVim.pluginName]: TriliumVim;
    }

    interface EditorConfig {
        vim?: VimConfig;
    }
}
