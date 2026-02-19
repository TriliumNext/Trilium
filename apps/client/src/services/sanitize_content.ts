/**
 * Client-side HTML sanitization for note content rendering.
 *
 * This module provides sanitization of HTML content before it is injected into
 * the DOM, preventing stored XSS attacks. Content written through non-CKEditor
 * paths (Internal API, ETAPI, Sync) may contain malicious scripts, event
 * handlers, or other XSS vectors that must be stripped before rendering.
 *
 * Uses DOMPurify, a well-audited XSS sanitizer that is already a transitive
 * dependency of this project (via mermaid).
 *
 * The configuration is intentionally permissive for rich-text formatting
 * (bold, italic, headings, tables, images, links, etc.) while blocking
 * script execution vectors (script tags, event handlers, javascript: URIs,
 * data: URIs on non-image elements, etc.).
 */
import DOMPurify from "dompurify";

/**
 * Tags allowed in sanitized note content. This mirrors the server-side
 * SANITIZER_DEFAULT_ALLOWED_TAGS from @triliumnext/commons plus additional
 * tags needed for CKEditor content rendering (e.g. <section> for included
 * notes, <figure>/<figcaption> for images and tables).
 *
 * Notably absent: <script>, <style>, <iframe>, <object>, <embed>, <form>,
 * <input> (except checkbox via specific attribute allowance), <link>, <meta>.
 */
const ALLOWED_TAGS = [
    // Headings
    "h1", "h2", "h3", "h4", "h5", "h6",
    // Block elements
    "blockquote", "p", "div", "pre", "section", "article", "aside",
    "header", "footer", "hgroup", "main", "nav", "address", "details", "summary",
    // Lists
    "ul", "ol", "li", "dl", "dt", "dd", "menu",
    // Inline formatting
    "a", "b", "i", "strong", "em", "strike", "s", "del", "ins",
    "abbr", "code", "kbd", "mark", "q", "time", "var", "wbr",
    "small", "sub", "sup", "big", "tt", "samp", "dfn", "bdi", "bdo",
    "cite", "acronym", "data", "rp",
    // Tables
    "table", "thead", "caption", "tbody", "tfoot", "tr", "th", "td",
    "col", "colgroup",
    // Media
    "img", "figure", "figcaption", "video", "audio", "picture",
    "area", "map", "track",
    // Separators
    "hr", "br",
    // Interactive (limited)
    "label", "input",
    // Other
    "span",
    // CKEditor specific
    "en-media"
];

/**
 * Attributes allowed on sanitized elements. DOMPurify uses a flat list
 * of allowed attribute names that apply to all elements.
 */
const ALLOWED_ATTR = [
    // Common
    "class", "style", "title", "id", "dir", "lang", "tabindex",
    "spellcheck", "translate", "hidden",
    // Links
    "href", "target", "rel",
    // Images & media
    "src", "alt", "width", "height", "loading", "srcset", "sizes",
    "controls", "autoplay", "loop", "muted", "preload", "poster",
    // Data attributes (CKEditor uses these extensively)
    // DOMPurify allows data-* by default when ADD_ATTR includes them
    // Tables
    "colspan", "rowspan", "scope", "headers",
    // Input (for checkboxes in task lists)
    "type", "checked", "disabled",
    // Misc
    "align", "valign", "center",
    "open", // for <details>
    "datetime", // for <time>, <del>, <ins>
    "cite" // for <blockquote>, <del>, <ins>
];

/**
 * URI-safe protocols allowed in href/src attributes.
 * Blocks javascript:, vbscript:, and other dangerous schemes.
 */
// Note: data: is intentionally omitted here; it is handled via ADD_DATA_URI_TAGS
// which restricts data: URIs to only <img> elements.
const ALLOWED_URI_REGEXP = /^(?:(?:https?|ftps?|mailto|evernote|file|gemini|git|gopher|irc|irc6|jabber|magnet|sftp|skype|sms|spotify|steam|svn|tel|smb|zotero|geo|obsidian|logseq|onenote|slack):|[^a-z]|[a-z+.\-]+(?:[^a-z+.\-:]|$))/i;

/**
 * DOMPurify configuration for sanitizing note content.
 */
const PURIFY_CONFIG: DOMPurify.Config = {
    ALLOWED_TAGS,
    ALLOWED_ATTR,
    ALLOWED_URI_REGEXP,
    // Allow data-* attributes (used extensively by CKEditor)
    ADD_ATTR: ["data-note-id", "data-note-path", "data-href", "data-language",
               "data-value", "data-box-type", "data-link-id", "data-no-context-menu"],
    // Do not allow <style> or <script> tags
    FORBID_TAGS: ["script", "style", "iframe", "object", "embed", "link", "meta",
                  "base", "noscript", "template"],
    // Do not allow event handler attributes
    FORBID_ATTR: ["onerror", "onload", "onclick", "onmouseover", "onfocus",
                  "onblur", "onsubmit", "onreset", "onchange", "oninput",
                  "onkeydown", "onkeyup", "onkeypress", "onmousedown",
                  "onmouseup", "onmousemove", "onmouseout", "onmouseenter",
                  "onmouseleave", "ondblclick", "oncontextmenu", "onwheel",
                  "ondrag", "ondragend", "ondragenter", "ondragleave",
                  "ondragover", "ondragstart", "ondrop", "onscroll",
                  "oncopy", "oncut", "onpaste", "onanimationend",
                  "onanimationiteration", "onanimationstart",
                  "ontransitionend", "onpointerdown", "onpointerup",
                  "onpointermove", "onpointerover", "onpointerout",
                  "onpointerenter", "onpointerleave", "ontouchstart",
                  "ontouchend", "ontouchmove", "ontouchcancel"],
    // Allow data: URIs only for images (needed for inline images)
    ADD_DATA_URI_TAGS: ["img"],
    // Return a string
    RETURN_DOM: false,
    RETURN_DOM_FRAGMENT: false,
    // Keep the document structure intact
    WHOLE_DOCUMENT: false,
    // Allow target attribute on links
    ADD_TAGS: []
};

// Configure a DOMPurify hook to handle data-* attributes more broadly
// since CKEditor uses many custom data attributes.
DOMPurify.addHook("uponSanitizeAttribute", (node, data) => {
    // Allow all data-* attributes
    if (data.attrName.startsWith("data-")) {
        data.forceKeepAttr = true;
    }
});

/**
 * Sanitizes HTML content for safe rendering in the DOM.
 *
 * This function should be called on all user-provided HTML content before
 * inserting it into the DOM via dangerouslySetInnerHTML, jQuery .html(),
 * or Element.innerHTML.
 *
 * The sanitizer preserves rich-text formatting produced by CKEditor
 * (bold, italic, links, tables, images, code blocks, etc.) while
 * stripping XSS vectors (script tags, event handlers, javascript: URIs).
 *
 * @param dirtyHtml - The untrusted HTML string to sanitize.
 * @returns A sanitized HTML string safe for DOM insertion.
 */
export function sanitizeNoteContentHtml(dirtyHtml: string): string {
    if (!dirtyHtml) {
        return dirtyHtml;
    }
    return DOMPurify.sanitize(dirtyHtml, PURIFY_CONFIG) as string;
}

export default {
    sanitizeNoteContentHtml
};
