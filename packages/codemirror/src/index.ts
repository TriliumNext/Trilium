import { defaultKeymap, history, historyKeymap } from "@codemirror/commands";
import { EditorView, highlightActiveLine, highlightActiveLineGutter, keymap, lineNumbers, placeholder, tooltips, ViewPlugin, ViewUpdate, type EditorViewConfig, KeyBinding } from "@codemirror/view";
import { defaultHighlightStyle, StreamLanguage, syntaxHighlighting, indentUnit, bracketMatching, foldGutter, codeFolding } from "@codemirror/language";
import {
    Compartment, countColumn, EditorSelection, EditorState, Prec, StateEffect, Transaction,
    type Extension
} from "@codemirror/state";
import { highlightSelectionMatches } from "@codemirror/search";
import { autocompletion, completionStatus, type CompletionSource } from "@codemirror/autocomplete";
import { CodeMirror as VimEditor, vim } from "@replit/codemirror-vim";
import { indentationMarkers } from "@replit/codemirror-indentation-markers";
import byMimeType, { MIME_ALIASES } from "./syntax_highlighting.js";
import smartIndentWithTab from "./extensions/custom_tab.js";
import type { ThemeDefinition } from "./color_themes.js";
import { createSearchHighlighter, SearchHighlighter, searchMatchHighlightTheme } from "./find_replace.js";
import { isHostedCompletionShown } from "./extensions/hosted_completion.js";
import type SharedHistory from "./shared_history.js";
import {
    buildTypeCompletion, type ScriptApiContext, type TypeCompleter
} from "./type_completion/index.js";

export { default as ColorThemes, type ThemeDefinition, type ThemeVariant, getThemeById } from "./color_themes.js";
export {
    default as SharedHistory, type HostHistory, type HostHistoryStep
} from "./shared_history.js";
export {
    hasSelectedText, runLineOperation, runTextTransform, type TextToolTarget
} from "./text_tools.js";
export {
    isScriptMime, type ScriptApiContext, SCRIPT_MIME_BACKEND, SCRIPT_MIME_FRONTEND,
    type TypeCompletionEntry
} from "./type_completion/index.js";
export { triliumLogHighlighter } from "./extensions/trilium_log_highlighter.js";

// Custom keymap to prevent Ctrl+Enter from inserting a newline
// This allows the parent application to handle the shortcut (e.g., for "Run Active Note")
const preventCtrlEnterKeymap: readonly KeyBinding[] = [
    {
        key: "Ctrl-Enter",
        mac: "Cmd-Enter",
        run: () => true, // Return true to mark event as handled, preventing default newline insertion
        preventDefault: true
    }
];

// Lint diagnostics (e.g. the TypeScript script linter or the Mermaid linter) can produce very
// long messages; without a width cap and wrapping the tooltip overflows the editor and gets
// clipped at the edges. `.cm-tooltip-lint` is the diagnostics list shared by both the gutter
// tooltip (where it also carries `.cm-tooltip`) and the inline hover tooltip (where it's nested
// inside a `.cm-tooltip-hover` wrapper), so targeting it directly covers both.
const lintTooltipTheme = EditorView.baseTheme({
    ".cm-tooltip-lint": {
        maxWidth: "min(40em, 90vw)"
    },
    ".cm-diagnostic": {
        whiteSpace: "pre-wrap",
        overflowWrap: "anywhere"
    }
});

// Chromium maps `autocomplete="off"` on the focused element to Android's
// `TYPE_TEXT_FLAG_NO_SUGGESTIONS`, which is what stops Gboard from offering word completions and
// rewriting what was typed. The `spellcheck`, `autocorrect` and `writingsuggestions` attributes
// CodeMirror already sets reach no equivalent flag, so the on-screen keyboard ignores them.
const noKeyboardSuggestions = EditorView.contentAttributes.of({ autocomplete: "off" });

// CodeMirror sets `autocorrect="off"` and `autocapitalize="off"` on every editor it builds, which
// suits code. An editor holding prose overrides both, since `contentAttributes` is merged in after
// those defaults, so the on-screen keyboard capitalizes sentences and fixes typos again.
const proseKeyboardAttributes = EditorView.contentAttributes.of({
    autocorrect: "on",
    autocapitalize: "sentences"
});

type ContentChangedListener = () => void;

