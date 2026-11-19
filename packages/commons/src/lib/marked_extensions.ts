import type { Token, TokenizerAndRendererExtension } from "marked";

import { BLOCK_ID_ATTRIBUTE, BLOCK_MARKER_SOURCE, decodeBlockMarkerId } from "./block_reference.js";
import { escapeHtml } from "./utils.js";

/** The attribute with which the block index finds the element of each block token. */
export const SOURCE_BLOCK_ATTRIBUTE = "data-trilium-source-block";

/** A token of a block marker, inline or alone on its line. */
export interface BlockMarkerToken {
    type: "blockMarker" | "blockMarkerLine";
    raw: string;
    /** The decoded value of the marker. */
    value: string;
    /** The block id, `null` when the value is not a valid one. */
    id: string | null;
}

/** The fields that the block id pass sets on a block token. */
export interface BlockIdFields {
    blockId?: string;
    /** The marker that gave the token its id. */
    blockMarker?: BlockMarkerToken;
    /** The position of the token in the block index, which only the index sets. */
    blockIndex?: number;
}

/**
 * Creates the extensions for block markers: an inline marker, which marks the block that holds it,
 * and a marker alone on its line, which marks the block after it. Both render nothing.
 */
export function createBlockMarkerExtensions(): TokenizerAndRendererExtension[] {
    return [
        {
            name: "blockMarkerLine",
            level: "block",

            start(src: string) {
                // Marked passes the source without its first character, so a line starts after a
                // newline.
                const match = MARKER_LINE_START.exec(src);
                return match ? match.index + 1 : undefined;
            },

            tokenizer(src) {
                const match = MARKER_LINE.exec(src);
                return match ? createMarkerToken("blockMarkerLine", match) : undefined;
            },

            renderer: () => ""
        },
        {
            name: "blockMarker",
            level: "inline",

            start(src: string) {
                const index = src.search(MARKER_ANYWHERE);
                return index < 0 ? undefined : index;
            },

            tokenizer(src) {
                const match = MARKER_AT_START.exec(src);
                return match ? createMarkerToken("blockMarker", match) : undefined;
            },

            renderer: () => ""
        }
    ];
}

/** The attributes of the element of a block token: its block id and its place in the index. */
export function getBlockAttributes(token: object) {
    const { blockId, blockIndex } = token as BlockIdFields;
    let attributes = "";
    if (blockId !== undefined) {
        attributes += ` ${BLOCK_ID_ATTRIBUTE}="${escapeHtml(blockId)}"`;
    }
    if (blockIndex !== undefined) {
        attributes += ` ${SOURCE_BLOCK_ATTRIBUTE}="${blockIndex}"`;
    }
    return attributes;
}

/** Whether the element of a block token carries a block id, or is indexed. */
export function isReferencedBlock(token: object) {
    const { blockId, blockIndex } = token as BlockIdFields;
    return blockId !== undefined || blockIndex !== undefined;
}

function createMarkerToken(
    type: BlockMarkerToken["type"],
    match: RegExpExecArray
): BlockMarkerToken {
    const value = match[1] ?? match[2];
    return { type, raw: match[0], value, id: decodeBlockMarkerId(value) };
}

const MARKER_AT_START = new RegExp(`^${BLOCK_MARKER_SOURCE}`, "i");
const MARKER_ANYWHERE = new RegExp(BLOCK_MARKER_SOURCE, "i");
const MARKER_LINE = new RegExp(String.raw`^ {0,3}${BLOCK_MARKER_SOURCE}[ \t]*(?:\n|$)`, "i");
const MARKER_LINE_START =
    new RegExp(String.raw`\n {0,3}${BLOCK_MARKER_SOURCE}[ \t]*(?=\n|$)`, "i");

export interface WikiLinkOptions {
    /** Format the href for the link. Defaults to `/${noteId}` */
    formatHref?: (noteId: string) => string;
}

/**
 * Creates a wiki-link extension for internal note links: [[noteId]]
 *
 * @example
 * // Server-side (for import)
 * createWikiLinkExtension() // uses default /${noteId}
 *
 * // Client-side (for navigation)
 * createWikiLinkExtension({ formatHref: (id) => `#root/${id}` })
 */
