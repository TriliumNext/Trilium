interface EditorConfig {
    /** Loads highlight.js with the language `mimeType`, a code block's `language`. */
    loadHighlightJs(mimeType: string): Promise<HighlightJs>;
    mapLanguageName(mimeType: string): string;
    defaultMimeType: string;
    enabled: boolean;
}

// TODO: Replace once library loader is replaced with webpack.
interface HighlightJs {
    highlightAuto(text: string): HighlightJsResult;
    highlight(text: string, opts: {
        language: string
    }): HighlightJsResult;
};

interface HighlightJsResult {
    value: string;
}