export interface EditorConfig {
    parent: HTMLElement;
    placeholder?: string;
    lineWrapping?: boolean;
    /** Whether to show the line numbers in the gutter. Defaults to true. */
    lineNumbers?: boolean;
    vimKeybindings?: boolean;
    readOnly?: boolean;
    /** Disables some of the nice-to-have features (bracket matching, syntax highlighting, indentation markers) in order to improve performance. */
    preferPerformance?: boolean;
    tabIndex?: number;
    /** The number of spaces used for indentation (also used as the tab display width). Defaults to 4. */
    indentSize?: number;
    /** If true, indent using a tab character instead of spaces. Defaults to false. */
    useTabs?: boolean;
    /**
     * Lets an on-screen keyboard offer word completions, correct typos and capitalize sentences.
     * Defaults to false, which suits code; an editor holding prose, such as the Markdown note
     * type, sets it to true.
     */
    allowKeyboardSuggestions?: boolean;
    onContentChanged?: ContentChangedListener;
}

/** An end of the document, where the cursor enters or leaves the editor. */
export type DocumentEdge = "start" | "end";

/** Where the cursor is, with the line and the column both counted from 1. */
export interface CursorPosition {
    line: number;
    /** The column as displayed, with a tab as wide as the tab size. */
    column: number;
    /** The number of selected characters, all ranges of the selection together. */
    selectionLength: number;
}

function buildIndentUnit(indentSize: number, useTabs: boolean) {
    return useTabs ? "\t" : " ".repeat(indentSize);
}

export default class CodeMirror extends EditorView {

    private config: EditorConfig;
    private languageCompartment: Compartment;
    private historyCompartment: Compartment;
    private editabilityCompartment: Compartment;
    private themeCompartment: Compartment;
    private lineWrappingCompartment: Compartment;
    private lineNumbersCompartment: Compartment;
    private hasLineNumbers: boolean;
    private keyboardSuggestionsCompartment: Compartment;
    private indentUnitCompartment: Compartment;
    private searchHighlightCompartment: Compartment;
    private typeCompletionCompartment: Compartment;
    private completionSourceCompartment: Compartment;
    private searchPlugin?: SearchHighlighter | null;
    private sharedHistory: SharedHistory | null = null;
    private namedCompartments = new Map<string, Compartment>();
    /** Named completion sources aggregated into the editor's single autocompletion. */
    private completionSources = new Map<string, CompletionSource>();
    /** The language service's completions for the current MIME type, or null where it has none. */
    private typeCompleter: TypeCompleter | null = null;
    /** Monotonic token guarding against out-of-order async type-completion updates. */
    private typeCompletionToken = 0;
    /** The latest type-completion build, which a request for the same MIME type and context joins. */
    private typeCompletionBuild: { key: string; done: Promise<void> } | null = null;
    /** Current MIME type, retained so the type completion can be rebuilt when only the api context changes. */
    private currentMime: string | null = null;
    /** Per-note context tuning the script `api` surface (e.g. custom-request-handler members). */
    private scriptApiContext: ScriptApiContext = {};

