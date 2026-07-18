import { safeLinkPreviewHref, type TaskStateDef } from "@triliumnext/commons";
import { ADMONITION_TYPE_MAPPINGS } from "@triliumnext/commons/src/lib/markdown_renderer.js";
import { gfm, serializeStructuralHtml } from "@triliumnext/turndown-plugin-gfm";
import escapeHtml from "escape-html";
import { parse as parseHtml } from "node-html-parser";
import Turnish, { type Rule } from "turnish";

import { getTaskStates } from "../task_states.js";

let instance: Turnish | null = null;

/** Task states for the current `toMarkdown` invocation, consulted by the list-item filter. */
let currentTaskStates: TaskStateDef[] = [];

export { ADMONITION_TYPE_MAPPINGS };

export const DEFAULT_ADMONITION_TYPE = ADMONITION_TYPE_MAPPINGS.note;

const fencedCodeBlockFilter: Rule = {
    filter (node, options) {
        return options.codeBlockStyle === "fenced" && node.nodeName === "PRE" && node.firstChild !== null && node.firstChild.nodeName === "CODE";
    },

    replacement (content, node, options) {
        if (!node.firstChild || !("getAttribute" in node.firstChild) || typeof node.firstChild.getAttribute !== "function") {
            return content;
        }

        const className = node.firstChild.getAttribute("class") || "";
        const language = rewriteLanguageTag((className.match(/language-(\S+)/) || [null, ""])[1]);

        return `\n\n${options.fence}${language}\n${node.firstChild.textContent}\n${options.fence}\n\n`;
    }
};

function toMarkdown(content: string) {
    currentTaskStates = getTaskStates();

    if (instance === null) {
        instance = new Turnish({
            headingStyle: "atx",
            bulletListMarker: "*",
            emDelimiter: "_",
            codeBlockStyle: "fenced",
            blankReplacement(_content, node) {
                if (node.nodeName === "SECTION" && node.classList.contains("include-note")) {
                    return node.outerHTML;
                }

                // Only reached by a link preview without a data-url (the fallback anchor injected
                // by `injectLinkPreviewFallbacks` makes every other one non-blank).
                if (isLinkPreview(node)) {
                    return linkPreviewReplacement(node);
                }

                // Original implementation as per https://github.com/mixmark-io/turndown/blob/master/src/turndown.js.
                return ("isBlock" in node && node.isBlock) ? '\n\n' : '';
            },
        });
        // Filter is heavily based on: https://github.com/mixmark-io/turndown/issues/274#issuecomment-458730974
        instance.addRule("fencedCodeBlock", fencedCodeBlockFilter);
        instance.addRule("img", buildImageFilter());
        instance.addRule("admonition", buildAdmonitionFilter());
        instance.addRule("details", buildDetailsFilter());
        instance.addRule("inlineLink", buildInlineLinkFilter());
        instance.addRule("figure", buildFigureFilter());
        instance.addRule("linkPreview", buildLinkPreviewFilter());
        instance.addRule("math", buildMathFilter());
        instance.addRule("li", buildListItemFilter());
        instance.use(gfm);
        instance.keep([ "kbd", "sup", "sub" ]);
    }

    return instance.render(injectLinkPreviewFallbacks(content));
}

function rewriteLanguageTag(source: string) {
    if (!source) {
        return source;
    }

    switch (source) {
        case "text-x-trilium-auto":
            return "";
        case "application-javascript-env-frontend":
        case "application-javascript-env-backend":
            return "javascript";
        case "text-x-nginx-conf":
            return "nginx";
        default:
            return source.split("-").at(-1);
    }
}

