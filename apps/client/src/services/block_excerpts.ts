import "./block_reference.css";

import { resolveBlockReference } from "@triliumnext/commons";

import type FNote from "../entities/fnote.js";
import { t } from "./i18n.js";

const MAX_CACHED_NOTES = 20;
const EXCERPT_LENGTH = 60;

/** What a reference link shows for the blocks it points at. */
export interface BlockReferenceLabel {
    text: string;
    isBroken: boolean;
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
    return content ? getLabel(content, block) : null;
}

/** The label of {@link loadBlockReferenceLabel}, if the content of `note` is loaded already. */
export function getCachedBlockReferenceLabel(note: FNote, block: string) {
    const cached = cache.get(note.noteId);
    if (cached?.blobId !== note.blobId || !cached.content) {
        return null;
    }

    return getLabel(cached.content, block);
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

function getLabel(content: Document, block: string): BlockReferenceLabel {
    const { start, end } = resolveBlockReference<Element>(content.body, block);
    if (!start || !end) {
        return { text: t("block_reference.broken"), isBroken: true };
    }

    return { text: getBlockExcerpt(start, end), isBroken: false };
}

function loadContent(note: FNote) {
    if (note.type !== "text" || !note.isContentAvailable()) {
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
        .then((blob) => {
            entry.content = new DOMParser().parseFromString(blob?.content ?? "", "text/html");
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

/** The text of `element`; a tab is named by its title. */
function getText(element: Element) {
    const title = element.matches(".trilium-tab")
        ? element.querySelector(":scope > .trilium-tab-title")
        : null;
    return ((title ?? element).textContent ?? "").replace(/\s+/g, " ").trim();
}

function truncate(text: string, maxLength: number) {
    return text.length > maxLength ? `${text.slice(0, maxLength - 1).trimEnd()}…` : text;
}
