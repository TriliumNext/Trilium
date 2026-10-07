import { safeLinkPreviewHref, type TaskStateDef } from "@triliumnext/commons";
import { ADMONITION_TYPE_MAPPINGS } from "@triliumnext/commons/src/lib/markdown_renderer.js";
import { HIGHLIGHT_BACKGROUND } from "@triliumnext/commons/src/lib/marked_extensions.js";
import { gfm, serializeStructuralHtml } from "@triliumnext/turndown-plugin-gfm";
import escapeHtml from "escape-html";
import { parse as parseHtml } from "node-html-parser";
import Turnish, { type Rule } from "turnish";

import { getTaskStates } from "../task_states.js";

/** One converter per headerless-table mode, built lazily and reused across invocations. */
const instances = new Map<HeaderlessTableMode, Turnish>();

/** Task states for the current `toMarkdown` invocation, consulted by the list-item filter. */
let currentTaskStates: TaskStateDef[] = [];

/**
 * How a table without a heading row renders: kept as raw HTML so notes round-trip ("keepHtml",
 * the default), or under a synthesized blank header ("emptyHeader") for output that never
 * reimports, such as the clipboard.
 */
export type HeaderlessTableMode = "keepHtml" | "emptyHeader";

export interface ToMarkdownOptions {
    headerlessTables?: HeaderlessTableMode;
}

export { ADMONITION_TYPE_MAPPINGS };

export const DEFAULT_ADMONITION_TYPE = ADMONITION_TYPE_MAPPINGS.note;

const fencedCodeBlockFilter: Rule = {
    filter (node, options) {
        return options.codeBlockStyle === "fenced" && node.nodeName === "PRE" && node.firstChild !== null && node.firstChild.nodeName === "CODE";
    },

    replacement (content, node, options) {
        /* v8 ignore next 3 -- unreachable: the filter above only matches when firstChild is a <code>
           element, so getAttribute is always there; the guard is here to narrow the `Node` type. */
        if (!node.firstChild || !("getAttribute" in node.firstChild) || typeof node.firstChild.getAttribute !== "function") {
            return content;
        }

        const className = node.firstChild.getAttribute("class") || "";
        const language = rewriteLanguageTag((className.match(/language-(\S+)/) || [null, ""])[1]);

        return `\n\n${options.fence}${language}\n${node.firstChild.textContent}\n${options.fence}\n\n`;
    }
};

