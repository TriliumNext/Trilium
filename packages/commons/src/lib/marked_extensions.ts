import type { Token, TokenizerAndRendererExtension } from "marked";

/**
 * Escapes HTML special characters to prevent XSS attacks.
 * Used for both attribute values and text content.
 */
function escapeHtml(str: string): string {
    return str
        .replace(/&/g, "&amp;")
        .replace(/</g, "&lt;")
        .replace(/>/g, "&gt;")
        .replace(/"/g, "&quot;")
        .replace(/'/g, "&#39;");
}

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
 * Background colour for highlights: CKEditor's stock palette yellow (`==…==` carries no colour
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
export const HIGHLIGHT_BACKGROUND = "hsl(60, 75%, 60%)";

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
            return `<span style="background-color:${HIGHLIGHT_BACKGROUND};">${this.parser.parseInline(token.tokens as Token[])}</span>`;
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

/** Pre-configured wiki-link extension for server-side (uses /noteId format) */
export const wikiLinkExtension = createWikiLinkExtension();

/** Pre-configured transclusion extension for server-side (uses /noteId format) */
export const transclusionExtension = createTransclusionExtension();
