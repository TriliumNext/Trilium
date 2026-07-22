import { extractLlmChatText } from "@triliumnext/commons/src/lib/llm/extract_chat_text.js";
import { extractSpreadsheetText } from "@triliumnext/commons/src/lib/spreadsheet/extract_text.js";
import striptags from "striptags";
import { normalizeSearchText } from "../utils/text_utils";
import { normalize, unescapeHtml } from "../../utils/index";

/**
 * Resolves a note's title by its id. Injected by the caller so this module stays
 * pure and browser-safe (no becca import here). Returns null for unknown notes.
 */
export type NoteTitleResolver = (noteId: string) => string | null;

export default function preprocessContent(rawContent: string | Uint8Array, type: string, mime: string, raw?: boolean, resolveNoteTitle?: NoteTitleResolver) {
    const originalContent = rawContent.toString();
    let content = normalize(originalContent);

    if (type === "text" && mime === "text/html") {
        if (!raw) {
            // Pull searchable text out of link previews and internal-link targets BEFORE
            // stripTags discards their data-* metadata and (stale) anchor text. Extraction
            // runs against the original, case-preserved markup so link target noteIds still
            // resolve (normalize() lowercases, which would corrupt the ids).
            const injectedText = extractLinkSearchText(originalContent, resolveNoteTitle);

            // Content size already filtered at DB level, safe to process
            content = stripTags(content);

            if (injectedText) {
                content = `${content} ${injectedText}`;
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

// Matches the opening tag of a link-embed section or link-mention span (serialized by
// packages/ckeditor5/src/plugins/link_embed/link_embed_editing.ts dataDowncast).
const LINK_PREVIEW_TAG_RE = /<(?:section|span)\b[^>]*\bclass=["'][^"']*\blink-(?:embed|mention)\b[^"']*["'][^>]*>/gi;

// Copy of services/notes.ts findInternalLinks: captures the target noteId of a reference
// link or plain internal link. Kept inline so the preprocessor stays free of the notes service.
const INTERNAL_LINK_RE = /href="[^"]*#root[a-zA-Z0-9_\/]*\/([a-zA-Z0-9_]+)\/?"/g;

/**
 * Builds a space-separated bag of extra searchable text from a text/html note's link
 * previews (their data-* metadata) and internal-link targets (their resolved titles).
 */
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