    constructor(config: EditorConfig) {
        const languageCompartment = new Compartment();
        const historyCompartment = new Compartment();
        const editabilityCompartment = new Compartment();
        const themeCompartment = new Compartment();
        const lineWrappingCompartment = new Compartment();
        const lineNumbersCompartment = new Compartment();
        const keyboardSuggestionsCompartment = new Compartment();
        const indentUnitCompartment = new Compartment();
        const searchHighlightCompartment = new Compartment();
        const typeCompletionCompartment = new Compartment();
        const completionSourceCompartment = new Compartment();

        let extensions: Extension[] = [];

        if (config.vimKeybindings) {
            extensions.push(vim());
        }

        extensions = [
            ...extensions,
            languageCompartment.of([]),
            lineWrappingCompartment.of(config.lineWrapping ? EditorView.lineWrapping : []),
            keyboardSuggestionsCompartment.of(config.allowKeyboardSuggestions ? proseKeyboardAttributes : noKeyboardSuggestions),
            searchMatchHighlightTheme,
            lintTooltipTheme,
            tooltips({ parent: getTooltipHost() }),
            searchHighlightCompartment.of([]),
            typeCompletionCompartment.of([]),
            completionSourceCompartment.of([]),
            highlightActiveLine(),
            lineNumbersCompartment.of(buildLineNumbers(config.lineNumbers !== false)),
            themeCompartment.of([
                syntaxHighlighting(defaultHighlightStyle, { fallback: true })
            ]),
            indentUnitCompartment.of([
                indentUnit.of(buildIndentUnit(config.indentSize ?? 4, !!config.useTabs)),
                EditorState.tabSize.of(config.indentSize ?? 4)
            ]),
            keymap.of([
                ...preventCtrlEnterKeymap,
                ...defaultKeymap,
                ...historyKeymap,
                ...smartIndentWithTab
            ])
        ]

        if (!config.preferPerformance) {
            extensions = [
                ...extensions,
                highlightSelectionMatches(),
                bracketMatching(),
                codeFolding(),
                foldGutter(),
                indentationMarkers(),
            ];
        }

        extensions.push(
            EditorView.updateListener.of((v) => this.#onDocumentUpdated(v)),
            editabilityCompartment.of(buildEditability(!!config.readOnly, config.placeholder)),
            historyCompartment.of(config.readOnly ? [] : history())
        );

        super({
            parent: config.parent,
            extensions
        });

        if (config.tabIndex) {
            this.dom.tabIndex = config.tabIndex;
        }

        this.config = config;
        this.languageCompartment = languageCompartment;
        this.historyCompartment = historyCompartment;
        this.editabilityCompartment = editabilityCompartment;
        this.themeCompartment = themeCompartment;
        this.lineWrappingCompartment = lineWrappingCompartment;
        this.lineNumbersCompartment = lineNumbersCompartment;
        this.hasLineNumbers = config.lineNumbers !== false;
        this.keyboardSuggestionsCompartment = keyboardSuggestionsCompartment;
        this.indentUnitCompartment = indentUnitCompartment;
        this.searchHighlightCompartment = searchHighlightCompartment;
        this.typeCompletionCompartment = typeCompletionCompartment;
        this.completionSourceCompartment = completionSourceCompartment;
    }

    #onDocumentUpdated(v: ViewUpdate) {
        for (const tr of v.transactions) {
            this.sharedHistory?.record(tr);
        }
        if (v.docChanged) {
            this.config.onContentChanged?.();
        }
        for (const listener of this.#updateListeners) listener(v);
    }

    /**
     * Keeps the undo history in `history`, which the editor shares with its host, such as the text
     * note that embeds it. With `null`, the editor keeps a history of its own.
     */
    setSharedHistory(history: SharedHistory | null) {
        if (history === this.sharedHistory) return;

        this.sharedHistory?.detach(this);
        this.sharedHistory = history;
        history?.attach(this);
        this.dispatch({
            effects: [ this.historyCompartment.reconfigure(this.buildHistory(this.state.readOnly)) ]
        });
    }

    /** Undoes or redoes in the shared history. Returns `false` when the editor has none. */
    runSharedHistory(name: "undo" | "redo") {
        if (!this.sharedHistory) return false;

        this.sharedHistory.host[name]();
        return true;
    }

    override destroy() {
        this.sharedHistory?.detach(this);
        this.sharedHistory = null;
        super.destroy();
    }

    private buildHistory(isReadOnly: boolean): Extension {
        if (this.sharedHistory) return sharedHistoryKeys(this);
        return isReadOnly ? [] : history();
    }

    #updateListeners: Array<(v: ViewUpdate) => void> = [];

    /**
     * Subscribe to view updates (doc changes, selection changes, viewport changes, etc.).
     * Returns an unsubscribe function. The listener will not fire after the view is destroyed.
     */
    addUpdateListener(listener: (v: ViewUpdate) => void): () => void {
        this.#updateListeners.push(listener);
        return () => {
            const i = this.#updateListeners.indexOf(listener);
            if (i >= 0) this.#updateListeners.splice(i, 1);
        };
    }

    /**
     * Calls `listener` with the cursor position now and each time it changes. Returns an
     * unsubscribe function.
     */
    addCursorPositionListener(listener: (position: CursorPosition) => void): () => void {
        let { doc, selection, tabSize } = this.state;
        let position = this.getCursorPosition();
        listener(position);

        return this.addUpdateListener(() => {
            const { state } = this;
            // Counting the column is linear in the line, so updates such as scrolling skip it.
            if (state.doc === doc && state.selection === selection && state.tabSize === tabSize) {
                return;
            }
            ({ doc, selection, tabSize } = state);

            const next = this.getCursorPosition();
            if (next.line === position.line && next.column === position.column
                && next.selectionLength === position.selectionLength) {
                return;
            }
            position = next;
            listener(position);
        });
    }

    /**
     * The position of the main cursor, which is the end of the main selection that moves, and the
     * length of the selection.
     */
    getCursorPosition(): CursorPosition {
        const { doc, selection, tabSize } = this.state;
        const { head } = selection.main;
        const line = doc.lineAt(head);
        let selectionLength = 0;
        for (const range of selection.ranges) {
            selectionLength += range.to - range.from;
        }

        return {
            line: line.number,
            column: countColumn(line.text, tabSize, head - line.from) + 1,
            selectionLength
        };
    }

    getText() {
        return this.state.doc.toString();
    }

    /**
     * Returns the currently selected text.
     *
     * If there are multiple selections, all of them will be concatenated.
     */
    getSelectedText() {
        return this.state.selection.ranges
            .map((range) => this.state.sliceDoc(range.from, range.to))
            .join("");
    }

    setText(content: string) {
        this.replaceText(content, false);
    }

    /** Replaces the content with content loaded from elsewhere, outside the undo history. */
    loadText(content: string) {
        this.replaceText(content, true);
    }

    private replaceText(content: string, isLoad: boolean) {
        const transaction = this.state.update({
            changes: {
                from: 0,
                to: this.state.doc.length,
                insert: content || "",
            },
            annotations: Transaction.addToHistory.of(!isLoad)
        });
        // Dispatching a full-document replacement maps the viewport onto the whole new document,
        // which only a measure shrinks back. A hidden editor, such as one in a background tab, is
        // rebuilt from the new state instead, so it does not keep every line rendered.
        if (!this.dom.checkVisibility()) {
            this.setState(transaction.state);
        } else {
            this.dispatch(transaction);
        }
    }

    /**
     * Applies `theme`, at once if an editor has loaded it before, and names it in the
     * `data-theme-name` attribute of `dom`.
     */
    async setTheme(theme: ThemeDefinition) {
        let extension = loadedThemes.get(theme);
        if (!extension) {
            extension = await theme.load();
            loadedThemes.set(theme, extension);
        }
        this.dispatch({
            effects: [ this.themeCompartment.reconfigure([
                extension, EditorView.editorAttributes.of({ "data-theme-name": theme.id })
            ]) ]
        });
    }

    /**
     * Makes the editor read-only or editable without replacing its view. An editable editor starts
     * a new undo history.
     */
    setReadOnly(isReadOnly: boolean) {
        if (isReadOnly === this.state.readOnly) return;

        this.dispatch({
            effects: [
                this.editabilityCompartment.reconfigure(
                    buildEditability(isReadOnly, this.config.placeholder)
                ),
                this.historyCompartment.reconfigure(this.buildHistory(isReadOnly))
            ]
        });
    }

    setLineWrapping(wrapping: boolean) {
        this.dispatch({
            effects: [ this.lineWrappingCompartment.reconfigure(wrapping ? EditorView.lineWrapping : []) ]
        });
    }

    setLineNumbers(isShown: boolean) {
        if (isShown === this.hasLineNumbers) return;

        this.hasLineNumbers = isShown;
        this.dispatch({
            effects: [ this.lineNumbersCompartment.reconfigure(buildLineNumbers(isShown)) ]
        });
    }

    setAllowKeyboardSuggestions(allow: boolean) {
        this.dispatch({
            effects: [ this.keyboardSuggestionsCompartment.reconfigure(allow ? proseKeyboardAttributes : noKeyboardSuggestions) ]
        });
    }

    setIndent(size: number, useTabs: boolean) {
        if (!Number.isFinite(size) || size < 1) size = 4;
        if (size > 16) size = 16;
        this.config.indentSize = size;
        this.config.useTabs = useTabs;
        this.dispatch({
            effects: [ this.indentUnitCompartment.reconfigure([
                indentUnit.of(buildIndentUnit(size, useTabs)),
                EditorState.tabSize.of(size)
            ]) ]
        });
    }

    setIndentSize(size: number) {
        this.setIndent(size, !!this.config.useTabs);
    }

    setUseTabs(useTabs: boolean) {
        this.setIndent(this.config.indentSize ?? 4, useTabs);
    }

    /**
     * Clears the history of undo/redo. Generally useful when changing to a new document.
     */
    clearHistory() {
        if (this.state.readOnly || this.sharedHistory) {
            return;
        }

        this.dispatch({
            effects: [ this.historyCompartment.reconfigure([]) ]
        });
        this.dispatch({
            effects: [ this.historyCompartment.reconfigure(history())]
        });
    }

    scrollToEnd() {
        const endPos = this.state.doc.length;
        this.dispatch({
            selection: EditorSelection.cursor(endPos),
        });
    }

    /** Focuses the editor with the cursor at the start or the end of the document. */
    focusAt(edge: DocumentEdge) {
        const position = edge === "start" ? 0 : this.state.doc.length;
        this.dispatch({ selection: EditorSelection.cursor(position), scrollIntoView: true });
        this.focus();
    }

    /**
     * The edge of the document that the arrow key of `event`, pressed without modifiers, moves
     * the cursor past, or `null` for any other key, while the cursor stays in the document and
     * while the completion list is open.
     */
    getEdgeLeftBy(event: KeyboardEvent): DocumentEdge | null {
        const { ranges, main } = this.state.selection;
        const hasModifier = event.shiftKey || event.ctrlKey || event.altKey || event.metaKey;
        if (event.target !== this.contentDOM || hasModifier || event.isComposing
            || ranges.length > 1 || !main.empty || completionStatus(this.state) === "active"
            || isHostedCompletionShown(this)) {
            return null;
        }

        const length = this.state.doc.length;
        switch (event.key) {
            case "ArrowLeft":
                return main.head === 0 ? "start" : null;
            case "ArrowRight":
                return main.head === length ? "end" : null;
            // The line boundary is the start or end of the visual line, wrapped lines included.
            case "ArrowUp":
                return this.moveToLineBoundary(main, false).head === 0 ? "start" : null;
            case "ArrowDown":
                return this.moveToLineBoundary(main, true).head === length ? "end" : null;
            default:
                return null;
        }
    }

    /**
     * Drops the line-wrap side (`assoc`) of the cursor before the caret leaves the editor. On a
     * focus change, CodeMirror moves the DOM selection to that side, which focuses the editor
     * again.
     */
    prepareToLeave() {
        const { main } = this.state.selection;
        if (!main.empty || !main.assoc) return;

        const cursor = EditorSelection.cursor(main.head);
        this.dispatch({ selection: this.state.selection.replaceRange(cursor) });
    }

    /**
     * Inserts a blank line at the very top of the document and places the cursor on it — the code-note
     * analog of the Notion-like behavior when pressing Enter in the note title. If the first line is
     * already empty, the cursor is simply moved there instead of inserting another blank line, so a
     * brand-new (empty) note does not end up with two blank lines. No-op for read-only editors, since
     * CodeMirror's `readOnly` facet does not block programmatic transactions.
     */
    insertBlankLineAtTop() {
        if (this.state.readOnly) {
            return;
        }
        const firstLineEmpty = this.state.doc.line(1).length === 0;
        this.dispatch({
            ...(firstLineEmpty ? {} : { changes: { from: 0, insert: "\n" } }),
            selection: EditorSelection.cursor(0),
            // Reveal the new top line — the cursor may have been at the bottom of a long note.
            scrollIntoView: true
        });
    }

    /**
     * Highlights the matches of `searchTerm`. While `isActivating`, the match nearest the cursor
     * becomes the active one and scrolls into view.
     */
    async performFind(
        searchTerm: string, matchCase: boolean, wholeWord: boolean, isActivating = true
    ) {
        const plugin = createSearchHighlighter();
        this.dispatch({
            effects: this.searchHighlightCompartment.reconfigure(plugin)
        });

        // Wait for the plugin to activate in the next render cycle
        await new Promise(requestAnimationFrame);
        const instance = this.plugin(plugin);
        instance?.searchFor(searchTerm, matchCase, wholeWord, isActivating);
        this.searchPlugin = instance;

        /* v8 ignore next 4 -- the plugin was just installed via the compartment above and the
           view has re-rendered, so `this.plugin()` always resolves it; the guards only cover a
           view destroyed mid-search. */
        return {
            totalFound: instance?.totalFound ?? 0,
            currentFound: instance?.currentFound ?? 0
        }
    }

    async findNext(direction: number, currentFound: number, nextFound: number) {
        this.searchPlugin?.scrollToMatch(nextFound);
    }

    async replace(replaceText: string) {
        this.searchPlugin?.replaceActiveMatch(replaceText);
    }

    async replaceAll(replaceText: string) {
        this.searchPlugin?.replaceAll(replaceText);
    }

    /** Leaves no match of the search active, keeping every match highlighted. */
    clearActiveMatch() {
        this.searchPlugin?.clearActiveMatch();
    }

    /** The matches of the search, in document order. */
    getSearchMatches() {
        return this.searchPlugin?.matchRanges ?? [];
    }

    cleanSearch() {
        if (this.searchPlugin) {
            this.dispatch({
                effects: this.searchHighlightCompartment.reconfigure([])
            });
            this.searchPlugin = null;
        }
    }

    /**
     * Adds or reconfigures a named extension. If the extension has already been
     * added under this name, it is reconfigured in place (no duplicate config error).
     * This is safe to call repeatedly (e.g. from React effects or during hot-reload).
     */
    setNamedExtension(name: string, ext: Extension) {
        let compartment = this.namedCompartments.get(name);
        if (compartment) {
            this.dispatch({ effects: compartment.reconfigure(ext) });
        } else {
            compartment = new Compartment();
            this.namedCompartments.set(name, compartment);
            this.dispatch({ effects: StateEffect.appendConfig.of(compartment.of(ext)) });
        }
    }

    async setMimeType(mime: string) {
        this.currentMime = mime;
        let newExtension: Extension[] = [];

        const correspondingSyntax = byMimeType[MIME_ALIASES[mime] ?? mime];
        if (correspondingSyntax) {
            const resolvedSyntax = await correspondingSyntax();

            if ("token" in resolvedSyntax) {
                const extension = StreamLanguage.define(resolvedSyntax);
                newExtension.push(extension);
            } else if (Array.isArray(resolvedSyntax)) {
                newExtension = [ ...newExtension, ...resolvedSyntax ];
            } else {
                newExtension.push(resolvedSyntax);
            }
        }

        this.dispatch({
            effects: this.languageCompartment.reconfigure(newExtension)
        });

        await this.#updateTypeCompletion(mime);
    }

    /**
     * Updates the per-note script `api` context (e.g. whether the note is a custom
     * request handler, which gates the `req`/`res`/`pathParams` members) and rebuilds
     * the type completion in place. Safe to call before a MIME type is set — it takes
     * effect on the next `setMimeType`.
     */
    async setScriptApiContext(context: ScriptApiContext) {
        this.scriptApiContext = context;
        if (this.currentMime !== null) {
            await this.#updateTypeCompletion(this.currentMime);
        }
    }

    /**
     * Enables the TypeScript language service (full completion, hover docs and
     * diagnostics) for backend/frontend script notes, and clears it otherwise.
     * A request for the MIME type and context of the latest build joins that build,
     * since a code note's effects request the same one several times on mount.
     */
    #updateTypeCompletion(mime: string) {
        const key = typeCompletionKey(mime, this.scriptApiContext);
        if (this.typeCompletionBuild?.key === key) {
            return this.typeCompletionBuild.done;
        }

        const done = this.#buildTypeCompletion(mime);
        const build = { key, done };
        this.typeCompletionBuild = build;
        // A failed build is not reused, so the next request tries again.
        done.catch(() => {
            if (this.typeCompletionBuild === build) this.typeCompletionBuild = null;
        });
        return done;
    }

