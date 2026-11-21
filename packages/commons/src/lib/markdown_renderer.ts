import { Marked, type MarkedOptions, Renderer, type Token, type Tokens } from "marked";
import markedFootnote from "marked-footnote";

import { BLOCK_ID_ATTRIBUTE, removeBlockMarkers, stripBlockMarkers } from "./block_reference.js";
import { CONTAINER_PREFIX_SOURCE, walkBlockTokens } from "./markdown_source.js";
import { DEFAULT_TASK_STATES, type TaskStateDef } from "./task_states.js";
import { decodeHtmlEntities, escapeHtml } from "./utils.js";

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
    type BlockIdFields,
    type BlockMarkerToken,
    createBlockMarkerExtensions,
    createCommentExtension,
    createHighlightExtension,
    createLiteralTildeExtension,
    createTabsExtensions,
    createTransclusionExtension,
    createWikiLinkExtension,
    getBlockAttributes,
    isReferencedBlock,
    SOURCE_BLOCK_ATTRIBUTE,
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
     * Enable Obsidian-specific Markdown syntax: `%% comment %%` → an HTML comment,
     * plus Obsidian callouts. Off by default so generic Markdown import, paste and
     * the live editor preview are unaffected — only the Obsidian importer opts in.
     *
     * Note that `==highlight==` is *not* gated on this: it is supported everywhere,
     * since it is the de-facto standard highlight syntax outside of GFM.
     */
    obsidian?: boolean;
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
    if (H1.test(content)) {
        content = shiftHeadingsDown(content, unescapeHtml);
    }

    return content;
}

/**
 * Removes the first `<h1>` when its (decoded) text equals the note title. An `<h1>` with a block id
 * stays, to be demoted: references point at it.
 */
function stripDuplicateTitleHeading(
    content: string,
    title: string,
    unescapeHtml: EntityDecoder
): string {
    // No `g` flag: only the very first <h1> is a title candidate.
    return content.replace(H1, (match, attributes: string, text: string) => {
        const isTitle = unescapeHtml(text).trim() === title.trim();
        return isTitle && !attributes.includes(BLOCK_ID_ATTRIBUTE) ? "" : match;
    });
}

/**
 * Shifts `<h2>`–`<h5>` to `<h3>`–`<h6>` and the remaining `<h1>` to `<h2>`
 * (preserving attributes and decoding text). `<h6>` stays put — there is no `<h7>`.
 */
function shiftHeadingsDown(content: string, unescapeHtml: EntityDecoder): string {
    // Shift the sub-headings first so the <h1>→<h2> demotion below isn't re-shifted.
    // The captured attributes are carried over to the demoted <h2>.
    return content
        .replace(/<(\/?)h([2-5])\b([^>]*)>/gi, (_match, slash, level, rest) =>
            `<${slash}h${Number(level) + 1}${rest}>`)
        .replace(ALL_H1, (_match, attrs, text) =>
            `<h2${attrs}>${unescapeHtml(text)}</h2>`);
}

/**
 * An `<h1>`, its attributes and its text, which can hold inline markup but no `<h…>` tag: a match
 * from an `<h1>` that is never closed then ends at the next heading, not at the end of the content.
 * A quoted attribute value can hold `<` and `>`, and ends at the next heading too.
 */
