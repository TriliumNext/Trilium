/**
 * SVG sanitizer to prevent stored XSS via malicious SVG content.
 *
 * SVG files can contain embedded JavaScript via <script> tags, event handler
 * attributes (onload, onclick, etc.), <foreignObject> elements, and
 * javascript: URIs. This sanitizer strips all such dangerous constructs
 * while preserving legitimate SVG rendering elements.
 *
 * Defense-in-depth: SVG responses also receive a restrictive
 * Content-Security-Policy header (see {@link setSvgHeaders}) to block
 * script execution even if sanitization is bypassed.
 */

import type { Response } from "express";

// Elements that MUST be removed from SVG (they can execute code or embed arbitrary HTML)
const DANGEROUS_ELEMENTS = new Set([
    "script",
    "foreignobject",
    "iframe",
    "embed",
    "object",
    "applet",
    "base",
    "link",       // can load external resources
    "meta",
]);

// Attribute prefixes/names that indicate event handlers
const EVENT_HANDLER_PATTERN = /^on[a-z]/i;

// Dangerous attribute values (javascript:, data: with script content, vbscript:)
const DANGEROUS_URI_PATTERN = /^\s*(javascript|vbscript|data\s*:\s*text\/html)/i;

// Attributes that can contain URIs
const URI_ATTRIBUTES = new Set([
    "href",
    "xlink:href",
    "src",
    "action",
    "formaction",
    "data",
]);

// SVG "set" and "animate" elements can modify attributes to dangerous values
const DANGEROUS_ANIMATION_ATTRIBUTES = new Set([
    "attributename",
]);

/**
 * Sanitizes SVG content by removing dangerous elements and attributes
 * that could lead to script execution (XSS).
 *
 * This uses regex-based parsing rather than a full DOM parser to avoid
 * adding heavy dependencies. The approach is conservative: it removes
 * known-dangerous constructs rather than allowlisting, but combined with
 * the CSP header this provides robust protection.
 */
export function sanitizeSvg(svg: string | Buffer): string {
    let content = typeof svg === "string" ? svg : svg.toString("utf-8");

    // 1. Remove dangerous elements and their contents entirely.
    //    Use a case-insensitive regex that handles self-closing and content-bearing tags.
    for (const element of DANGEROUS_ELEMENTS) {
        // Remove opening+closing tag pairs (including content between them)
        const pairRegex = new RegExp(
            `<${element}[\\s>][\\s\\S]*?<\\/${element}\\s*>`,
            "gi"
        );
        content = content.replace(pairRegex, "");

        // Remove self-closing variants
        const selfClosingRegex = new RegExp(
            `<${element}(\\s[^>]*)?\\/?>`,
            "gi"
        );
        content = content.replace(selfClosingRegex, "");
    }

    // 2. Remove event handler attributes (onclick, onload, onerror, etc.)
    //    and dangerous URI attributes from all remaining elements.
    content = content.replace(/<([a-zA-Z][a-zA-Z0-9-]*)((?:\s+[^>]*?)?)(\s*\/?>)/g,
        (_match, tagName, attrs, closing) => {
            if (!attrs || !attrs.trim()) {
                return `<${tagName}${closing}`;
            }

            // Parse and filter attributes
            const sanitizedAttrs = sanitizeAttributes(attrs);
            return `<${tagName}${sanitizedAttrs}${closing}`;
        }
    );

    // 3. Remove processing instructions that could be exploited
    content = content.replace(/<\?xml-stylesheet[^?]*\?>/gi, "");

    return content;
}

/**
 * Sanitizes the attribute string of an SVG element by removing
 * event handlers and dangerous URI values.
 */
function sanitizeAttributes(attrString: string): string {
    // Match individual attributes: name="value", name='value', name=value, or standalone name
    return attrString.replace(
        /\s+([a-zA-Z_:][\w:.-]*)\s*(?:=\s*(?:"([^"]*)"|'([^']*)'|(\S+)))?/g,
        (fullMatch, attrName, dblVal, sglVal, unquotedVal) => {
            const lowerAttrName = attrName.toLowerCase();
            const attrValue = dblVal ?? sglVal ?? unquotedVal ?? "";

            // Remove all event handler attributes
            if (EVENT_HANDLER_PATTERN.test(lowerAttrName)) {
                return "";
            }

            // Check URI-bearing attributes for dangerous schemes
            if (URI_ATTRIBUTES.has(lowerAttrName)) {
                if (DANGEROUS_URI_PATTERN.test(attrValue)) {
                    return "";
                }
            }

            // Block animation elements from targeting event handlers via attributeName
            if (DANGEROUS_ANIMATION_ATTRIBUTES.has(lowerAttrName)) {
                const targetAttr = attrValue.toLowerCase();
                if (EVENT_HANDLER_PATTERN.test(targetAttr) || targetAttr === "href" || targetAttr === "xlink:href") {
                    return "";
                }
            }

            return fullMatch;
        }
    );
}

/**
 * Sets security headers appropriate for SVG responses.
 * This provides defense-in-depth: even if SVG sanitization is somehow
 * bypassed, the CSP header prevents script execution.
 */
export function setSvgHeaders(res: Response): void {
    res.set("Content-Type", "image/svg+xml");
    res.set("Cache-Control", "no-cache, no-store, must-revalidate");
    // Restrictive CSP that allows SVG rendering but blocks all script execution,
    // inline event handlers, and plugin-based content.
    res.set(
        "Content-Security-Policy",
        "default-src 'none'; style-src 'unsafe-inline'; img-src 'self' data:; font-src 'self' data:"
    );
    // Prevent SVG from being reinterpreted in a different MIME context
    res.set("X-Content-Type-Options", "nosniff");
}

export default {
    sanitizeSvg,
    setSvgHeaders
};