// TODO: Remove once upstream delivers a fix for https://github.com/mixmark-io/turndown/issues/467.
function buildImageFilter() {
    const ESCAPE_PATTERNS = {
        before: /([\\*`[\]_]|(?:^[-+>])|(?:^~~~)|(?:^#{1-6}))/g,
        after: /((?:^\d+(?=\.)))/
    };

    const escapePattern = new RegExp(`(?:${ESCAPE_PATTERNS.before.source}|${ESCAPE_PATTERNS.after.source})`, 'g');

    function escapeMarkdown (content: string) {
        return content.replace(escapePattern, (match, before, after) => {
            return before ? `\\${before}` : `${after}\\`;
        });
    }

    function escapeLinkDestination(destination: string) {
        return destination
            .replace(/([()])/g, '\\$1')
            .replace(/ /g, "%20");
    }

    function escapeLinkTitle (title: string) {
        return title.replace(/"/g, '\\"');
    }

    const imageFilter: Rule = {
        filter: "img",
        replacement(content, _node) {
            const node = _node as HTMLElement;

            // Preserve image verbatim if it has a width or height attribute.
            if (node.hasAttribute("width") || node.hasAttribute("height")) {
                return node.outerHTML;
            }

            // TODO: Deduplicate with upstream.
            const untypedNode = (node as any);
            const alt = escapeMarkdown(cleanAttribute(untypedNode.getAttribute('alt')));
            const src = escapeLinkDestination(untypedNode.getAttribute('src') || '');
            const title = cleanAttribute(untypedNode.getAttribute('title'));
            const titlePart = title ? ` "${escapeLinkTitle(title)}"` : '';

            return src ? `![${alt}](${src}${titlePart})` : '';
        }
    };
    return imageFilter;
}

function buildAdmonitionFilter() {
    function parseAdmonitionType(_node: Node) {
        if (!("getAttribute" in _node)) {
            return DEFAULT_ADMONITION_TYPE;
        }

        const node = _node as Element;
        const classList = node.getAttribute("class")?.split(" ") ?? [];

        for (const className of classList) {
            if (className === "admonition") {
                continue;
            }

            const mappedType = ADMONITION_TYPE_MAPPINGS[className];
            if (mappedType) {
                return mappedType;
            }
        }

        return DEFAULT_ADMONITION_TYPE;
    }

    const admonitionFilter: Rule = {
        filter(node, options) {
            return node.nodeName === "ASIDE" && node.classList.contains("admonition");
        },
        replacement(content, node) {
            // Parse the admonition type.
            const admonitionType = parseAdmonitionType(node);

            content = content.replace(/^\n+|\n+$/g, '');
            content = content.replace(/^/gm, '> ');
            content = `> [!${admonitionType}]\n${content}`;

            return `\n\n${content}\n\n`;
        }
    };
    return admonitionFilter;
}

/**
 * Variation of the original ruleset: https://github.com/mixmark-io/turndown/blob/master/src/commonmark-rules.js.
 *
 * Detects if the URL is a Trilium reference link and returns it verbatim if that's the case.
 *
 * @returns
 */
function buildInlineLinkFilter(): Rule {
    return {
        filter (node, options) {
            return (
                options.linkStyle === 'inlined' &&
                node.nodeName === 'A' &&
                !!node.getAttribute('href')
            );
        },

        replacement (content, _node) {
            const node = _node as HTMLElement;

            // Return reference links verbatim.
            if (node.classList.contains("reference-link")) {
                return node.outerHTML;
            }

            // Otherwise treat as normal.
            // TODO: Call super() somehow instead of duplicating the implementation.
            let href = node.getAttribute('href');
            if (href) href = href.replace(/([()])/g, '\\$1');
            let title = cleanAttribute(node.getAttribute('title'));
            if (title) title = ` "${title.replace(/"/g, '\\"')}"`;
            return `[${content}](${href}${title})`;
        }
    };
}

function buildFigureFilter(): Rule {
    return {
        filter(node, options) {
            return node.nodeName === 'FIGURE'
                && node.classList.contains("image");
        },
        replacement(content, node) {
            return (node as HTMLElement).outerHTML;
        }
    };
}

/**
 * Link previews (block `<section class="link-embed">`, inline `<span class="link-mention">`) keep
 * all their metadata in data attributes on an empty element, so without special handling turndown
 * treats them as blank nodes and drops them from the export entirely — URL included.
 *
 * A fallback `<a>` child is injected before turndown parses the content, which solves three
 * problems at once: the export stays meaningful in renderers that don't know the widget (GitHub,
 * Obsidian show a plain link), the inline mention is no longer blank so turndown's whitespace
 * collapsing doesn't eat the space that follows it (an empty inline element is assumed to render
 * as nothing), and the `linkPreview` rule below fires (rules never run on blank nodes).
 *
 * An anchor already present — e.g. in content imported from Markdown that was never re-saved by
 * the editor — is regenerated rather than kept, so a stale title is refreshed instead of
 * accumulated. On reimport the round-trip is lossless: the sanitizer allows `section`/`span` and
 * `data-*`, and the editor upcasts both purely by tag + class, ignoring children.
 */
function injectLinkPreviewFallbacks(content: string): string {
    if (!content.includes("link-embed") && !content.includes("link-mention")) {
        return content;
    }

    const root = parseHtml(content);
    for (const element of root.querySelectorAll("section.link-embed, span.link-mention")) {
        const url = element.getAttribute("data-url");
        if (url) {
            const title = element.getAttribute("data-title") || url;
            // `safeLinkPreviewHref` renders a hostile scheme (`javascript:`, `data:`) inert —
            // stored `data-url` values reach here unsanitized (see its JSDoc); `escapeHtml` on top
            // stops an otherwise-valid http(s) URL containing a quote from breaking out of the attribute.
            element.innerHTML = `<a href="${escapeHtml(safeLinkPreviewHref(url))}">${escapeHtml(title)}</a>`;
        }
    }

    return root.toString();
}

/**
 * The slice of a DOM node the link-preview rules read. Turndown hands its callbacks its own
 * ExtendedNode — not a real HTMLElement — so the helpers ask only for what they use.
 */
interface LinkPreviewNodeLike {
    nodeName: string;
    classList: { contains(className: string): boolean };
    outerHTML: string;
}

function isLinkPreview(node: LinkPreviewNodeLike): boolean {
    return (node.nodeName === "SECTION" && node.classList.contains("link-embed"))
        || (node.nodeName === "SPAN" && node.classList.contains("link-mention"));
}

