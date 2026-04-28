import { Marked, Renderer, type Tokens } from "marked";
import markedFootnote from "marked-footnote";

import { getMimeTypeFromMarkdownName, MIME_TYPE_AUTO, normalizeMimeTypeForCKEditor } from "./mime_type.js";
import {
    createTransclusionExtension,
    createWikiLinkExtension,
    transclusionExtension,
    type TransclusionOptions,
    wikiLinkExtension,
    type WikiLinkOptions
} from "./marked_extensions.js";

/**
 * Mapping from markdown admonition keywords (case-insensitive) to the ids
 * used in the rendered `<aside class="admonition …">` markup. Same set as
 * GitHub's supported admonition callouts.
 */
export const ADMONITION_TYPE_MAPPINGS: Record<string, string> = {
    note: "NOTE",
    tip: "TIP",
    important: "IMPORTANT",
    caution: "CAUTION",
    warning: "WARNING"
};

/** Options for {@link renderToHtml}. */
export interface RenderToHtmlOptions {
    /**
     * HTML sanitizer. Required — each environment plugs in its own:
     *  - server: `sanitize-html` configured with per-option allowed tags
     *  - client: `DOMPurify.sanitize`
     */
    sanitize: (dirtyHtml: string) => string;
    /**
     * How `[[noteId]]` wiki-links should be rendered. Defaults to the
     * server-side format (`href="/noteId"`), which is what imports want.
     * Browser callers that navigate via the hash router should pass
     * `{ formatHref: (id) => `#root/${id}` }`.
     */
    wikiLink?: WikiLinkOptions;
    /** Same as {@link wikiLink}, for `![[noteId]]` transclusions. */
    transclusion?: TransclusionOptions;
    /**
     * If `true` (default), strip the first `<h1>` that matches {@link title}
     * and demote any remaining `<h1>` to `<h2>` — notes render the title as a
     * separate H1 above the content, so double-H1 would otherwise result.
     * Set to `false` when there's no surrounding title (e.g. a live editor
     * preview) so authored H1s are shown as-is.
     */
    demoteH1?: boolean;
    /**
     * Optional custom renderer — defaults to {@link CustomMarkdownRenderer}.
     * Callers that need caller-specific output (e.g. the Markdown live preview
     * suppressing the auto-language fallback on unlabeled fences) can subclass
     * and pass an instance. A fresh instance should be passed per call since
     * marked attaches a parser to the renderer during parsing.
     */
    renderer?: Renderer;
}

