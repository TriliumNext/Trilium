import { defaultKeymap, history, historyKeymap } from "@codemirror/commands";
import { EditorView, highlightActiveLine, keymap, lineNumbers, placeholder, ViewPlugin, ViewUpdate, type EditorViewConfig, KeyBinding } from "@codemirror/view";
import { defaultHighlightStyle, StreamLanguage, syntaxHighlighting, indentUnit, bracketMatching, foldGutter, codeFolding } from "@codemirror/language";
import { Compartment, EditorSelection, EditorState, StateEffect, type Extension } from "@codemirror/state";
import { highlightSelectionMatches } from "@codemirror/search";
import { autocompletion, type CompletionSource } from "@codemirror/autocomplete";
import { vim } from "@replit/codemirror-vim";
import { indentationMarkers } from "@replit/codemirror-indentation-markers";
import byMimeType from "./syntax_highlighting.js";
import smartIndentWithTab from "./extensions/custom_tab.js";
import type { ThemeDefinition } from "./color_themes.js";
import { createSearchHighlighter, SearchHighlighter, searchMatchHighlightTheme } from "./find_replace.js";
import { buildTypeCompletion, type ScriptApiContext } from "./type_completion/index.js";

export { default as ColorThemes, type ThemeDefinition, type ThemeVariant, getThemeById } from "./color_themes.js";
export { isScriptMime, type ScriptApiContext, SCRIPT_MIME_BACKEND, SCRIPT_MIME_FRONTEND } from "./type_completion/index.js";

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

type ContentChangedListener = () => void;

export interface EditorConfig {
    parent: HTMLElement;
    placeholder?: string;
    lineWrapping?: boolean;
    vimKeybindings?: boolean;
    readOnly?: boolean;
    /** Disables some of the nice-to-have features (bracket matching, syntax highlighting, indentation markers) in order to improve performance. */
    preferPerformance?: boolean;
    tabIndex?: number;
    /** The number of spaces used for indentation (also used as the tab display width). Defaults to 4. */
    indentSize?: number;
    /** If true, indent using a tab character instead of spaces. Defaults to false. */
    useTabs?: boolean;
    onContentChanged?: ContentChangedListener;
}

function buildIndentUnit(indentSize: number, useTabs: boolean) {
    return useTabs ? "\t" : " ".repeat(indentSize);
}

export default class CodeMirror extends EditorView {

    private config: EditorConfig;
    private languageCompartment: Compartment;
    private historyCompartment: Compartment;
    private themeCompartment: Compartment;
    private lineWrappingCompartment: Compartment;
    private indentUnitCompartment: Compartment;
    private searchHighlightCompartment: Compartment;
    private typeCompletionCompartment: Compartment;
    private completionSourceCompartment: Compartment;
    private searchPlugin?: SearchHighlighter | null;
    private namedCompartments = new Map<string, Compartment>();
    /** Named completion sources aggregated into the editor's single autocompletion. */
    private completionSources = new Map<string, CompletionSource>();
    /** Monotonic token guarding against out-of-order async type-completion updates. */
    private typeCompletionToken = 0;
    /** Current MIME type, retained so the type completion can be rebuilt when only the api context changes. */
    private currentMime: string | null = null;
    /** Per-note context tuning the script `api` surface (e.g. custom-request-handler members). */
    private scriptApiContext: ScriptApiContext = {};

    constructor(config: EditorConfig) {
        const languageCompartment = new Compartment();
        const historyCompartment = new Compartment();
        const themeCompartment = new Compartment();
        const lineWrappingCompartment = new Compartment();
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
            searchMatchHighlightTheme,
            searchHighlightCompartment.of([]),
            typeCompletionCompartment.of([]),
            completionSourceCompartment.of([]),
            highlightActiveLine(),
            lineNumbers(),
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

        extensions.push(EditorView.updateListener.of((v) => this.#onDocumentUpdated(v)));

        if (!config.readOnly) {
            // Logic specific to editable notes
            if (config.placeholder) {
                extensions.push(placeholder(config.placeholder));
            }

            extensions.push(historyCompartment.of(history()));
        } else {
            // Logic specific to read-only notes
            extensions.push(EditorState.readOnly.of(true));
        }

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
        this.themeCompartment = themeCompartment;
        this.lineWrappingCompartment = lineWrappingCompartment;
        this.indentUnitCompartment = indentUnitCompartment;
        this.searchHighlightCompartment = searchHighlightCompartment;
        this.typeCompletionCompartment = typeCompletionCompartment;
        this.completionSourceCompartment = completionSourceCompartment;
    }

    #onDocumentUpdated(v: ViewUpdate) {
        if (v.docChanged) {
            this.config.onContentChanged?.();
        }
        for (const listener of this.#updateListeners) listener(v);
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
        this.dispatch({
            changes: {
                from: 0,
                to: this.state.doc.length,
                insert: content || "",
            }
        })
    }

    async setTheme(theme: ThemeDefinition) {
        const extension = await theme.load();
        this.dispatch({
            effects: [ this.themeCompartment.reconfigure([ extension ]) ]
        });
    }

    setLineWrapping(wrapping: boolean) {
        this.dispatch({
            effects: [ this.lineWrappingCompartment.reconfigure(wrapping ? EditorView.lineWrapping : []) ]
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
        if (this.config.readOnly) {
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

    async performFind(searchTerm: string, matchCase: boolean, wholeWord: boolean) {
        const plugin = createSearchHighlighter();
        this.dispatch({
            effects: this.searchHighlightCompartment.reconfigure(plugin)
        });

        // Wait for the plugin to activate in the next render cycle
        await new Promise(requestAnimationFrame);
        const instance = this.plugin(plugin);
        instance?.searchFor(searchTerm, matchCase, wholeWord);
        this.searchPlugin = instance;

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

        const correspondingSyntax = byMimeType[mime];
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
     * Guarded by a token so a slow async build for a previous MIME type can't
     * overwrite a newer one.
     */
    async #updateTypeCompletion(mime: string) {
        const token = ++this.typeCompletionToken;
        const { extensions, source } = await buildTypeCompletion(mime, this.scriptApiContext);
        if (token !== this.typeCompletionToken) {
            return; // a newer setMimeType call superseded this one
        }
        this.dispatch({
            effects: this.typeCompletionCompartment.reconfigure(extensions)
        });
        this.setCompletionSource("typescript", source);
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
