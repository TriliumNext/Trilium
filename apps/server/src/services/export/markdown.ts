import { gfm } from "@triliumnext/turndown-plugin-gfm";
import Turnish, { type Rule } from "turnish";

let instance: Turnish | null = null;

// TODO: Move this to a dedicated file someday.
export const ADMONITION_TYPE_MAPPINGS: Record<string, string> = {
    note: "NOTE",
    tip: "TIP",
    important: "IMPORTANT",
    caution: "CAUTION",
    warning: "WARNING"
};

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

                // Original implementation as per https://github.com/mixmark-io/turndown/blob/master/src/turndown.js.
                return ("isBlock" in node && node.isBlock) ? '\n\n' : '';
            },
        });
        // Filter is heavily based on: https://github.com/mixmark-io/turndown/issues/274#issuecomment-458730974
        instance.addRule("fencedCodeBlock", fencedCodeBlockFilter);
        instance.addRule("img", buildImageFilter());
        instance.addRule("admonition", buildAdmonitionFilter());
        instance.addRule("inlineLink", buildInlineLinkFilter());
        instance.addRule("figure", buildFigureFilter());
        instance.addRule("math", buildMathFilter());
        instance.addRule("li", buildListItemFilter());
        instance.use(gfm);
        instance.keep([ "kbd", "sup", "sub" ]);
    }

    return instance.render(content);
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
                const isChecked = node.querySelector("input[type=checkbox]:checked");
                prefix = (isChecked ? "- [x] " : "- [ ] ");
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
