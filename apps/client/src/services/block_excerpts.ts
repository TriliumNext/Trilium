import "./block_reference.css";

import {
    BLOCK_ID_ATTRIBUTE, parseBlockRange
} from "@triliumnext/commons/src/lib/block_reference.js";

import type FNote from "../entities/fnote.js";
import { t } from "./i18n.js";

const MAX_CACHED_NOTES = 20;
const EXCERPT_LENGTH = 60;
const HEADING_TAG = /^H[1-6]$/;
const BLOCK_LINK = "a.reference-link[href*=\"block=\"]";

/** What a reference link shows for the blocks it points at. */
export interface BlockReferenceLabel {
    text: string;
    isBroken: boolean;
    /** Whether the blocks are one heading, whose whole text the label holds. */
    isHeading: boolean;
}

interface CachedContent {
    blobId: string;
    content: Document | null;
    loaded: Promise<Document | null>;
}

const cache = new Map<string, CachedContent>();

/**
 * The label of a reference to `block`, a `block` link parameter, of `note`. `null` when the
 * content of the note cannot be read.
 */
export async function loadBlockReferenceLabel(note: FNote, block: string) {
    const content = await loadContent(note);
    return content ? getBlockReferenceLabel(content, block) : null;
}

/** The label of {@link loadBlockReferenceLabel}, if the content of `note` is loaded already. */
export function getCachedBlockReferenceLabel(note: FNote, block: string) {
    const cached = cache.get(note.noteId);
    if (cached?.blobId !== note.blobId || !cached.content) {
        return null;
    }

    return getBlockReferenceLabel(cached.content, block);
}

/** A short text of the blocks from `start` to `end`. */
export function getBlockExcerpt(start: Element, end: Element) {
    const blocks = start === end ? [ start ] : [ start, end ];
    const maxLength = EXCERPT_LENGTH / blocks.length;
    const texts = blocks
        .map((block) => truncate(getText(block), maxLength))
        .filter((text) => text);

    return texts.join(" … ") || t("block_reference.untitled");
}

/**
 * The label of a reference to `block`, a `block` link parameter, of the blocks under `root`, such
 * as the content of an editor.
 */
export function getBlockReferenceLabel(root: ParentNode, block: string): BlockReferenceLabel {
    const blocks = findBlocks(root, block);
    if (!blocks) {
        return { text: t("block_reference.broken"), isBroken: true, isHeading: false };
    }

    const [ start, end ] = blocks;
    if (start === end && HEADING_TAG.test(start.tagName)) {
        const text = getText(start) || t("block_reference.untitled");
        return { text, isBroken: false, isHeading: true };
    }

    return { text: getBlockExcerpt(start, end), isBroken: false, isHeading: false };
}

/**
 * The first and the last block that `block` points at under `root`, in document order, as
 * `resolveBlockReference()` finds them. A selector reaches the blocks with an id without a walk
 * through every node.
 */
function findBlocks(root: ParentNode, block: string): [ Element, Element ] | null {
    const range = parseBlockRange(block);
    if (!range) {
        return null;
    }

    const blocks = [ ...root.querySelectorAll(`[${BLOCK_ID_ATTRIBUTE}]`) ];
    const indexOf = (id: string) =>
        blocks.findIndex((element) => element.getAttribute(BLOCK_ID_ATTRIBUTE) === id);
    const start = indexOf(range.startId);
    const end = indexOf(range.endId);
    if (start < 0 || end < 0) {
        return null;
    }

    return [ blocks[Math.min(start, end)], blocks[Math.max(start, end)] ];
}

function loadContent(note: FNote) {
    const isMarkdown = note.isMarkdown();
    if ((note.type !== "text" && !isMarkdown) || !note.isContentAvailable()) {
        return Promise.resolve(null);
    }

    const cached = cache.get(note.noteId);
    if (cached?.blobId === note.blobId) {
        return cached.loaded;
    }

    const entry: CachedContent = {
        blobId: note.blobId,
        content: null,
        loaded: Promise.resolve(null)
    };
    entry.loaded = note.getBlob()
        .then(async (blob) => {
            const content = blob?.content ?? "";
            const html = isMarkdown ? await renderMarkdown(content) : content;
            entry.content = new DOMParser().parseFromString(html, "text/html");
            return entry.content;
        })
        .catch(() => {
            if (cache.get(note.noteId) === entry) {
                cache.delete(note.noteId);
            }
            return null;
        });

    cache.delete(note.noteId);
    cache.set(note.noteId, entry);
    if (cache.size > MAX_CACHED_NOTES) {
        cache.delete(cache.keys().next().value as string);
    }

    return entry.loaded;
}

/**
 * The HTML of the Markdown `source`, where block markers are ids, as the preview renders it. The
 * renderer loads with the first Markdown label: this module is on the startup path.
 */
async function renderMarkdown(source: string) {
    const [ { renderToHtml }, { default: DOMPurify } ] = await Promise.all([
        import("@triliumnext/commons/src/lib/markdown_renderer.js"),
        import("dompurify")
    ]);
    return renderToHtml(source, "", {
        sanitize: (html) => DOMPurify.sanitize(html), demoteH1: false
    });
}

/**
 * The text of `element`; a tab is named by its title. The labels of the block references in it are
 * left out, since they hold the text of a block, which can be this one.
 */
function getText(element: Element) {
    const title = element.matches(".trilium-tab")
        ? element.querySelector(":scope > .trilium-tab-title")
        : null;
    let source = title ?? element;
    if (source.querySelector(BLOCK_LINK)) {
        source = source.cloneNode(true) as Element;
        for (const link of source.querySelectorAll(BLOCK_LINK)) {
            link.remove();
        }
    }

    return (source.textContent as string).replace(/\s+/g, " ").trim();
}

function truncate(text: string, maxLength: number) {
    return text.length > maxLength ? `${text.slice(0, maxLength - 1).trimEnd()}…` : text;
}