    /** Guarded by a token so a slow build for a previous MIME type can't overwrite a newer one. */
    async #buildTypeCompletion(mime: string) {
        const token = ++this.typeCompletionToken;
        const { extensions, complete } = await buildTypeCompletion(mime, this.scriptApiContext);
        if (token !== this.typeCompletionToken) {
            return; // a newer setMimeType call superseded this one
        }
        this.dispatch({
            effects: this.typeCompletionCompartment.reconfigure(extensions)
        });
        this.typeCompleter = complete;
    }

    /** Whether the MIME type has a TypeScript language service for `getTypeCompletions()`. */
    hasTypeCompletions() {
        return this.typeCompleter !== null;
    }

    /**
     * The language service's completions at the caret, best first, or null where it offers none
     * or the MIME type has no language service.
     */
    async getTypeCompletions() {
        return await this.typeCompleter?.(this.state.selection.main.head) ?? null;
    }

    /**
     * Registers (or, with `null`, removes) a named autocompletion source. All
     * registered sources are merged into the editor's single `autocompletion()`
     * extension — CodeMirror permits only one `override` config per editor, so
     * features (snippets, the TypeScript language service, …) contribute sources
     * here rather than each adding their own autocompletion.
     */
    setCompletionSource(name: string, source: CompletionSource | null) {
        if (source) {
            this.completionSources.set(name, source);
        } else {
            this.completionSources.delete(name);
        }
        const sources = [...this.completionSources.values()];
        this.dispatch({
            effects: this.completionSourceCompartment.reconfigure(
                sources.length
                    ? autocompletion({ override: sources, activateOnTyping: true })
                    : []
            )
        });
    }
}