function toMarkdown(content: string, options: ToMarkdownOptions = {}) {
    currentTaskStates = getTaskStates();

    const headerlessTables = options.headerlessTables ?? "keepHtml";
    let instance = instances.get(headerlessTables);
    if (instance === undefined) {
        instance = new Turnish({
            headingStyle: "atx",
            bulletListMarker: "*",
            emDelimiter: "_",
            codeBlockStyle: "fenced",
            headerlessTables,
            blankReplacement(_content, node) {
                if (isContentEmbed(node)) {
                    return node.outerHTML;
                }

                // Only reached by a link preview without a data-url (the fallback anchor injected
                // by `injectLinkPreviewFallbacks` makes every other one non-blank).
                if (isLinkPreview(node)) {
                    return linkPreviewReplacement(node);
                }

                // A tab without text still keeps its `=== ""` line, or the import loses the tab.
                const blankTabs = blankTabsReplacement(node);
                if (blankTabs !== null) {
                    return blankTabs;
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
        instance.addRule("tabTitle", buildTabTitleFilter());
        instance.addRule("tabPanel", buildTabPanelFilter());
        instance.addRule("inlineLink", buildInlineLinkFilter());
        instance.addRule("figure", buildFigureFilter());
        instance.addRule("linkPreview", buildLinkPreviewFilter());
        instance.addRule("inlineIcon", buildInlineIconFilter());
        // Before "math": rules are consulted in reverse registration order, so a highlighted
        // formula stays a formula instead of being flattened into `==\(x\)==`.
        instance.addRule("highlight", buildHighlightFilter());
        instance.addRule("math", buildMathFilter());
        instance.addRule("li", buildListItemFilter());
        instance.use(gfm);
        instance.keep([ "kbd", "sup", "sub" ]);
        instances.set(headerlessTables, instance);
    }

    return instance.render(injectIconFallbacks(injectLinkPreviewFallbacks(content)));
}

/** The class every icon in the application wears beside its pack's own. */
const ICON_CLASS = "tn-icon";

/**
 * Stands in for an icon's own content while Turndown runs. Turndown drops an element holding
 * nothing before it consults a single rule, and collapses the space beside it away with it.
 */
const ICON_PLACEHOLDER = String.fromCodePoint(0xE000);

function injectIconFallbacks(content: string): string {
    if (!content.includes(ICON_CLASS)) {
        return content;
    }

    const root = parseHtml(content);
    const icons = root.querySelectorAll(`span.${ICON_CLASS}`);
    // Returned as it came where the class was only ever mentioned, rather than serialized back out
    // of a parse that had nothing to change.
    if (!icons.length) {
        return content;
    }

    for (const icon of icons) {
        icon.textContent = ICON_PLACEHOLDER;
    }

    return root.toString();
}

function buildInlineIconFilter() {
    const iconFilter: Rule = {
        filter(node) {
            return node.nodeName === "SPAN" && node.classList.contains(ICON_CLASS);
        },
        replacement(_content, node) {
            // Written from the class alone, so an icon leaves in the form it is stored in and the
            // placeholder injected above never reaches the file.
            const classNames = "getAttribute" in node ? node.getAttribute("class") ?? "" : "";

            return `<span class="${escapeHtml(classNames)}"></span>`;
        }
    };

    return iconFilter;
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
        /* v8 ignore next 3 -- unreachable: the filter below only matches an <aside> element, so
           getAttribute is always there; the guard is here to narrow the `Node` type. */
        if (!("getAttribute" in _node)) {
            return DEFAULT_ADMONITION_TYPE;
        }

        const node = _node as Element;
        /* v8 ignore next -- the filter requires class="… admonition …", so the attribute is always set. */
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
            /* v8 ignore next -- the filter requires a non-empty href, so this never falls through. */
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
            return (node.nodeName === "FIGURE" && node.classList.contains("image"))
                || isContentEmbed(node);
        },
        replacement(content, node) {
            return (node as HTMLElement).outerHTML;
        }
    };
}

/** Whether `node` is an embed. Embeds saved before captions existed are `<section>`s. */
function isContentEmbed(node: Pick<LinkPreviewNodeLike, "nodeName" | "classList">) {
    return (node.nodeName === "FIGURE" || node.nodeName === "SECTION")
        && node.classList.contains("include-note");
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
 * exported <details> (any user-added classes are kept), so the Markdown stays
 * portable. `normalizeCollapsibles()` in `services/import/markdown.ts` puts the
 * class and the collapsed whitespace back, so the cycle returns the note
 * unchanged.
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

/**
 * Tabs blocks export to the tabbed syntax of Python-Markdown's `pymdownx.tabbed` (used by Material
 * for MkDocs): a `=== "Title"` line per tab, followed by the panel indented four spaces. A block
 * that directly follows another one starts with `===! "Title"`, which keeps the two apart. The
 * shared Markdown renderer reads the same syntax back.
 */
function buildTabTitleFilter(): Rule {
    return {
        filter(node) {
            return node.classList.contains(TAB_TITLE_CLASS);
        },
        replacement(_content, node) {
            return `\n\n${tabTitleLine(node)}\n\n`;
        }
    };
}

function buildTabPanelFilter(): Rule {
    return {
        filter(node) {
            return node.classList.contains(TAB_PANEL_CLASS);
        },
        replacement(content) {
            const indented = content
                .trim()
                .split("\n")
                .map((line) => (line ? `    ${line}` : line))
                .join("\n");
            return `\n\n${indented}\n\n`;
        }
    };
}

/** The title lines of a tabs block, tab or title that holds no text; `null` for any other node. */
function blankTabsReplacement(node: Node): string | null {
    if (!isElement(node)) {
        return null;
    }
    const childrenWithClass = (parent: Element, className: string) =>
        Array.from(parent.children).filter((child) => child.classList.contains(className));

    const titles = node.classList.contains(TABS_CLASS)
        ? childrenWithClass(node, TAB_CLASS).flatMap((tab) => childrenWithClass(tab, TAB_TITLE_CLASS))
        : node.classList.contains(TAB_CLASS)
            ? childrenWithClass(node, TAB_TITLE_CLASS)
            : node.classList.contains(TAB_TITLE_CLASS) ? [node] : null;
    if (!titles) {
        return null;
    }
    return `\n\n${titles.map(tabTitleLine).join("\n\n")}\n\n`;
}

function tabTitleLine(title: Element): string {
    const tab = title.parentElement;
    const block = tab?.parentElement;
    const startsNewBlock = block?.firstElementChild === tab
        && block?.previousElementSibling?.classList.contains(TABS_CLASS);
    const text = (title.textContent ?? "").replace(/\s+/g, " ").trim();
    return `===${startsNewBlock ? "!" : ""} "${text}"`;
}

function isElement(node: Node): node is Element {
    return node.nodeType === 1;
}

const TABS_CLASS = "trilium-tabs";
const TAB_CLASS = "trilium-tab";
const TAB_TITLE_CLASS = "trilium-tab-title";
const TAB_PANEL_CLASS = "trilium-tab-panel";

// Keep in line with https://github.com/mixmark-io/turndown/blob/master/src/commonmark-rules.js.
function buildListItemFilter(): Rule {
    return {
        filter: "li",
        replacement(content, node, options) {
            let prefix = `${options.bulletListMarker}   `;
            let indentWidth = 4;
            const parent = node.parentNode as HTMLElement;
            if (parent.nodeName === 'OL') {
                const start = parent.getAttribute('start');
                const index = Array.prototype.indexOf.call(parent.children, node);
                prefix = `${start ? Number(start) + index : index + 1}.  `;
                // Nested blocks must reach the item's content column, which moves right from item 10.
                indentWidth = prefix.length;
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

            content = content
                .trim()
                .replace(/\n/gm, `\n${" ".repeat(indentWidth)}`);
            const result = prefix + content +(node.nextSibling && !/\n$/.test(content) ? '\n' : '');
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

            // Inline math. The import only reads `$…$` as math when no space touches a delimiter,
            // so the equation is trimmed, as CKEditor does when it loads one.
            if (content.startsWith(MATH_INLINE_PREFIX) && content.endsWith(MATH_INLINE_SUFFIX)) {
                return `$${content.substring(MATH_INLINE_PREFIX.length, content.length - MATH_INLINE_SUFFIX.length).trim()}$`;
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

/**
 * Coloured inline text, in every shape it reaches the exporter: CKEditor's Font Color and Font
 * Background Color emit `<span style="color:…">` / `<span style="background-color:…">`, and
 * `<mark>` arrives from pasted or imported HTML. None has a rule of its own, so without this
 * the wrapper is dropped and only the text survives — the colour is silently lost on export.
 *
 * A *plain default-yellow* highlight collapses to `==text==`: that is the colour `==…==`
 * imports to and CKEditor's stock Yellow, so the syntax survives a round-trip unchanged. Every
 * other colour is kept as inline HTML, which Markdown passes through and the importer accepts
 * verbatim — lossless, where `==…==` would silently repaint it yellow.
 *
 * "Plain" means the element carries nothing else that `==…==` cannot express: no second
 * declaration, no class. Anything more and the element is kept whole rather than partly lost.
 * The content is Markdown either way, since Markdown inside an inline tag is still parsed.
 */
function buildHighlightFilter(): Rule {
    // Only a `color`/`background-color` declaration of its own — `border-color` and friends have
    // a `-` before "color" rather than the start of the attribute or a `;`.
    const COLOR_DECLARATION = /(?:^|;)\s*(?:background-)?color\s*:/i;

    return {
        filter(node) {
            return node.nodeName === "MARK"
                || (node.nodeName === "SPAN" && COLOR_DECLARATION.test(node.getAttribute("style") ?? ""));
        },
        replacement(content: string, node: HTMLElement) {
            // Turnish hoists flanking whitespace out of the delimiters, but an element whose only
            // content is a `<br>` still lands here; `==  ==` would not parse back as a highlight.
            if (!content.trim()) {
                return content;
            }

            if (isPlainDefaultHighlight(node)) {
                return `==${content}==`;
            }

            const attributes = Array.from(node.attributes)
                .map((attribute) => ` ${attribute.name}="${escapeHtml(attribute.value)}"`)
                .join("");
            const tag = node.nodeName.toLowerCase();

            return `<${tag}${attributes}>${content}</${tag}>`;
        }
    };
}

/** Whether the element is a highlight in the default colour and carries nothing else. */
function isPlainDefaultHighlight(node: HTMLElement): boolean {
    if (Array.from(node.attributes).some((attribute) => attribute.name !== "style")) {
        return false;
    }

    // The text editor repeats every color in a `--tn-*` variable for the theme to adapt.
    const declarations = parseStyleDeclarations(node.getAttribute("style"))
        .filter(({ property }) => !property.startsWith("--tn-"));

    // A bare `<mark>` is a highlight with no colour of its own; a span always has a declaration,
    // since that is what the filter matched on.
    if (declarations.length === 0) {
        return true;
    }

    if (declarations.length > 1) {
        return false;
    }

    const [ declaration ] = declarations;

    return declaration.property === "background-color"
        && DEFAULT_HIGHLIGHT_BACKGROUNDS.includes(normalizeColor(declaration.value));
}

/** The palette Yellow, and CKEditor's stock yellow that Markdown imports used before it. */
const DEFAULT_HIGHLIGHT_BACKGROUNDS = [ HIGHLIGHT_BACKGROUND, "hsl(60, 75%, 60%)" ]
    .map(normalizeColor);

function parseStyleDeclarations(style: string | null) {
    return (style ?? "")
        .split(";")
        .map((declaration) => declaration.trim())
        .filter((declaration) => declaration.length > 0)
        .map((declaration) => {
            const [ property, ...value ] = declaration.split(":");

            return {
                property: property.trim().toLowerCase(),
                value: value.join(":").trim()
            };
        });
}

/** Colours are compared ignoring case and the spacing browsers and sanitizers move around. */
function normalizeColor(color: string) {
    return color.replace(/\s+/g, "").toLowerCase();
}

// Taken from upstream since it's not exposed.
// https://github.com/mixmark-io/turndown/blob/master/src/commonmark-rules.js
function cleanAttribute(attribute: string | null | undefined) {
    return attribute ? attribute.replace(/(\n+\s*)+/g, '\n') : '';
}

export default {
    toMarkdown
};