function escapeHtml(str: string): string {
    return str
        .replace(/&/g, "&amp;")
        .replace(/</g, "&lt;")
        .replace(/>/g, "&gt;")
        .replace(/"/g, "&quot;")
        .replace(/'/g, "&#39;");
}

const NAMED_ENTITIES: Record<string, string> = {
    amp: "&",
    lt: "<",
    gt: ">",
    quot: '"',
    apos: "'",
    nbsp: "\u00a0"
};

function unescapeHtml(str: string): string {
    return str.replace(/&(#\d+|#x[0-9a-fA-F]+|\w+);/g, (match, entity: string) => {
        if (entity.startsWith("#x") || entity.startsWith("#X")) {
            return String.fromCodePoint(parseInt(entity.slice(2), 16));
        }
        if (entity.startsWith("#")) {
            return String.fromCodePoint(parseInt(entity.slice(1), 10));
        }
        return NAMED_ENTITIES[entity] ?? match;
    });
}

function getNormalizedMimeFromMarkdownLanguage(language: string | undefined): string {
    if (language) {
        const mimeDefinition = getMimeTypeFromMarkdownName(language);
        if (mimeDefinition) {
            return normalizeMimeTypeForCKEditor(mimeDefinition.mime);
        }
    }
    return MIME_TYPE_AUTO;
}

function handleH1(content: string, title: string): string {
    let isFirstH1Handled = false;

    return content.replace(/<h1[^>]*>([^<]*)<\/h1>/gi, (match, text: string) => {
        text = unescapeHtml(text);
        const convertedContent = `<h2>${text}</h2>`;

        if (!isFirstH1Handled) {
            isFirstH1Handled = true;
            return title.trim() === text.trim() ? "" : convertedContent;
        }

        return convertedContent;
    });
}

export function extractCodeBlocks(text: string): { processedText: string; placeholderMap: Map<string, string> } {
    const codeMap = new Map<string, string>();
    let id = 0;
    const timestamp = Date.now();

    text = text
        .replace(/^[ \t]*```[^\n]*\n[\s\S]*?^[ \t]*```[ \t]*$/gm, (m) => {
            const key = `<!--CODE_BLOCK_${timestamp}_${id++}-->`;
            codeMap.set(key, m);
            return key;
        })
        .replace(/`[^`\n]+`/g, (m) => {
            const key = `<!--INLINE_CODE_${timestamp}_${id++}-->`;
            codeMap.set(key, m);
            return key;
        });

    return { processedText: text, placeholderMap: codeMap };
}

function extractFormulas(text: string): { processedText: string; placeholderMap: Map<string, string> } {
    const { processedText: noCodeText, placeholderMap: codeMap } = extractCodeBlocks(text);

    const formulaMap = new Map<string, string>();
    let id = 0;
    const timestamp = Date.now();

    let processedText = noCodeText
        .replace(/(?<!\\)\$\$((?:(?!\n{2,})[\s\S])+?)\$\$/g, (_, formula: string) => {
            const key = `<!--FORMULA_BLOCK_${timestamp}_${id++}-->`;
            formulaMap.set(key, `<span class="math-tex">\\[${formula}\\]</span>`);
            return key;
        })
        .replace(/(?<!\\)\$(.+?)\$/g, (_, formula: string) => {
            const key = `<!--FORMULA_INLINE_${timestamp}_${id++}-->`;
            formulaMap.set(key, `<span class="math-tex">\\(${formula}\\)</span>`);
            return key;
        });

    processedText = restoreFromMap(processedText, codeMap);

    return { processedText, placeholderMap: formulaMap };
}

function restoreFromMap(text: string, map: Map<string, string>): string {
    if (map.size === 0) return text;
    const pattern = [ ...map.keys() ]
        .map((k) => k.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"))
        .join("|");
    return text.replace(new RegExp(pattern, "g"), (match) => map.get(match) ?? match);
}

/**
 * Keep renderer code up to date with https://github.com/markedjs/marked/blob/master/src/Renderer.ts.
 *
 * Exported so callers can subclass and override specific methods (e.g. `code()`) for
 * caller-specific output, then pass the subclass instance through
 * {@link RenderToHtmlOptions.renderer}.
 */
export class CustomMarkdownRenderer extends Renderer {

    override heading(data: Tokens.Heading): string {
        if (data.depth === 1) {
            return `<h1>${data.text}</h1>`;
        }
        return super.heading(data).trimEnd();
    }

    override paragraph(data: Tokens.Paragraph): string {
        return super.paragraph(data).trimEnd();
    }

    override code({ text, lang }: Tokens.Code): string {
        if (!text) return "";

        text = escapeHtml(text).replace(/&quot;/g, '"');

        // `mermaid` isn't in the MIME dictionary, but CKEditor/Trilium's
        // mermaid rewrite specifically looks for `language-mermaid`, so
        // preserve the fence language verbatim instead of falling back to auto.
        const ckEditorLanguage = lang === "mermaid" ? "mermaid" : getNormalizedMimeFromMarkdownLanguage(lang);
        return `<pre><code class="language-${ckEditorLanguage}">${text}</code></pre>`;
    }

    override list(token: Tokens.List): string {
        let result = super.list(token)
            .replace("\n", "")
            .trimEnd();

        if (token.items.some((item) => item.task)) {
            result = result.replace(/^<ul>/, '<ul class="todo-list">');
        }

        return result;
    }

    override checkbox({ checked }: Tokens.Checkbox): string {
        return `<input type="checkbox"${
            checked ? 'checked="checked" ' : ""
        }disabled="disabled">`;
    }

    override listitem(item: Tokens.ListItem): string {
        if (item.task) {
            let itemBody = "";
            const checkbox = this.checkbox({ checked: !!item.checked, raw: "- [ ]", type: "checkbox" });
            if (item.loose) {
                if (item.tokens[0]?.type === "paragraph") {
                    item.tokens[0].text = checkbox + item.tokens[0].text;
                    if (item.tokens[0].tokens && item.tokens[0].tokens.length > 0 && item.tokens[0].tokens[0].type === "text") {
                        item.tokens[0].tokens[0].text = checkbox + escapeHtml(item.tokens[0].tokens[0].text);
                        item.tokens[0].tokens[0].escaped = true;
                    }
                } else {
                    item.tokens.unshift({
                        type: "text",
                        raw: checkbox,
                        text: checkbox,
                        escaped: true
                    });
                }
            } else {
                itemBody += checkbox;
            }

            itemBody += `<span class="todo-list__label__description">${this.parser.parse(item.tokens.filter((t) => t.type !== "checkbox"))}</span>`;
            return `<li><label class="todo-list__label">${itemBody}</label></li>`;
        }

        return super.listitem(item).trimEnd();
    }

    override image(token: Tokens.Image): string {
        return super.image(token).replace(` alt=""`, "");
    }

    override blockquote({ tokens }: Tokens.Blockquote): string {
        const body = this.parser.parse(tokens);

        const admonitionMatch = /^<p>\[\!([A-Z]+)\]/.exec(body);
        if (Array.isArray(admonitionMatch) && admonitionMatch.length === 2) {
            const type = admonitionMatch[1].toLowerCase();

            if (ADMONITION_TYPE_MAPPINGS[type]) {
                const bodyWithoutHeader = body
                    .replace(/^<p>\[\!([A-Z]+)\]\s*/, "<p>")
                    .replace(/^<p><\/p>/, "");

                return `<aside class="admonition ${type}">${bodyWithoutHeader.trim()}</aside>`;
            }
        }

        return `<blockquote>${body}</blockquote>`;
    }

    override codespan({ text }: Tokens.Codespan): string {
        return `<code spellcheck="false">${escapeHtml(text)}</code>`;
    }

}

/**
 * Render markdown to CKEditor-compatible HTML. Produces the same output the
 * server-side `/api/other/render-markdown` endpoint emits, but sanitization is
 * delegated to the caller so this works in both Node and the browser.
 */
export function renderToHtml(content: string, title: string, options: RenderToHtmlOptions): string {
    // Double-escape slashes in math expressions — otherwise the parser consumes them.
    content = content.replaceAll("\\$", "\\\\$");

    const { processedText, placeholderMap: formulaMap } = extractFormulas(content);

    const marked = new Marked({ async: false, gfm: true });
    marked.use(markedFootnote());
    marked.use({
        // Order is important, especially for wikilinks.
        extensions: [
            options.transclusion ? createTransclusionExtension(options.transclusion) : transclusionExtension,
            options.wikiLink ? createWikiLinkExtension(options.wikiLink) : wikiLinkExtension
        ]
    });

    const renderer = options.renderer ?? new CustomMarkdownRenderer({ async: false });
    let html = marked.parse(processedText, { async: false, renderer }) as string;

    html = restoreFromMap(html, formulaMap);

    // h1 handling needs to come before sanitization.
    if (options.demoteH1 !== false) {
        html = handleH1(html, title);
    }
    html = options.sanitize(html);

    // Add a trailing semicolon to CSS styles.
    html = html.replaceAll(/(<(img|figure|col).*?style=".*?)"/g, '$1;"');

    // Remove slash for self-closing tags to match CKEditor's approach.
    html = html.replace(/<(\w+)([^>]*)\s+\/>/g, "<$1$2>");

    // Normalize non-breaking spaces to entity.
    html = html.replaceAll("\u00a0", "&nbsp;");

    return html;
}