function linkPreviewReplacement(node: LinkPreviewNodeLike): string {
    return node.nodeName === "SECTION" ? `\n\n${node.outerHTML}\n\n` : node.outerHTML;
}

function buildLinkPreviewFilter(): Rule {
    return {
        filter(node) {
            return isLinkPreview(node);
        },
        replacement(_content, node) {
            return linkPreviewReplacement(node);
        }
    };
}

/**
 * Markdown has no native syntax for disclosure widgets, but GitHub, Obsidian
 * and most CommonMark+HTML renderers accept raw <details>/<summary> verbatim
 * — and Trilium's markdown importer already parses them back into the
 * collapsible model node, so passthrough round-trips losslessly.
 *
 * We match on tag name only (not on the trilium-collapsible class) so any
 * pasted/imported <details> is preserved too; stripping it to plain text
 * would silently lose structure.
 *
 * The block is pretty-printed (one child per line, indented) with the same
 * serializer the GFM plugin uses for raw-HTML tables, so it stays readable in
 * the exported Markdown. The block-level containers below are recursed into so
 * nested lists indent too; inline wrappers (<summary>, list-item <span>s, etc.)
 * are emitted verbatim on a single line, and a node holding direct text is kept
 * verbatim as well so its content is never dropped.
 *
 * The Trilium-only `trilium-collapsible` styling hook is dropped from the
 * exported <details> (any user-added classes are kept). It is not needed to
 * round-trip: the importer upcasts <details> by tag name and the collapsible
 * plugin re-stamps the class on the next save.
 */
function buildDetailsFilter(): Rule {
    // Block containers whose children are themselves blocks. Inline-content
    // elements (P, SUMMARY, SPAN, headings) are deliberately excluded so their
    // formatting stays on one line.
    const DETAILS_CONTAINER_TAGS = ["DETAILS", "UL", "OL", "LI", "BLOCKQUOTE"];

    return {
        filter(node) {
            return node.nodeName === "DETAILS";
        },
        replacement(_content, node) {
            const details = node as HTMLElement;
            details.classList.remove("trilium-collapsible");
            if (details.classList.length === 0) {
                details.removeAttribute("class");
            }
            return `\n\n${serializeStructuralHtml(details, DETAILS_CONTAINER_TAGS)}\n\n`;
        }
    };
}

// Keep in line with https://github.com/mixmark-io/turndown/blob/master/src/commonmark-rules.js.
function buildListItemFilter(): Rule {
    return {
        filter: "li",
        replacement(content, node, options) {
            content = content
                .trim()
                .replace(/\n/gm, '\n    '); // indent
            let prefix = `${options.bulletListMarker}   `;
            const parent = node.parentNode as HTMLElement;
            if (parent.nodeName === 'OL') {
                const start = parent.getAttribute('start');
                const index = Array.prototype.indexOf.call(parent.children, node);
                prefix = `${start ? Number(start) + index : index + 1}.  `;
            } else if (parent.classList.contains("todo-list")) {
                const state = (node as HTMLElement).getAttribute("data-trilium-task-state");
                const stateMarker = state
                    ? currentTaskStates.find((s) => s.name === state)?.markdownSymbol
                    : undefined;
                if (stateMarker) {
                    prefix = `- [${stateMarker}] `;
                } else {
                    const isChecked = node.querySelector("input[type=checkbox]:checked");
                    prefix = (isChecked ? "- [x] " : "- [ ] ");
                }
            }

            const result = prefix + content + (node.nextSibling && !/\n$/.test(content) ? '\n' : '');
            return result;
        }
    };
}

function buildMathFilter(): Rule {
    const MATH_INLINE_PREFIX = "\\(";
    const MATH_INLINE_SUFFIX = "\\)";

    const MATH_DISPLAY_PREFIX = "\\[";
    const MATH_DISPLAY_SUFFIX = "\\]";

    return {
        filter(node) {
            return node.nodeName === "SPAN" && node.classList.contains("math-tex");
        },
        replacement(_, node) {
            // We have to use the raw HTML text, otherwise the content is escaped too much.
            const content = (node as HTMLElement).innerText;

            // Inline math
            if (content.startsWith(MATH_INLINE_PREFIX) && content.endsWith(MATH_INLINE_SUFFIX)) {
                return `$${content.substring(MATH_INLINE_PREFIX.length, content.length - MATH_INLINE_SUFFIX.length)}$`;
            }

            // Display math
            if (content.startsWith(MATH_DISPLAY_PREFIX) && content.endsWith(MATH_DISPLAY_SUFFIX)) {
                return `$$${content.substring(MATH_DISPLAY_PREFIX.length, content.length - MATH_DISPLAY_SUFFIX.length)}$$`;
            }

            // Unknown.
            return content;
        }
    };
}

// Taken from upstream since it's not exposed.
// https://github.com/mixmark-io/turndown/blob/master/src/commonmark-rules.js
function cleanAttribute(attribute: string | null | undefined) {
    return attribute ? attribute.replace(/(\n+\s*)+/g, '\n') : '';
}

export default {
    toMarkdown
};
