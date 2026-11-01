import { ensureSyntaxTree, type Language } from "@codemirror/language";
import { EditorState } from "@codemirror/state";
import { highlightCode, type Highlighter, tagHighlighter } from "@lezer/highlight";

import { getThemeById } from "./color_themes.js";
import { type PreviewTheme, type PreviewThemeSlot, readPreviewTheme } from "./preview_theme.js";
import { loadLanguage } from "./syntax_highlighting.js";

export {
    buildCodePreviewCss, type PreviewTheme, type PreviewThemeColors, type PreviewThemeSlot,
    readPreviewTheme
} from "./preview_theme.js";

export interface CodePreviewOptions {
    /** The themes of the preview. Every token gets a class per theme. */
    themes: readonly PreviewThemeSlot[];
    /** The language that highlights the code, or `null` to show it plain. */
    language: Language | null;
    isWrapped: boolean;
    /** Whether to number the lines. Defaults to true. */
    hasLineNumbers?: boolean;
}

const DEFAULT_THEME_ID = "default";

/** The time, in milliseconds, after which `highlightLines()` stops parsing. */
const PARSE_TIMEOUT = 1000;

const HTML_ESCAPES: Record<string, string> = {
    "&": "&amp;", "<": "&lt;", ">": "&gt;", "\"": "&quot;"
};

const themes = new Map<string, Promise<PreviewTheme>>();
const languages = new Map<string, Promise<Language | null>>();
const loadedLanguages = new Map<string, Language | null>();

/**
 * Renders `code` as the HTML of a code preview: a `<pre>` with an element per line, which the
 * stylesheet numbers.
 */
export function renderCodePreview(
    code: string,
    { themes, language, isWrapped, hasLineNumbers = true }: CodePreviewOptions
) {
    const text = code.replace(/\r\n?/g, "\n");
    const lines = (language && highlightLines(text, language, themes))
        ?? text.split("\n").map(escapeHtml);
    const className = [
        "code-preview",
        ...(isWrapped ? [ "code-preview-wrap" ] : []),
        ...(hasLineNumbers ? [] : [ "code-preview-no-line-numbers" ])
    ].join(" ");
    const attributes = themes
        .map(({ theme, key }) => ` data-code-theme-${key}="${escapeHtml(theme.id)}"`)
        .join("");
    const digits = String(lines.length).length;
    const content = lines
        .map((line) => `<span class="code-preview-line">${line}</span>`)
        .join("\n");

    return `<pre class="${className}"${attributes} style="--code-preview-digits: ${digits}">`
        + `<code class="code-preview-content">${content}</code></pre>`;
}

/** Loads the theme of `ColorThemes` with the ID `id`, or `defaultHighlightStyle` for another ID. */
export function loadPreviewTheme(id: string) {
    let theme = themes.get(id);
    if (!theme) {
        const definition = getThemeById(id);
        theme = definition
            ? definition.load().then((extension) => readPreviewTheme(id, extension))
            : Promise.resolve(readPreviewTheme(DEFAULT_THEME_ID, []));
        themes.set(id, theme);
    }
    return theme;
}

/** Loads the language that highlights `mime` in a code note, or `null` if it has none. */
export function loadPreviewLanguage(mime: string) {
    let language = languages.get(mime);
    if (!language) {
        language = loadLanguage(mime).then((result) => {
            loadedLanguages.set(mime, result);
            return result;
        });
        languages.set(mime, language);
    }
    return language;
}

/** Returns the language of `mime` once `loadPreviewLanguage()` has loaded it, else `undefined`. */
export function getLoadedPreviewLanguage(mime: string) {
    return loadedLanguages.get(mime);
}

/** Highlights `text` line by line, or returns `null` if the parser runs out of time. */
function highlightLines(text: string, language: Language, slots: readonly PreviewThemeSlot[]) {
    const state = EditorState.create({ doc: text, extensions: language });
    const tree = ensureSyntaxTree(state, state.doc.length, PARSE_TIMEOUT);
    if (!tree) return null;

    const lines: string[] = [];
    let line = "";
    highlightCode(text, tree, slots.map(getHighlighter), (piece, classes) => {
        const escaped = escapeHtml(piece);
        line += classes ? `<span class="${classes}">${escaped}</span>` : escaped;
    }, () => {
        lines.push(line);
        line = "";
    });
    lines.push(line);
    return lines;
}

/** Classes each token with the index of its style in the theme, after `key`. */
function getHighlighter({ theme, key }: PreviewThemeSlot): Highlighter {
    return tagHighlighter(theme.styles.map((style, index) => ({
        tag: style.tag,
        class: `${key}${index}`
    })));
}

function escapeHtml(text: string) {
    return text.replace(/[&<>"]/g, (c) => HTML_ESCAPES[c]);
}
