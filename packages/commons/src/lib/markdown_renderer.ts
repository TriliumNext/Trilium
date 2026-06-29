import { Marked, type MarkedOptions, Renderer, type Token, type Tokens } from "marked";
import markedFootnote from "marked-footnote";

import { DEFAULT_TASK_STATES, type TaskStateDef } from "./task_states.js";

type TaskListItem = Tokens.ListItem & { _taskState?: string };

function escapeForCharClass(char: string): string {
    return char.replace(/[^\w]/g, (c) => `\\${c}`);
}

function stripTaskMarkerFromTokens(tokens: Token[] | undefined, stripPattern: RegExp): void {
    /* v8 ignore start -- defensive: renderToHtml always passes a non-empty token array */
    if (!tokens || tokens.length === 0) {
        return;
    }
    /* v8 ignore stop */
    const first = tokens[0] as Token & { text?: string; raw?: string; tokens?: Token[] };
    /* v8 ignore start -- defensive: the marker-bearing first token always has string text/raw */
    if (typeof first.text === "string") {
        first.text = first.text.replace(stripPattern, "");
    }
    if (typeof first.raw === "string") {
        first.raw = first.raw.replace(stripPattern, "");
    }
    /* v8 ignore stop */
    if (Array.isArray(first.tokens)) {
        stripTaskMarkerFromTokens(first.tokens, stripPattern);
    }
}

/**
 * Builds a marked `walkTokens` hook that recognises non-standard task markers
 * (e.g. `[/]`, `[-]`, `[?]`) derived from the configured task states — marked
 * itself only understands `[x]`/`[ ]`. A matched item is converted into a task
 * item with `_taskState` carrying the resolved state name for downstream rendering.
 */
function createTaskStateDetector(states: TaskStateDef[]): (token: Token) => void {
    const symbolToName = new Map<string, string>();
    for (const state of states) {
        const symbol = state.markdownSymbol;
        // `x` and ` ` are the native checked/unchecked markers handled by marked.
        if (symbol.length === 1 && symbol !== "x" && symbol !== " ") {
            symbolToName.set(symbol, state.name);
        }
    }

    if (symbolToName.size === 0) {
        return () => {};
    }

    const charClass = [...symbolToName.keys()].map(escapeForCharClass).join("");
    const rawPattern = new RegExp(`^[ \\t]*[-*+]\\s+\\[([${charClass}])\\]\\s?`);
    const stripPattern = new RegExp(`^\\[[${charClass}]\\]\\s?`);

    return (token: Token): void => {
        if (token.type !== "list_item") {
            return;
        }
        const item = token as TaskListItem;
        if (item.task) {
            return;
        }
        const match = rawPattern.exec(item.raw);
        if (!match) {
            return;
        }
        const name = symbolToName.get(match[1]);
        /* v8 ignore start -- defensive: match[1] is always a symbolToName key */
        if (!name) {
            return;
        }
        /* v8 ignore stop */
        item.task = true;
        item.checked = false;
        item._taskState = name;
        item.text = item.text.replace(stripPattern, "");
        stripTaskMarkerFromTokens(item.tokens, stripPattern);
    };
}