const H1 = /<h1((?:[^<>"']|"(?:[^"<]|<(?!h))*"|'(?:[^'<]|<(?!h))*')*)>((?:[^<]|<[^h<])*?)<\/h1>/i;
const ALL_H1 = new RegExp(H1.source, "gi");

/**
 * Replaces the fenced code blocks and the code spans of `text` with placeholders, so that formula
 * extraction leaves their dollars alone. `placeholderMap` holds the text of each.
 */
export function extractCodeBlocks(text: string): { processedText: string; placeholderMap: Map<string, string> } {
    const codeMap = new Map<string, string>();
    let id = 0;
    const blockPrefix = getPlaceholderPrefix(text, "CODE_BLOCK");
    const inlinePrefix = getPlaceholderPrefix(text, "INLINE_CODE");

    let withoutBlocks = "";
    let position = 0;
    for (const { from, to } of findFencedCodeBlocks(text)) {
        const key = `${blockPrefix}${id++}-->`;
        codeMap.set(key, text.slice(from, to));
        withoutBlocks += text.slice(position, from) + key;
        position = to;
    }
    const processedText = (withoutBlocks + text.slice(position))
        .replace(/`[^`\n]+`/g, (m) => {
            const key = `${inlinePrefix}${id++}-->`;
            codeMap.set(key, m);
            return key;
        });

    return { processedText, placeholderMap: codeMap };
}

/**
 * Replaces the formulas of `text` with placeholders. `placeholderMap` holds the HTML of each,
 * `sourceMap` the text it replaced.
 */
function extractFormulas(text: string) {
    const { processedText: noCodeText, placeholderMap: codeMap } = extractCodeBlocks(text);

    const formulaMap = new Map<string, string>();
    const sourceMap = new Map<string, string>();
    let id = 0;
    const blockPrefix = getPlaceholderPrefix(text, "FORMULA_BLOCK");
    const inlinePrefix = getPlaceholderPrefix(text, "FORMULA_INLINE");

    // Delimiters must be lone `$` (inline) / `$$` (block) runs — i.e. not adjacent to
    // another `$` — and the body may not contain a `$`. This mirrors GitHub: mismatched
    // runs like `$$e=mc^2$` stay literal text rather than producing a malformed formula
    // (a stray `$` inside the body would otherwise crash KaTeX with "Can't use '$'").
    // As in Pandoc, an inline opening `$` is followed by a non-space character and the closing
    // `$` follows a non-space character and is not followed by a digit, so prices such as
    // `$15 and $6` stay literal text.
    const blockFormula = /(?<![\\$])\$\$(?!\$)((?:(?!\n{2,})[^$])+?)\$\$(?!\$)/g;
    const inlineFormula = /(?<![\\$])\$(?![\s$])([^$\n]*?[^\s$])\$(?![$\d])/g;
    let processedText = noCodeText
        .replace(blockFormula, (match, formula: string) => {
            const key = `${blockPrefix}${id++}-->`;
            formulaMap.set(key, `<span class="math-tex">\\[${escapeMathFormula(formula)}\\]</span>`);
            sourceMap.set(key, restoreFromMap(match, codeMap));
            return key;
        })
        .replace(inlineFormula, (match, formula: string) => {
            const key = `${inlinePrefix}${id++}-->`;
            formulaMap.set(key, `<span class="math-tex">\\(${escapeMathFormula(formula)}\\)</span>`);
            sourceMap.set(key, restoreFromMap(match, codeMap));
            return key;
        });

    processedText = restoreFromMap(processedText, codeMap);

    return { processedText, placeholderMap: formulaMap, sourceMap };
}

/**
 * Escapes the HTML-significant characters (`&`, `<`, `>`) in a math formula body.
 *
 * The formula is restored into the HTML string *before* sanitization, so a raw `<`
 * (e.g. `k<K`) would be parsed as the start of an HTML tag and the sanitizer would
 * strip everything after it, truncating the equation (#10418). Escaping matches how
 * CKEditor serializes the equation (a text node, so quotes are intentionally left
 * untouched) and round-trips cleanly back into the editor.
 */
function escapeMathFormula(formula: string): string {
    return formula
        .replace(/&/g, "&amp;")
        .replace(/</g, "&lt;")
        .replace(/>/g, "&gt;");
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
 * The start of the placeholders named `name` in `text`: the first that `text` does not hold. The
 * same text gets the same placeholders, so two renders of a note can be compared.
 */
function getPlaceholderPrefix(text: string, name: string) {
    let salt = 0;
    while (text.includes(`<!--${name}_${salt}_`)) {
        salt++;
    }
    return `<!--${name}_${salt}_`;
}

/**
 * The fenced code blocks of `text`, from the start of the line of the opening fence to the end of
 * the closing fence. As in CommonMark, a fence is a run of three or more backticks or tildes, and
 * only a run of the same character at least as long closes it. A fence in a quote or a list item
 * closes only inside it, and a fence outside any container that is never closed runs to the end of
 * the text. The prefixes of quotes and list items are kept in the block, so that they are restored
 * with it (#10268).
 */
function findFencedCodeBlocks(text: string) {
    const lines = getLines(text);
    const blocks: { from: number; to: number }[] = [];
    for (let index = 0; index < lines.length; index++) {
        const opening = OPENING_FENCE.exec(lines[index].text);
        if (!opening) {
            continue;
        }
        const [ , prefix, fence ] = opening;
        const closing = findClosingFence(lines, index, prefix, fence);
        if (closing !== null) {
            blocks.push({ from: lines[index].start, to: lines[closing].end });
            index = closing;
        } else if (TOP_LEVEL_INDENT.test(prefix)) {
            blocks.push({ from: lines[index].start, to: text.length });
            break;
        }
    }
    return blocks;
}

/**
 * The index of the line that closes the fence `fence` of `lines[opening]`, or `null` when the
 * quotes and the list item of its `prefix` end first: at a line with fewer quote markers, or at a
 * line of text indented less than the content of the list item.
 */
function findClosingFence(lines: Line[], opening: number, prefix: string, fence: string) {
    const quoteCount = prefix.split(">").length - 1;
    const afterQuotes = prefix.slice(prefix.lastIndexOf(">") + 1);
    const contentIndent = /\S/.test(afterQuotes) ? afterQuotes.length : 0;

    for (let index = opening + 1; index < lines.length; index++) {
        const { text } = lines[index];
        const rest = stripQuoteMarkers(text, quoteCount);
        if (rest === null) {
            return null;
        }
        if (rest.trim() && rest.length - rest.trimStart().length < contentIndent) {
            return null;
        }
        const run = CLOSING_FENCE.exec(text)?.[1];
        if (run?.[0] === fence[0] && run.length >= fence.length) {
            return index;
        }
    }
    return null;
}

/** `line` after its first `count` quote markers, or `null` when it has fewer. */
function stripQuoteMarkers(line: string, count: number) {
    let rest = line;
    for (let marker = 0; marker < count; marker++) {
        const match = QUOTE_MARKER.exec(rest);
        if (!match) {
            return null;
        }
        rest = rest.slice(match[0].length);
    }
    return rest;
}

/** A line of a text, and where it starts and ends. */
interface Line {
    text: string;
    start: number;
    end: number;
}

/** The lines of `text`, and where each starts and ends. */
function getLines(text: string) {
    const lines: Line[] = [];
    let start = 0;
    for (const line of text.split("\n")) {
        lines.push({ text: line, start, end: start + line.length });
        start += line.length + 1;
    }
    return lines;
}

/**
 * A line that opens a fence, after the prefixes of the quotes and list items that hold it. The
 * info string of a backtick fence holds no backtick.
 */
const OPENING_FENCE = new RegExp(`^(${CONTAINER_PREFIX_SOURCE})(\`{3,}(?=[^\`]*$)|~{3,})`);
/** A line that can close a fence: indentation, quote markers, then the run of the fence alone. */
const CLOSING_FENCE = /^[ \t]*(?:>[ \t]*)*(`{3,}|~{3,})[ \t]*\r?$/;
/** A quote marker at the start of a line, after its indentation. */
const QUOTE_MARKER = /^[ \t]*>/;
/** The indentation of a fence outside any container. */
const TOP_LEVEL_INDENT = /^ {0,3}$/;

/** Drops the checkbox marked's lexer unshifts among a loose task item's inline tokens. */
function dropCheckboxes(tokens: Token[] | undefined): Token[] {
    /* v8 ignore next -- defensive: marked always lexes a paragraph's inline tokens */
    return (tokens ?? []).filter((token) => token.type !== "checkbox");
}

/** Matches an item whose raw text ends in a blank line, i.e. one the next item is spaced away from. */
const BLANK_LINE_AT_END = /\n[ \t]*\n$/;

/** What CKEditor downcasts for the empty paragraph that separates two lists. */
const EMPTY_PARAGRAPH = "<p>&nbsp;</p>";

/** The position of an aside written as a bare `<aside>` in Markdown, the default of a new aside. */
export const BARE_ASIDE_POSITION = "wrap-right";

/** The background color of an aside written as a bare `<aside>` in Markdown, as of a new aside. */
export const BARE_ASIDE_BACKGROUND = "#555555";

/** The style of an aside written as a bare `<aside>`, as the text editor saves it. */
export const BARE_ASIDE_STYLE =
    `--tn-background:${BARE_ASIDE_BACKGROUND};background-color:${BARE_ASIDE_BACKGROUND};`;

/**
 * Matches the opening tag of an aside alone in its HTML block, followed by its closing tag when the
 * aside is empty. Group 1 is set for `data-position="center"`, an aside in the flow.
 */
const LONE_ASIDE = /^<aside(\s+data-position="center")?\s*>(\s*<\/aside>)?$/i;

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

    /**
     * Configured state name → definition. Consulted by {@link listitem} to attach
     * the state's `title` (human-readable name) as an HTML `title` attribute on
     * the emitted `<li>`, matching the CKEditor data downcast — so shared,
     * read-only and exported HTML all show the same native tooltip on the
     * task item ("Doing", "Cancelled", …) when hovered.
     */
    readonly #stateByName: Map<string, TaskStateDef>;

    constructor(options?: MarkedOptions & { obsidianCallouts?: boolean; taskStates?: TaskStateDef[] }) {
        super(options);
        this.#obsidianCallouts = options?.obsidianCallouts ?? false;
        this.#stateByName = new Map(
            (options?.taskStates ?? DEFAULT_TASK_STATES).map((state) => [state.name, state])
        );
    }

    override heading(data: Tokens.Heading): string {
        const attributes = getBlockAttributes(data);
        if (data.depth === 1) {
            // An H1 is written from its raw text, so its markers are taken out here.
            return `<h1${attributes}>${stripBlockMarkers(data.text)}</h1>`;
        }
        return withAttributes(super.heading(data).trimEnd(), attributes);
    }

    override paragraph(data: Tokens.Paragraph): string {
        return withAttributes(super.paragraph(data).trimEnd(), getBlockAttributes(data));
    }

    override text(token: Tokens.Text | Tokens.Escape): string {
        const html = super.text(token);
        // The text of a list item with a block id is a paragraph, as the text editor saves it.
        return isReferencedBlock(token) ? `<p${getBlockAttributes(token)}>${html}</p>` : html;
    }

    override code(token: Tokens.Code): string {
        if (!token.text) return "";

        // A code block's text holds no final newline, so the one that ends the token goes, as
        // marked's own renderer drops it before adding one back.
        const text = escapeHtml(token.text.replace(/\n$/, "")).replace(/&quot;/g, '"');

        // `mermaid` isn't in the MIME dictionary, but CKEditor/Trilium's
        // mermaid rewrite specifically looks for `language-mermaid`, so
        // preserve the fence language verbatim instead of falling back to auto.
        const ckEditorLanguage = token.lang === "mermaid"
            ? "mermaid"
            : getNormalizedMimeFromMarkdownLanguage(token.lang);
        const attributes = getBlockAttributes(token);
        return `<pre><code class="language-${ckEditorLanguage}"${attributes}>${text}</code></pre>`;
    }

    override hr(token: Tokens.Hr): string {
        return `<hr${getBlockAttributes(token)}>\n`;
    }

    override list(token: Tokens.List): string {
        if (!token.ordered && token.items.some((item) => item.task)) {
            return this.#taskLists(token);
        }

        return super.list(token)
            .replace("\n", "")
            .trimEnd();
    }

    override checkbox({ checked }: Tokens.Checkbox): string {
        return `<input type="checkbox"${
            checked ? ' checked="checked"' : ""
        } disabled="disabled">`;
    }

    override listitem(item: Tokens.ListItem): string {
        if (!item.task) {
            return super.listitem(item).trimEnd();
        }

        const taskState = (item as TaskListItem)._taskState;
        const dataAttr = taskState ? ` data-trilium-task-state="${taskState}"` : "";
        // Native hover tooltip on the `<li>` — matches the CKEditor data
        // downcast, so shared / read-only / exported HTML all surface the
        // state's human-readable title when the task item is hovered.
        // Skipped when the state has no definition in the current config.
        const stateDef = taskState ? this.#stateByName.get(taskState) : undefined;
        const titleText = stateDef?.title || stateDef?.name;
        const titleAttr = titleText ? ` title="${escapeHtml(titleText)}"` : "";
        const checkbox = this.checkbox({ checked: !!item.checked, raw: "- [ ]", type: "checkbox" });

        // CKEditor reads the first block as the label's description and every later block
        // as a sibling of `</label>`. A loose item wraps that first block in a `paragraph`,
        // whose `<p>` has to go: `todoItemInputConverter` only upcasts an `<input>` that
        // opens the item, and `.todo-list__label > input` only styles a direct child of
        // the label.
        const blocks = item.tokens.filter(
            (token) => token.type !== "checkbox" && token.type !== "space"
        );
        const [first, ...rest] = blocks;
        const restHtml = rest.length > 0 ? this.parser.parse(rest) : "";

        // A first block with an id is a paragraph after a label of its own, as the text editor
        // saves a block with an attribute other than those of the list.
        if ((first?.type === "paragraph" || first?.type === "text") && isReferencedBlock(first)) {
            const text = this.parser.parseInline(dropCheckboxes(first.tokens));
            return `<li${dataAttr}${titleAttr}>`
                + `<label class="todo-list__label todo-list__label_without-description">`
                + `${checkbox}</label><p${getBlockAttributes(first)}>${text}</p>${restHtml}</li>`;
        }

        const description = first?.type === "paragraph"
            ? this.parser.parseInline(dropCheckboxes(first.tokens))
            : this.parser.parse(blocks.slice(0, 1));

        return `<li${dataAttr}${titleAttr}><label class="todo-list__label">${checkbox}`
            + `<span class="todo-list__label__description">${description}</span></label>`
            + `${restHtml}</li>`;
    }

    /**
     * Renders an unordered list holding task items, opening a new `<ul>` at every blank
     * line between two items. CKEditor has no loose-list form, and the Markdown export
     * writes exactly this blank line for two todo lists separated by an empty paragraph,
     * so importing it back rebuilds the same lists.
     */
    #taskLists(token: Tokens.List): string {
        const groups: Tokens.ListItem[][] = [[]];
        for (const item of token.items) {
            groups[groups.length - 1].push(item);
            if (BLANK_LINE_AT_END.test(item.raw)) {
                groups.push([]);
            }
        }

        return groups
            .filter((group) => group.length > 0)
            .map((group) => {
                const className = group.some((item) => item.task) ? ` class="todo-list"` : "";
                return `<ul${className}>${group.map((item) => this.listitem(item)).join("")}</ul>`;
            })
            .join(EMPTY_PARAGRAPH);
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
        const attributes = getBlockAttributes(token);
        return `<figure class="table"${attributes}>${super.table(token).trimEnd()}</figure>`;
    }

    override blockquote(token: Tokens.Blockquote): string {
        const body = this.parser.parse(token.tokens);
        const attributes = getBlockAttributes(token);

        const callout = this.#parseCallout(body);
        if (callout) {
            // Trilium admonitions have no dedicated title slot, so an Obsidian inline
            // title is rendered as a bold lead paragraph.
            const titleHtml = callout.title
                ? `<p${callout.titleAttributes}><strong>${callout.title}</strong></p>`
                : "";
            // Empty admonition (`> [!NOTE]` with no body) — keep a non-breaking space
            // so the callout still renders its title/icon row instead of collapsing.
            const inner = (titleHtml + callout.body) || "&nbsp;";
            return `<aside class="admonition ${callout.type}"${attributes}>${inner}</aside>`;
        }

        return `<blockquote${attributes}>${body}</blockquote>`;
    }

    /**
     * Detects a `[!type]` callout at the start of a rendered blockquote. Matches the
     * type case-insensitively, drops Obsidian's fold marker (`+`/`-`), and splits off
     * an optional inline title from the body. Returns `null` for plain blockquotes and
     * for callout types that don't resolve to a supported admonition.
     *
     * The attributes of the marker paragraph, such as its block id, go to the paragraph that
     * keeps its text: the body paragraph when a line break splits it, else the title.
     */
    #parseCallout(body: string) {
        const marker = /^<p((?:\s[^>]*)?)>\[!([a-zA-Z]+)\]([-+]?)[ \t]*/.exec(body);
        if (!marker) {
            return null;
        }

        const [ prefix, attributes, keyword ] = marker;
        const type = this.#resolveAdmonitionType(keyword.toLowerCase());
        if (!type) {
            return null;
        }

        const rest = body.slice(prefix.length);
        const newlineIdx = rest.indexOf("\n");
        const paragraphEndIdx = rest.indexOf("</p>");

        let title: string;
        let titleAttributes = attributes;
        let inner: string;
        if (paragraphEndIdx !== -1 && (newlineIdx === -1 || paragraphEndIdx < newlineIdx)) {
            // The marker paragraph holds only an (optional) title; the body follows it.
            title = rest.slice(0, paragraphEndIdx);
            inner = rest.slice(paragraphEndIdx + "</p>".length);
        } else if (newlineIdx !== -1) {
            // A soft line break splits the title from the body within the marker paragraph.
            title = rest.slice(0, newlineIdx);
            titleAttributes = "";
            inner = `<p${attributes}>${rest.slice(newlineIdx + 1)}`;
        } else {
            title = rest;
            inner = "";
        }

        return { type, title: title.trim(), titleAttributes, body: inner.trim() };
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
        return `<code>${escapeHtml(text)}</code>`;
    }

    /**
     * Gives a bare `<aside>` the position and the background color of a new aside, and drops
     * `data-position="center"`, which the editor does not save. Only a tag alone in its HTML block
     * counts: its content is Markdown. An aside of raw text, such as a Notion callout, stays in the
     * flow.
     */
    override html(token: Tokens.HTML | Tokens.Tag): string {
        const html = super.html(token);
        const aside = token.block ? LONE_ASIDE.exec(html) : null;
        if (!aside) {
            return html;
        }

        const [ , isInFlow, closingTag = "" ] = aside;
        const attributes = isInFlow
            ? ""
            : ` style="${BARE_ASIDE_STYLE}" data-position="${BARE_ASIDE_POSITION}"`;
        return `<aside${attributes}>${closingTag}`;
    }

}

/**
 * Render markdown to CKEditor-compatible HTML. Produces the same output the
 * server-side `/api/other/render-markdown` endpoint emits, but sanitization is
 * delegated to the caller so this works in both Node and the browser.
 */
export function renderToHtml(content: string, title: string, options: RenderToHtmlOptions): string {
    return runMarkdownPass(content, title, options).html;
}

/** What one run of the renderer produced. */
export interface MarkdownPass {
    /** The rendered and sanitized HTML. */
    html: string;
    /** The block tokens of the source with line endings normalized to `\n`. */
    tokens: Token[];
    /** In index mode, the block tokens by their `blockIndex`. */
    indexedTokens: (Token & BlockIdFields)[];
    /** The text that each formula placeholder in the tokens replaced. */
    formulaSources: Map<string, string>;
}

/**
 * Renders `content` as {@link renderToHtml} does: the one path of every rendering of Markdown, so
 * that the block index reads the same blocks. In index mode the element of each block token gets
 * the position of the token in {@link MarkdownPass.indexedTokens}, and the text of every list item
 * is a paragraph, as it is for an item with a block id.
 */
export function runMarkdownPass(
    content: string,
    title: string,
    options: RenderToHtmlOptions,
    isIndexMode = false
): MarkdownPass {
    const source = content.replace(/\r\n?/g, "\n");
    const { processedText, placeholderMap: formulaMap, sourceMap } = extractFormulas(source);
    const indexedTokens: (Token & BlockIdFields)[] = [];
    let tokens: Token[] = [];

    const marked = new Marked({ async: false, gfm: true });
    // Marked tries the extension registered last first. The tokenizer of `marked-footnote` must
    // run first at the start of the note, where it inserts the token that collects the footnotes.
    marked.use({ extensions: [ ...createBlockMarkerExtensions(), ...createTabsExtensions() ] });
    marked.use(markedFootnote());
    marked.use({ walkTokens: createTaskStateDetector(options.taskStates ?? DEFAULT_TASK_STATES) });
    // Order is important, especially for wikilinks.
    const extensions = [
        options.transclusion ? createTransclusionExtension(options.transclusion) : transclusionExtension,
        options.wikiLink ? createWikiLinkExtension(options.wikiLink) : wikiLinkExtension,
        createHighlightExtension(),
        createLiteralTildeExtension()
    ];
    if (options.obsidian) {
        extensions.push(createCommentExtension());
    }
    marked.use({
        extensions,
        hooks: {
            processAllTokens(allTokens) {
                assignBlockIds(allTokens);
                if (isIndexMode) {
                    numberBlocks(allTokens, indexedTokens, formulaMap);
                }
                tokens = allTokens;
                return allTokens;
            }
        }
    });

    const renderer = options.renderer ?? new CustomMarkdownRenderer({
        async: false,
        obsidianCallouts: options.obsidian,
        taskStates: options.taskStates
    });
    let html = marked.parse(processedText, { async: false, renderer }) as string;

    html = restoreFromMap(html, formulaMap);
    html = removeBlockMarkers(html);

    // h1 handling needs to come before sanitization.
    if (options.demoteH1 !== false) {
        html = demoteHeadings(html, title, decodeHtmlEntities);
    }
    html = options.sanitize(html);

    // Sanitization re-serializes a `style` attribute without the trailing semicolon CKEditor
    // writes, which would rewrite a note the first time it is saved after an import.
    html = html.replaceAll(/(<[a-z][^<>]*\sstyle="[^"]*[^";])"/gi, '$1;"');

    // Remove slash for self-closing tags to match CKEditor's approach.
    html = html.replace(/<(\w+)([^>]*)\s+\/>/g, "<$1$2>");

    // Normalize non-breaking spaces to entity.
    html = html.replaceAll("\u{a0}", "&nbsp;");

    return { html, tokens, indexedTokens, formulaSources: sourceMap };
}

/** A block token with the fields of the block id pass. */
type BlockToken = Token & BlockIdFields & { tokens?: Token[] };

/**
 * Gives each block token the id of the marker that marks it: the marker line above it, else the
 * first valid marker in its own text. Ids of markers that mark nothing are left out. A marker line
 * marks only a sibling, so each list of siblings is walked by a call of its own.
 */
function assignBlockIds(tokens: Token[]) {
    let pending: BlockMarkerToken | undefined;
    for (const token of tokens as BlockToken[]) {
        // `marked-footnote` inserts its `footnotes` token where its tokenizer first runs.
        if (token.type === "space" || token.type === "def" || token.type === "footnotes") {
            continue;
        }
        if (token.type === "blockMarkerLine") {
            const marker = token as unknown as BlockMarkerToken;
            pending ??= marker.id === null ? undefined : marker;
            continue;
        }
        if (pending) {
            setBlockMarker(getMarkerLineTarget(token), pending);
            pending = undefined;
        }

        switch (token.type) {
            case "paragraph":
            case "heading":
            case "text":
                setBlockMarker(token, takeInlineMarker(token.tokens as Token[]));
                break;
            case "list":
                for (const item of (token as Tokens.List).items) {
                    assignBlockIds(item.tokens);
                }
                break;
            case "blockquote":
                assignBlockIds((token as Tokens.Blockquote).tokens);
                break;
            case "table": {
                const table = token as Tokens.Table;
                for (const cell of [ ...table.header, ...table.rows.flat() ]) {
                    setBlockMarker(token, takeInlineMarker(cell.tokens));
                }
                break;
            }
            case "tabs":
                for (const tab of token.tokens as Tokens.Generic[]) {
                    setBlockMarker(tab, takeInlineMarker(tab.titleTokens));
                    assignBlockIds(tab.tokens as Token[]);
                }
                break;
        }
    }
}

/**
 * The token that a marker line above `token` marks: the token itself, the text of the first item
 * of a list, or none for raw HTML, which uses up the id.
 */
function getMarkerLineTarget(token: BlockToken): BlockToken | undefined {
    if (token.type === "list") {
        const firstItem = (token as Tokens.List).items[0];
        const firstBlock = firstItem?.tokens.find((child) =>
            child.type !== "space" && child.type !== "checkbox");
        return firstBlock ? getMarkerLineTarget(firstBlock as BlockToken) : undefined;
    }
    return token.type === "html" ? undefined : token;
}

function setBlockMarker(token: BlockToken | undefined, marker: BlockMarkerToken | undefined) {
    if (token && marker?.id && !token.blockMarker) {
        token.blockMarker = marker;
        token.blockId = marker.id;
    }
}

/**
 * The first valid marker among `tokens`, inline tokens at any depth. The white space in front of
 * the markers at the end of the text is dropped, ASCII only, so that the `&nbsp;` of an empty
 * paragraph stays.
 */
function takeInlineMarker(tokens: Token[]): BlockMarkerToken | undefined {
    let hasMarkerAfter = false;
    for (let index = tokens.length - 1; index >= 0; index--) {
        const token = tokens[index] as Tokens.Generic;
        if (token.type === "blockMarker") {
            hasMarkerAfter = true;
            continue;
        }
        if (token.type !== "text") {
            break;
        }
        const trimmed = (token.text as string).replace(/[ \t]+$/, "");
        if (hasMarkerAfter) {
            token.text = trimmed;
        }
        if (trimmed) {
            break;
        }
    }

    return findMarker(tokens);
}

function findMarker(tokens: Token[]): BlockMarkerToken | undefined {
    for (const token of tokens as Tokens.Generic[]) {
        if (token.type === "blockMarker" && token.id) {
            return token as BlockMarkerToken;
        }
        const nested = Array.isArray(token.tokens) ? findMarker(token.tokens) : undefined;
        if (nested) {
            return nested;
        }
    }
    return undefined;
}

/**
 * Lists the block tokens that render an element in `indexed`, at their `blockIndex`: those of
 * Markdown blocks, and the raw HTML of a formula alone, whose element `formulaMap` then names.
 */
function numberBlocks(tokens: Token[], indexed: BlockToken[], formulaMap: Map<string, string>) {
    const add = (token: BlockToken) => {
        token.blockIndex = indexed.length;
        indexed.push(token);
    };

    walkBlockTokens(tokens, (token) => {
        switch (token.type) {
            case "paragraph":
            case "heading":
            case "text":
            case "code":
            case "table":
            case "hr":
            case "blockquote":
            case "tabs":
            case "tab":
                add(token as BlockToken);
                break;
            case "html": {
                const key = (token as Tokens.HTML).text.trim();
                const formula = formulaMap.get(key);
                if (formula) {
                    add(token as BlockToken);
                    const attribute = ` ${SOURCE_BLOCK_ATTRIBUTE}="${token.blockIndex}"`;
                    const indexed = formula.replace(/^<span class="math-tex"/, `$&${attribute}`);
                    formulaMap.set(key, indexed);
                }
                break;
            }
        }
    });
}

/** `html`, an element, with `attributes` added to its opening tag. */
function withAttributes(html: string, attributes: string) {
    return attributes ? html.replace(/^<[a-z][a-z0-9]*/i, `$&${attributes}`) : html;
}
