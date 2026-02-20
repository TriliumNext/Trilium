import { defaultKeymap, history, historyKeymap } from "@codemirror/commands";
import { EditorView, highlightActiveLine, keymap, lineNumbers, placeholder, ViewPlugin, ViewUpdate, type EditorViewConfig, KeyBinding } from "@codemirror/view";
import { defaultHighlightStyle, StreamLanguage, syntaxHighlighting, indentUnit, bracketMatching, foldGutter, codeFolding } from "@codemirror/language";
import { Compartment, EditorSelection, EditorState, type Extension } from "@codemirror/state";
import { highlightSelectionMatches } from "@codemirror/search";
import { vim } from "@replit/codemirror-vim";
import { indentationMarkers } from "@replit/codemirror-indentation-markers";
import byMimeType from "./syntax_highlighting.js";
import smartIndentWithTab from "./extensions/custom_tab.js";
import type { ThemeDefinition } from "./color_themes.js";
import { createSearchHighlighter, SearchHighlighter, searchMatchHighlightTheme } from "./find_replace.js";

export { default as ColorThemes, type ThemeDefinition, getThemeById } from "./color_themes.js";

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
    onContentChanged?: ContentChangedListener;
}

export default class CodeMirror extends EditorView {

    private config: EditorConfig;
    private languageCompartment: Compartment;
    private historyCompartment: Compartment;
    private themeCompartment: Compartment;
    private lineWrappingCompartment: Compartment;
    private searchHighlightCompartment: Compartment;
    private searchPlugin?: SearchHighlighter | null;

    constructor(config: EditorConfig) {
        const languageCompartment = new Compartment();
        const historyCompartment = new Compartment();
        const themeCompartment = new Compartment();
        const lineWrappingCompartment = new Compartment();
        const searchHighlightCompartment = new Compartment();

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
            highlightActiveLine(),
            lineNumbers(),
            indentUnit.of(" ".repeat(4)),
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
                themeCompartment.of([
                    syntaxHighlighting(defaultHighlightStyle, { fallback: true })
                ]),
                highlightSelectionMatches(),
                bracketMatching(),
                codeFolding(),
                foldGutter(),
                indentationMarkers(),
            ];
        }

        if (!config.readOnly) {
            // Logic specific to editable notes
            if (config.placeholder) {
                extensions.push(placeholder(config.placeholder));
            }

            if (config.onContentChanged) {
                extensions.push(EditorView.updateListener.of((v) => this.#onDocumentUpdated(v)));
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
        this.searchHighlightCompartment = searchHighlightCompartment;
    }

    #onDocumentUpdated(v: ViewUpdate) {
        if (v.docChanged) {
            this.config.onContentChanged?.();
        }
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

    async setMimeType(mime: string) {
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
    }
}