import { getMimeTypeFromMarkdownName, MIME_TYPE_AUTO, normalizeMimeTypeForCKEditor } from "./mime_type.js";
import {
    createCommentExtension,
    createHighlightExtension,
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

/**
 * Obsidian ships a much larger set of callout types than the five admonition
 * types Trilium's editor supports. Each extra type (and its Obsidian aliases) is
 * mapped onto the nearest native type. Types that already share a name with a
 * native type (`note`, `tip`, `important`, `caution`, `warning`) are handled by
 * {@link ADMONITION_TYPE_MAPPINGS} and intentionally omitted here.
 *
 * Only consulted when the `obsidian` option is enabled — generic Markdown import
 * keeps GitHub's five-type behaviour.
 */
export const OBSIDIAN_CALLOUT_ALIASES: Record<string, string> = {
    // Neutral / informational
    abstract: "note",
    summary: "note",
    tldr: "note",
    info: "note",
    todo: "note",
    quote: "note",
    cite: "note",
    // Advice / positive outcomes
    hint: "tip",
    success: "tip",
    check: "tip",
    done: "tip",
    question: "tip",
    help: "tip",
    faq: "tip",
    // Emphasis
    example: "important",
    // Mild warnings
    attention: "warning",
    // Errors / severe warnings
    failure: "caution",
    fail: "caution",
    missing: "caution",
    danger: "caution",
    error: "caution",
    bug: "caution"
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
    /**
     * Configured todo task states, used to recognise non-standard task markers
     * (e.g. `[/]`) in list items. Defaults to {@link DEFAULT_TASK_STATES}.
     */
    taskStates?: TaskStateDef[];
    /**
     * Enable Obsidian-specific Markdown syntax: `==highlight==` → `<mark>` and
     * `%% comment %%` → an HTML comment. Off by default so generic Markdown import,
     * paste and the live editor preview are unaffected — only the Obsidian importer
     * opts in.
     */
    obsidian?: boolean;
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

/** Decodes HTML entities in heading text; supplied by each {@link demoteHeadings} caller. */
export type EntityDecoder = (str: string) => string;

/**
 * Trilium reserves `<h1>` for the note title and the editor only supports
 * `<h2>`–`<h6>`. When rendered/imported content starts its hierarchy at `<h1>`,
 * naively demoting every `<h1>` to `<h2>` while leaving `<h2>`–`<h6>` untouched
 * collapses distinct levels onto the same `<h2>`, flattening the nesting (#8383).
 *
 * This strips the leading `<h1>` if it duplicates the title, then — if a content
 * `<h1>` still remains — shifts the whole hierarchy down one level so the author's
 * structure is preserved.
 *
 * The entity decoder is injected so each call-site keeps its own `unescapeHtml`
 * semantics: the markdown renderer (here) decodes numeric/hex/named entities, while
 * the HTML importer decodes only the five basic ones (matching `api.unescapeHtml`).
 */
export function demoteHeadings(
    content: string,
    title: string,
    unescapeHtml: EntityDecoder
): string {
    content = stripDuplicateTitleHeading(content, title, unescapeHtml);

    // If a content <h1> still remains, the hierarchy starts at level 1: shift every
    // heading down one level (clamping at <h6>) so nesting is preserved instead of
    // collapsing distinct <h1>/<h2> levels onto the same <h2>.
    if (/<h1[^>]*>[\s\S]*?<\/h1>/i.test(content)) {
        content = shiftHeadingsDown(content, unescapeHtml);
    }

    return content;
}

/** Removes the first `<h1>` when its (decoded) text equals the note title. */
function stripDuplicateTitleHeading(
    content: string,
    title: string,
    unescapeHtml: EntityDecoder
): string {
    // No `g` flag: only the very first <h1> is a title candidate. `[\s\S]*?` (not
    // `[^<]*`) so headings with inline markup or attributes still match.
    return content.replace(/<h1[^>]*>([\s\S]*?)<\/h1>/i, (match, text: string) =>
        unescapeHtml(text).trim() === title.trim() ? "" : match
    );
}

/**
 * Shifts `<h2>`–`<h5>` to `<h3>`–`<h6>` and the remaining `<h1>` to `<h2>`
 * (preserving attributes and decoding text). `<h6>` stays put — there is no `<h7>`.
 */
function shiftHeadingsDown(content: string, unescapeHtml: EntityDecoder): string {
    // Shift the sub-headings first so the <h1>→<h2> demotion below isn't re-shifted.
    // `[\s\S]*?` matches headings containing inline markup; the captured attributes
    // are carried over to the demoted <h2>.
    return content
        .replace(/<(\/?)h([2-5])\b([^>]*)>/gi, (_match, slash, level, rest) =>
            `<${slash}h${Number(level) + 1}${rest}>`)
        .replace(/<h1([^>]*)>([\s\S]*?)<\/h1>/gi, (_match, attrs, text) =>
            `<h2${attrs}>${unescapeHtml(text)}</h2>`);
}

export function extractCodeBlocks(text: string): { processedText: string; placeholderMap: Map<string, string> } {
    const codeMap = new Map<string, string>();
    let id = 0;
    const timestamp = Date.now();

    // `(?:>[ \t]*)*` allows blockquote prefixes on the fence lines so that fenced
    // code blocks nested in a blockquote (`> ``` `) are still shielded. Otherwise their
    // contents leak into formula extraction, which mangles `$…$` runs like `${VAR}` (#10268).
    // The whole match is restored verbatim before marked parses, so the prefixes are
    // preserved and the blockquote still renders correctly.
    text = text
        .replace(/^[ \t]*(?:>[ \t]*)*```[^\n]*\n[\s\S]*?^[ \t]*(?:>[ \t]*)*```[ \t]*$/gm, (m) => {
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

    // Delimiters must be lone `$` (inline) / `$$` (block) runs — i.e. not adjacent to
    // another `$` — and the body may not contain a `$`. This mirrors GitHub: mismatched
    // runs like `$$e=mc^2$` stay literal text rather than producing a malformed formula
    // (a stray `$` inside the body would otherwise crash KaTeX with "Can't use '$'").
    let processedText = noCodeText
        .replace(/(?<![\\$])\$\$(?!\$)((?:(?!\n{2,})[^$])+?)\$\$(?!\$)/g, (_, formula: string) => {
            const key = `<!--FORMULA_BLOCK_${timestamp}_${id++}-->`;
            formulaMap.set(key, `<span class="math-tex">\\[${formula}\\]</span>`);
            return key;
        })
        .replace(/(?<![\\$])\$(?!\$)([^$\n]+?)\$(?!\$)/g, (_, formula: string) => {
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
    /* v8 ignore next -- defensive: every regex match is a map key, so the ?? fallback is unreachable */
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

    /** Whether to recognise Obsidian's extended callout types, inline titles and fold markers. */
    readonly #obsidianCallouts: boolean;

    constructor(options?: MarkedOptions & { obsidianCallouts?: boolean }) {
        super(options);
        this.#obsidianCallouts = options?.obsidianCallouts ?? false;
    }

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
            const taskState = (item as TaskListItem)._taskState;
            const dataAttr = taskState ? ` data-trilium-task-state="${taskState}"` : "";
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
            return `<li${dataAttr}><label class="todo-list__label">${itemBody}</label></li>`;
        }

        return super.listitem(item).trimEnd();
    }

    override image(token: Tokens.Image): string {
        return super.image(token).replace(` alt=""`, "");
    }

    override table(token: Tokens.Table): string {
        // CKEditor wraps every table in `<figure class="table">`, and its content CSS
        // (`.ck-content .table`) styles that wrapper rather than a bare `<table>`. Without
        // it, imported tables render unstyled in read-only mode until the note is opened in
        // the editor — which re-wraps them on save (#10270). Emit the wrapper here so
        // imported markdown matches CKEditor's structure up front.
        return `<figure class="table">${super.table(token).trimEnd()}</figure>`;
    }

    override blockquote({ tokens }: Tokens.Blockquote): string {
        const body = this.parser.parse(tokens);

        const callout = this.#parseCallout(body);
        if (callout) {
            // Trilium admonitions have no dedicated title slot, so an Obsidian inline
            // title is rendered as a bold lead paragraph.
            const titleHtml = callout.title ? `<p><strong>${callout.title}</strong></p>` : "";
            // Empty admonition (`> [!NOTE]` with no body) — keep a non-breaking space
            // so the callout still renders its title/icon row instead of collapsing.
            const inner = (titleHtml + callout.body) || "&nbsp;";
            return `<aside class="admonition ${callout.type}">${inner}</aside>`;
        }

        return `<blockquote>${body}</blockquote>`;
    }

    /**
     * Detects a `[!type]` callout at the start of a rendered blockquote. Matches the
     * type case-insensitively, drops Obsidian's fold marker (`+`/`-`), and splits off
     * an optional inline title from the body. Returns `null` for plain blockquotes and
     * for callout types that don't resolve to a supported admonition.
     */
    #parseCallout(body: string): { type: string; title: string; body: string } | null {
        const marker = /^<p>\[!([a-zA-Z]+)\]([-+]?)[ \t]*/.exec(body);
        if (!marker) {
            return null;
        }

        const type = this.#resolveAdmonitionType(marker[1].toLowerCase());
        if (!type) {
            return null;
        }

        const rest = body.slice(marker[0].length);
        const newlineIdx = rest.indexOf("\n");
        const paragraphEndIdx = rest.indexOf("</p>");

        let title: string;
        let inner: string;
        if (paragraphEndIdx !== -1 && (newlineIdx === -1 || paragraphEndIdx < newlineIdx)) {
            // The marker paragraph holds only an (optional) title; the body follows it.
            title = rest.slice(0, paragraphEndIdx);
            inner = rest.slice(paragraphEndIdx + "</p>".length);
        } else if (newlineIdx !== -1) {
            // A soft line break splits the title from the body within the marker paragraph.
            title = rest.slice(0, newlineIdx);
            inner = `<p>${rest.slice(newlineIdx + 1)}`;
        } else {
            title = rest;
            inner = "";
        }

        return { type, title: title.trim(), body: inner.trim() };
    }

    /** Resolves a lowercase callout keyword to a supported admonition type, or `null`. */
    #resolveAdmonitionType(type: string): string | null {
        if (ADMONITION_TYPE_MAPPINGS[type]) {
            return type;
        }
        if (this.#obsidianCallouts) {
            return OBSIDIAN_CALLOUT_ALIASES[type] ?? null;
        }
        return null;
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
    const { processedText, placeholderMap: formulaMap } = extractFormulas(content);

    const marked = new Marked({ async: false, gfm: true });
    marked.use(markedFootnote());
    marked.use({ walkTokens: createTaskStateDetector(options.taskStates ?? DEFAULT_TASK_STATES) });
    // Order is important, especially for wikilinks.
    const extensions = [
        options.transclusion ? createTransclusionExtension(options.transclusion) : transclusionExtension,
        options.wikiLink ? createWikiLinkExtension(options.wikiLink) : wikiLinkExtension
    ];
    if (options.obsidian) {
        extensions.push(createHighlightExtension(), createCommentExtension());
    }
    marked.use({ extensions });

    const renderer = options.renderer ?? new CustomMarkdownRenderer({ async: false, obsidianCallouts: options.obsidian });
    let html = marked.parse(processedText, { async: false, renderer }) as string;

    html = restoreFromMap(html, formulaMap);

    // h1 handling needs to come before sanitization.
    if (options.demoteH1 !== false) {
        html = demoteHeadings(html, title, unescapeHtml);
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