// Vim's `u` and `Ctrl-R` run these commands, which use the shared history of an editor first.
for (const name of [ "undo", "redo" ] as const) {
    const run = VimEditor.commands[name];
    VimEditor.commands[name] = (cm) => {
        if (!(cm.cm6 instanceof CodeMirror && cm.cm6.runSharedHistory(name))) {
            run(cm);
        }
    };
}

const HISTORY_INPUT_TYPES: Record<string, "undo" | "redo" | undefined> = {
    historyUndo: "undo",
    historyRedo: "redo"
};

/** The undo and redo keys and input events of `view`, which run its shared history. */
function sharedHistoryKeys(view: CodeMirror): Extension {
    const undo = () => view.runSharedHistory("undo");
    const redo = () => view.runSharedHistory("redo");
    return [
        Prec.high(keymap.of([
            { key: "Mod-z", run: undo, stopPropagation: true },
            { key: "Mod-y", run: redo, stopPropagation: true },
            { key: "Mod-Shift-z", run: redo, stopPropagation: true }
        ])),
        EditorView.domEventHandlers({
            beforeinput(event) {
                const name = HISTORY_INPUT_TYPES[event.inputType];
                if (!name) return false;

                event.preventDefault();
                return view.runSharedHistory(name);
            }
        })
    ];
}

