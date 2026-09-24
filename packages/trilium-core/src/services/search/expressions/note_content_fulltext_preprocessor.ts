import { extractLlmChatText } from "@triliumnext/commons/src/lib/llm/extract_chat_text.js";
import { extractSpreadsheetText } from "@triliumnext/commons/src/lib/spreadsheet/extract_text.js";
import striptags from "striptags";
import { normalizeSearchText } from "../utils/text_utils";
import { normalize, unescapeHtml } from "../../utils/index";

/** Resolves a note's title by its id, injected so this module stays free of a becca import. */
export type NoteTitleResolver = (noteId: string) => string | null;

export default function preprocessContent(rawContent: string | Uint8Array, type: string, mime: string, raw?: boolean, resolveNoteTitle?: NoteTitleResolver) {
    const originalContent = rawContent.toString();
    let content = normalize(originalContent);

    if (type === "text" && mime === "text/html") {
        if (!raw) {
            // Runs before stripTags(), which discards the data-* metadata and anchor text, and
            // against the original markup, because normalize() lowercases the noteIds it needs.
            const injectedText = [
                extractLinkSearchText(originalContent, resolveNoteTitle),
                extractIconSearchText(originalContent)
            ].filter(Boolean).join(" ");

            // Content size already filtered at DB level, safe to process
            content = stripTags(content);

            if (injectedText) {
                // The body above was normalized, and matchesContent() compares a lowercased query
                // token against the raw string, so the injected text must be normalized too.
                content = `${content} ${normalize(injectedText)}`;
            }
        }

        content = content.replace(/&nbsp;/g, " ");
    } else if (type === "mindMap" && mime === "application/json") {
        content = processMindmapContent(content);
    } else if (type === "canvas" && mime === "application/json") {
        content = processCanvasContent(content);
    } else if (type === "spreadsheet" && mime === "application/json") {
        content = extractSpreadsheetText(content);
    } else if (type === "llmChat" && mime === "application/json") {
        content = extractLlmChatText(content);
    }

    return content.trim();
}

function processMindmapContent(content: string) {
    let mindMapcontent;

    try {
        mindMapcontent = JSON.parse(content);
    } catch (e) {
        return "";
    }

    // Define interfaces for the JSON structure
    interface MindmapNode {
        id: string;
        topic: string;
        children: MindmapNode[]; // Recursive structure
        direction?: number;
        expanded?: boolean;
    }

    interface MindmapData {
        nodedata: MindmapNode;
        arrows: any[]; // If you know the structure, replace `any` with the correct type
        summaries: any[];
        direction: number;
        theme: {
            name: string;
            type: string;
            palette: string[];
            cssvar: Record<string, string>; // Object with string keys and string values
        };
    }

    // Recursive function to collect all topics
    function collectTopics(node?: MindmapNode): string[] {
        if (!node) {
            return [];
        }

        // Collect the current node's topic
        let topics = [node.topic];

        // If the node has children, collect topics recursively
        if (node.children && node.children.length > 0) {
            for (const child of node.children) {
                topics = topics.concat(collectTopics(child));
            }
        }

        return topics;
    }

    // Start extracting from the root node
    const topicsArray = collectTopics(mindMapcontent.nodedata);

    // Combine topics into a single string
    const topicsString = topicsArray.join(", ");

    return normalizeSearchText(topicsString.toString());
}

function processCanvasContent(content: string) {
    interface Element {
        type: string;
        text?: string; // Optional since not all objects have a `text` property
        id: string;
        [key: string]: any; // Other properties that may exist
    }

    let canvasContent;
    try {
        canvasContent = JSON.parse(content);
    } catch (e) {
        return "";
    }
    const elements = canvasContent.elements;

    if (Array.isArray(elements)) {
        const texts = elements
            .filter((element: Element) => element.type === "text" && element.text) // Filter for 'text' type elements with a 'text' property
            .map((element: Element) => element.text!); // Use `!` to assert `text` is defined after filtering

        content = normalize(texts.join(" "));
    } else {
        content = "";
    }
    return content;
}

/** Metadata attributes to index from link previews, in the order they are appended. */
const LINK_PREVIEW_ATTRIBUTES = ["data-url", "data-title", "data-description", "data-site-name"] as const;

// Must match what link_embed_editing.ts writes in its dataDowncast.
const LINK_PREVIEW_TAG_RE = /<(?:section|span)\b[^>]*\bclass=["'][^"']*\blink-(?:embed|mention)\b[^"']*["'][^>]*>/gi;

// Mirrors findInternalLinks() in services/notes.ts, inlined to keep that import out of here.
const INTERNAL_LINK_RE = /href="[^"]*#root[a-zA-Z0-9_\/]*\/([a-zA-Z0-9_]+)\/?"/g;