export function createWikiLinkExtension(options: WikiLinkOptions = {}): TokenizerAndRendererExtension {
    const formatHref = options.formatHref ?? ((id) => `/${id}`);

    return {
        name: "wikiLink",
        level: "inline",

        start(src: string) {
            return src.indexOf("[[");
        },

        tokenizer(src) {
            const match = /^\[\[([^\]]+?)\]\]/.exec(src);
            if (match) {
                return {
                    type: "wikiLink",
                    raw: match[0],
                    text: match[1].trim(),
                    href: match[1].trim()
                };
            }
        },

        renderer(token) {
            const noteId = token.href as string;
            return `<a class="reference-link" href="${escapeHtml(formatHref(noteId))}">${escapeHtml(token.text as string)}</a>`;
        }
    };
}

export interface TransclusionOptions {
    /** Format the src for the image/embed. Defaults to `/${noteId}` */
    formatSrc?: (noteId: string) => string;
}

/**
 * Creates a transclusion extension for embedding note content: ![[noteId]]
 * Terminology inspired by https://silverbullet.md/Transclusions
 *
 * @example
 * createTransclusionExtension() // uses default /${noteId}
 * createTransclusionExtension({ formatSrc: (id) => `/api/images/${id}` })
 */
export function createTransclusionExtension(options: TransclusionOptions = {}): TokenizerAndRendererExtension {
    const formatSrc = options.formatSrc ?? ((id) => `/${id}`);

    return {
        name: "transclusion",
        level: "inline",

        start(src: string) {
            return src.match(/!\[\[/)?.index;
        },

        tokenizer(src) {
            const match = /^!\[\[([^\]]+?)\]\]/.exec(src);
            if (match) {
                return {
                    type: "transclusion",
                    raw: match[0],
                    href: match[1].trim()
                };
            }
        },

        renderer(token) {
            const noteId = token.href as string;
            return `<img src="${escapeHtml(formatSrc(noteId))}">`;
        }
    };
}

/**
 * Background colour for highlights: the text editor's palette Yellow (`==…==` carries no colour
 * of its own). Matches the `<span style="background-color:…">` markup CKEditor's Font
 * Background Color feature emits, so a highlight rendered into a text note round-trips as an
 * editable highlight. Deliberately not `<mark>`, which General HTML Support does keep but
 * leaves inert: there is no Highlight plugin to apply or lift one, and the allow-list is bare
 * element names, so a colour on it never reaches the editor's model.
 *
 * The Markdown exporter compares against this to decide which highlights can collapse back to
 * `==…==` and which have to keep their colour as inline HTML, so the two directions must agree
 * on the exact value.
 */
export const HIGHLIGHT_BACKGROUND = "#e5e64d";

/** The style of a highlight as the text editor saves it, with the theme-adaptive variable. */
export const HIGHLIGHT_STYLE =
    `background-color:${HIGHLIGHT_BACKGROUND};--tn-background:${HIGHLIGHT_BACKGROUND};`;

/**
 * Creates an extension for highlights: `==text==` → a background-coloured `<span>`.
 *
 * Not part of CommonMark or GFM, but the de-facto standard everywhere else (Obsidian,
 * Typora, Bear, python-markdown), so it is enabled for all Markdown rendering rather than
 * only for the Obsidian importer.
 *
 * Inner markdown is parsed so `==**bold**==` highlights bold text. A non-space is required
 * just inside each `==` (like emphasis), so `a == b` and `====` stay literal.
 */
export function createHighlightExtension(): TokenizerAndRendererExtension {
    return {
        name: "highlight",
        level: "inline",

        start(src: string) {
            return src.indexOf("==");
        },

        tokenizer(src) {
            const match = /^==(?=\S)([\s\S]*?\S)==/.exec(src);
            if (match) {
                return {
                    type: "highlight",
                    raw: match[0],
                    text: match[1],
                    tokens: this.lexer.inlineTokens(match[1])
                };
            }
        },

        renderer(token) {
            const content = this.parser.parseInline(token.tokens as Token[]);
            return `<span style="${HIGHLIGHT_STYLE}">${content}</span>`;
        }
    };
}

/**
 * Creates an extension for Obsidian comments: `%% comment %%` → an HTML comment.
 *
 * Obsidian comments are hidden from the reader. They're emitted as real HTML comments
 * (rather than left as literal `%%…%%` text) so the authoring intent survives in the raw
 * HTML — note that Trilium's sanitizer and the CKEditor editor will subsequently drop
 * them, which is fine. Both the inline (`%%hidden%%`) and single-block (`%%\n…\n%%`)
 * forms are matched; any comment terminator in the body is neutralised so it can't break
 * out of the comment.
 */
export function createCommentExtension(): TokenizerAndRendererExtension {
    return {
        name: "obsidianComment",
        level: "inline",

        start(src: string) {
            return src.indexOf("%%");
        },

        tokenizer(src) {
            const match = /^%%([\s\S]*?)%%/.exec(src);
            if (match) {
                return {
                    type: "obsidianComment",
                    raw: match[0],
                    text: match[1]
                };
            }
        },

        renderer(token) {
            const body = (token.text as string).replace(/--!?>/g, "-- >").trim();
            return `<!-- ${body} -->`;
        }
    };
}

/**
 * Creates an extension that keeps a lone `~` literal, so only `~~text~~` strikes text through.
 *
 * GFM also accepts a single tilde as a strikethrough delimiter, which is a poor fit for prose
 * where `~` overwhelmingly means "approximately". Two unrelated approximations in one paragraph
 * ("a ~07:50 departure … the supplement (~€11–12)") otherwise pair up and strike out everything
 * between them — a frequent and very visible mangling of AI-written text. Losing the single-tilde
 * shorthand is the cheaper trade: the doubled form is what editors emit and what Obsidian and
 * Notion require.
 */
export function createLiteralTildeExtension(): TokenizerAndRendererExtension {
    return {
        name: "literalTilde",
        level: "inline",

        start(src: string) {
            return src.indexOf("~");
        },

        tokenizer(src) {
            // Consume the tilde as text; a doubled one is left to marked's own `del` tokenizer.
            if (src.startsWith("~") && !src.startsWith("~~")) {
                return {
                    type: "literalTilde",
                    raw: "~",
                    text: "~"
                };
            }
        },

        renderer() {
            return "~";
        }
    };
}

/**
 * Creates the extensions for the content tabs of `pymdownx.tabbed` (Material for MkDocs), which
 * render consecutive tabs as one `<div class="trilium-tabs">` in the text editor's markup.
 */
export function createTabsExtensions(): TokenizerAndRendererExtension[] {
    return [
        {
            name: "tabs",
            level: "block",

            start(src: string) {
                return /^===!? +"/m.exec(src)?.index;
            },

            tokenizer(src) {
                const tabs: Token[] = [];
                let raw = "";
                let rest = src;
                for (;;) {
                    const match = TAB.exec(rest);
                    if (!match || (match[1] && tabs.length)) {
                        break;
                    }
                    const content = match[3].replace(/^(?: {4}|\t)/gm, "");
                    tabs.push({
                        type: "tab",
                        raw: match[0],
                        titleTokens: this.lexer.inlineTokens(match[2]),
                        tokens: this.lexer.blockTokens(content, [])
                    });
                    raw += match[0];
                    rest = rest.slice(match[0].length);
                }

                if (tabs.length) {
                    return { type: "tabs", raw, tokens: tabs };
                }
            },

            renderer(token) {
                const panels = this.parser.parse(token.tokens as Token[]);
                return `<div class="trilium-tabs"${getBlockAttributes(token)}>${panels}</div>`;
            }
        },
        {
            name: "tab",
            renderer(token) {
                const title = this.parser.parseInline(token.titleTokens as Token[]) || "&nbsp;";
                const panel = this.parser.parse(token.tokens as Token[]).trim() || "<p>&nbsp;</p>";
                return `<section class="trilium-tab"${getBlockAttributes(token)}>`
                    + `<p class="trilium-tab-title">${title}</p>`
                    + `<div class="trilium-tab-panel">${panel}</div></section>`;
            }
        }
    ];
}

/**
 * One tab: the `=== "Title"` line (`===! "Title"` starts a new block; the title runs to the last
 * quote), then its panel, the following lines that are blank or indented by four spaces or a tab.
 */
const TAB = /^===(!)? +"(.*)" *(?:\n|$)((?:[ \t]*\n|(?: {4}|\t).*(?:\n|$))*)/;

/** Pre-configured wiki-link extension for server-side (uses /noteId format) */
export const wikiLinkExtension = createWikiLinkExtension();

/** Pre-configured transclusion extension for server-side (uses /noteId format) */
export const transclusionExtension = createTransclusionExtension();
