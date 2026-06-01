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
import DOMPurify, { type Config as DOMPurifyConfig } from "dompurify";

/**
 * URI-safe protocols allowed in href/src attributes.
 * Blocks javascript:, vbscript:, and other dangerous schemes.
 */
// Note: data: is intentionally omitted here; it is handled via ADD_DATA_URI_TAGS
// which restricts data: URIs to only <img> elements.
const ALLOWED_URI_REGEXP = /^(?:(?:https?|ftps?|mailto|evernote|file|gemini|git|gopher|irc|irc6|jabber|magnet|sftp|skype|sms|spotify|steam|svn|tel|smb|zotero|geo|obsidian|logseq|onenote|slack):|[^a-z]|[a-z+.\-]+(?:[^a-z+.\-:]|$))/i;

/**
 * DOMPurify configuration for sanitizing note content.
 *
 * Uses DOMPurify's built-in security-researched profiles for HTML, SVG, and
 * MathML rather than a hand-maintained tag allowlist. This ensures proper
 * namespace handling (critical for SVG rendering in mermaid/canvas/mind-map
 * notes and MathML in KaTeX equations) while staying current with DOMPurify's
 * upstream security fixes.
 *
 * Defense-in-depth is provided via FORBID_TAGS / FORBID_ATTR which explicitly
 * block known-dangerous elements and all event-handler attributes, regardless
 * of what the profiles permit.
 */
const PURIFY_CONFIG: DOMPurifyConfig = {
    // Enable DOMPurify's curated safe-element sets for HTML, SVG, and MathML.
    // This replaces a manual ALLOWED_TAGS list and correctly handles namespace
    // parsing (e.g. SVG elements must be in the SVG namespace to render).
    USE_PROFILES: { html: true, svg: true, svgFilters: true, mathMl: true },
    ALLOWED_URI_REGEXP,
    // CKEditor data-* attributes not in the default set
    ADD_ATTR: ["data-note-id", "data-note-path", "data-href", "data-language",
               "data-value", "data-box-type", "data-link-id", "data-no-context-menu"],
    // CKEditor custom elements
    ADD_TAGS: ["en-media"],
    // ── Explicit deny-lists (defense-in-depth) ──
    // Script execution vectors
    FORBID_TAGS: ["script", "style", "iframe", "object", "embed", "link", "meta",
                  "base", "noscript", "template",
                  // SVG elements that can execute scripts or embed arbitrary HTML
                  "foreignObject",
                  // SVG animation elements — can trigger event handlers via
                  // onbegin/onend/onrepeat attributes
                  "animate", "animateMotion", "animateTransform", "set"],
    // All DOM event-handler attributes
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
                  "ontouchend", "ontouchmove", "ontouchcancel",
                  // SVG animation event handlers
                  "onbegin", "onend", "onrepeat"],
    // Allow data: URIs only for images (needed for inline images)
    ADD_DATA_URI_TAGS: ["img"],
    RETURN_DOM: false,
    RETURN_DOM_FRAGMENT: false,
    WHOLE_DOCUMENT: false
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