// Must match what inline_icon_editing.ts writes in its dataDowncast.
export const ICON_TAG_RE = /<span\b[^>]*\bclass=["'][^"']*\btn-icon\b[^"']*["'][^>]*>/gi;

/** The class every icon wears beside its pack's, which says nothing about which icon it is. */
const ICON_MARKER_CLASS = "tn-icon";

/**
 * The pack classes an icon tag wears — `bx-error-circle` from `tn-icon bx bx-error-circle`.
 *
 * The marker is worn by every icon, and a pack's bare prefix — `bx` — by every icon that pack
 * holds, so neither names one. A tag can also wear a class from outside any pack, since the editor
 * keeps what imported markup carried: only a class the tag declares the prefix of draws a glyph,
 * so only those are read. Markup declaring no prefix falls back to every hyphenated class, which
 * is all there is left to go on.
 */
export function readIconClasses(tag: string): string[] {
    const classNames = (extractAttribute(tag, "class") ?? "")
        .split(/\s+/)
        .filter((className) => className && className !== ICON_MARKER_CLASS);
    const prefixes = new Set(classNames.filter((className) => !className.includes("-")));
    const packClasses = classNames.filter((className) => className.includes("-"));
    const named = packClasses.filter((className) => prefixes.has(className.slice(0, className.indexOf("-"))));

    return named.length ? named : packClasses;
}

/** The name inside a pack class: `error-circle` from `bx-error-circle`. */
export function readIconName(className: string): string {
    return className.slice(className.indexOf("-") + 1);
}

/** Collects extra searchable text from a note's link previews and internal-link targets. */
function extractLinkSearchText(content: string, resolveNoteTitle?: NoteTitleResolver): string {
    const parts: string[] = [];

    for (const tag of content.match(LINK_PREVIEW_TAG_RE) ?? []) {
        for (const attrName of LINK_PREVIEW_ATTRIBUTES) {
            const value = extractAttribute(tag, attrName);
            if (value) {
                parts.push(value);
            }
        }
    }

    if (resolveNoteTitle) {
        const seen = new Set<string>();
        let match: RegExpExecArray | null;
        INTERNAL_LINK_RE.lastIndex = 0;
        while ((match = INTERNAL_LINK_RE.exec(content)) !== null) {
            const noteId = match[1];
            if (seen.has(noteId)) {
                continue;
            }
            seen.add(noteId);

            const title = resolveNoteTitle(noteId);
            if (title) {
                parts.push(title);
            }
        }
    }

    return parts.join(" ");
}

/**
 * Collects what the icons in a note's content should be findable by.
 *
 * An icon is an empty element, so stripping the markup leaves nothing of it behind and a note
 * marked with one is unfindable. Each icon's pack class and the name inside it are appended as
 * words instead — `bx bx-error-circle` gives `bx-error-circle error-circle` — so the class serves
 * a search that knows it and the name serves one that does not.
 */
function extractIconSearchText(content: string): string {
    const parts = new Set<string>();

    for (const tag of content.match(ICON_TAG_RE) ?? []) {
        for (const className of readIconClasses(tag)) {
            parts.add(className);
            parts.add(readIconName(className));
        }
    }

    return [ ...parts ].join(" ");
}

/** Reads a single/double-quoted HTML attribute value from a tag string, entity-decoded. */
function extractAttribute(tag: string, attrName: string): string | null {
    const re = new RegExp(`\\b${attrName}=(?:"([^"]*)"|'([^']*)')`, "i");
    const match = re.exec(tag);
    if (!match) {
        return null;
    }

    const rawValue = match[1] !== undefined ? match[1] : match[2];
    return rawValue ? unescapeHtml(rawValue) : null;
}

function stripTags(content: string) {
    // we want to allow link to preserve URLs: https://github.com/zadam/trilium/issues/2412
    // we want to insert space in place of block tags (because they imply text separation)
    // but we don't want to insert text for typical formatting inline tags which can occur within one word
    const linkTag = "a";
    const inlineFormattingTags = ["b", "strong", "em", "i", "span", "big", "small", "font", "sub", "sup"];

    // replace tags which imply text separation with a space
    content = striptags(content, [linkTag, ...inlineFormattingTags], " ");

    // replace the inline formatting tags (but not links) without a space
    content = striptags(content, [linkTag], "");

    // at least the closing link tag can be easily stripped
    return content.replace(/<\/a>/gi, "");
}