/** Identifies a type-completion build by its MIME type and the context flags that are set. */
function typeCompletionKey(mime: string, context: ScriptApiContext) {
    const flags = Object.entries(context)
        .filter(([ , value ]) => value)
        .map(([ name ]) => name)
        .sort();
    return [ mime, ...flags ].join(" ");
}

/**
 * Returns the body-level element CodeMirror renders tooltips into, outside `.cm-editor`, whose
 * `overflow: hidden` clips an absolutely positioned tooltip (Safari, iOS).
 */
function getTooltipHost() {
    const existing = document.body.querySelector(".cm-tooltip-host");
    if (existing instanceof HTMLElement) {
        return existing;
    }

    const host = document.createElement("div");
    host.className = "cm-tooltip-host";
    document.body.appendChild(host);
    return host;
}

/** The read-only facet with a hidden caret, or the placeholder of an editable editor. */
function buildEditability(isReadOnly: boolean, placeholderText: string | undefined): Extension {
    if (isReadOnly) return [ EditorState.readOnly.of(true), hiddenCaretTheme ];
    return placeholderText ? placeholder(placeholderText) : [];
}

/**
 * Hides the caret, and the block cursor that Vim draws in its place. `Prec.highest` outranks the
 * `.cm-content` rule of the color theme.
 */
const hiddenCaretTheme = Prec.highest(EditorView.theme({
    ".cm-content": {
        caretColor: "transparent"
    },
    ".cm-vimCursorLayer": {
        display: "none"
    }
}));

/** The extension of each theme that an editor has loaded. */
const loadedThemes = new WeakMap<ThemeDefinition, Extension>();

/**
 * The line numbers with the number of the active line highlighted, or a gutter merged into the
 * code area. The fold markers left in a hidden gutter take no highlight.
 */
function buildLineNumbers(isShown: boolean): Extension {
    return isShown ? [ lineNumbers(), highlightActiveLineGutter() ] : hiddenLineNumbersTheme;
}

/**
 * Merges the gutter, which still holds the fold markers, into the code area while the line
 * numbers are off, and keeps the markers off the edge of the editor. `Prec.highest` outranks the
 * `.cm-gutters` rule of the color theme.
 */
const hiddenLineNumbersTheme = Prec.highest(EditorView.theme({
    ".cm-gutters": {
        border: "none",
        paddingInlineStart: "8px",
        backgroundColor: "transparent"
    }
}));
