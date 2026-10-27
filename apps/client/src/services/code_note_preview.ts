import "@triliumnext/codemirror/src/code_preview.css";

import {
    buildCodePreviewCss, loadPreviewLanguage, loadPreviewTheme, type PreviewThemeSlot,
    renderCodePreview
} from "@triliumnext/codemirror/src/code_preview.js";
import { type OptionNames, shouldSyntaxHighlight } from "@triliumnext/commons";

import type FNote from "../entities/fnote.js";
import { CODE_THEME_DEFAULT_PREFIX } from "../widgets/type_widgets/constants.js";
import options from "./options.js";

interface ThemeChoice {
    /** The option with the ID of the theme. */
    option: OptionNames;
    key: string;
    /** The selector the CSS of the theme is nested under. */
    scope?: string;
}

/** The most characters that the keys and the previews in `cache` hold together. */
const CACHE_MAX_LENGTH = 8_000_000;
/** The most characters of one key and preview that `cache` keeps. */
const CACHE_MAX_ENTRY_LENGTH = 1_000_000;

const cache = new Map<string, string>();
let cacheLength = 0;
const mountedThemes = new Set<string>();

/** How a code preview shows its lines. */
export interface CodePreviewLines {
    /** Whether to wrap the lines, over the `#wrapLines` label of the note and the option. */
    isWrapped?: boolean;
    /** Whether to number the lines, over the option. */
    hasLineNumbers?: boolean;
}

/**
 * Renders `content` as CodeMirror shows it in a code note: in the colors of the code note themes,
 * with line numbers unless the option turns them off.
 *
 * @param note the note whose `#wrapLines` label sets the line wrapping, over the option.
 */
export async function renderCodeNotePreview(
    content: string,
    mime: string,
    note?: FNote | null,
    lines: CodePreviewLines = {}
) {
    const [ themes, language ] = await Promise.all([
        Promise.all(getThemeChoices().map(loadSlot)),
        shouldSyntaxHighlight(content) ? loadPreviewLanguage(mime) : null
    ]);
    const isWrapped = lines.isWrapped ?? isLineWrapped(note);
    const hasLineNumbers = lines.hasLineNumbers ?? options.is("codeLineNumbersEnabled");
    const cacheKey = [
        ...themes.map(({ theme, key }) => `${key}:${theme.id}`), mime, isWrapped, hasLineNumbers,
        content
    ].join("\0");

    let html = cache.get(cacheKey);
    if (html === undefined) {
        html = renderCodePreview(content, { themes, language, isWrapped, hasLineNumbers });
        remember(cacheKey, html);
    }

    const template = document.createElement("template");
    template.innerHTML = html;
    return template.content.firstElementChild as HTMLElement;
}

/** The light and dark themes when they follow the app, else the one theme. Print is light. */
function getThemeChoices(): ThemeChoice[] {
    if (glob.device === "print") {
        return [ { option: "codeNoteThemeLight", key: "t" } ];
    }
    if (options.is("codeNoteThemeMatchesApp")) {
        return [
            { option: "codeNoteThemeLight", key: "l", scope: ":where(body:not(.dark-theme))" },
            { option: "codeNoteThemeDark", key: "d", scope: ":where(body.dark-theme)" }
        ];
    }
    return [ { option: "codeNoteTheme", key: "t" } ];
}

/** Loads the theme of `choice`, and adds its CSS to the page the first time. */
async function loadSlot({ option, key, scope }: ThemeChoice): Promise<PreviewThemeSlot> {
    const value = options.get(option) ?? "";
    const id = value.startsWith(CODE_THEME_DEFAULT_PREFIX)
        ? value.slice(CODE_THEME_DEFAULT_PREFIX.length)
        : value;
    const slot = { theme: await loadPreviewTheme(id), key };

    const mountKey = `${key}:${slot.theme.id}`;
    if (!mountedThemes.has(mountKey)) {
        mountedThemes.add(mountKey);
        const style = document.createElement("style");
        style.textContent = buildCodePreviewCss(slot, scope);
        document.head.append(style);
    }
    return slot;
}

function isLineWrapped(note: FNote | null | undefined) {
    const label = note?.getLabelValue("wrapLines");
    return label == null ? options.is("codeLineWrapEnabled") : label !== "false";
}

/** Caches `html` under `key`, and drops the oldest previews that no longer fit the budget. */
function remember(key: string, html: string) {
    const length = key.length + html.length;
    if (length > CACHE_MAX_ENTRY_LENGTH) return;

    for (const [ oldKey, oldHtml ] of cache) {
        if (cacheLength + length <= CACHE_MAX_LENGTH) break;
        cache.delete(oldKey);
        cacheLength -= oldKey.length + oldHtml.length;
    }
    cache.set(key, html);
    cacheLength += length;
}
