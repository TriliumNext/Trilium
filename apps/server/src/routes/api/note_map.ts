"use strict";

import becca from "../../becca/becca.js";
import { JSDOM } from "jsdom";
import type BNote from "../../becca/entities/bnote.js";
import type BAttribute from "../../becca/entities/battribute.js";
import type { Request } from "express";

interface Backlink {
    noteId: string;
    relationName?: string;
    excerpts?: string[];
}

interface TreeLink {
    sourceNoteId: string;
    targetNoteId: string;
}

function buildDescendantCountMap(noteIdsToCount: string[]) {
    if (!Array.isArray(noteIdsToCount)) {
        throw new Error("noteIdsToCount: type error");
    }

    const noteIdToCountMap = Object.create(null);

    function getCount(noteId: string) {
        if (!(noteId in noteIdToCountMap)) {
            const note = becca.getNote(noteId);
            if (!note) {
                return;
            }

            const hiddenImageNoteIds = note.getRelations("imageLink").map((rel) => rel.value);
            const childNoteIds = note.children.map((child) => child.noteId);
            const nonHiddenNoteIds = childNoteIds.filter((childNoteId) => !hiddenImageNoteIds.includes(childNoteId));

            noteIdToCountMap[noteId] = nonHiddenNoteIds.length;

            for (const child of note.children) {
                noteIdToCountMap[noteId] += getCount(child.noteId);
            }
        }

        return noteIdToCountMap[noteId];
    }
    noteIdsToCount.forEach((noteId) => {
        getCount(noteId);
    });

    return noteIdToCountMap;
}
function getNeighbors(note: BNote, depth: number): string[] {
    if (depth === 0) {
        return [];
    }

    const retNoteIds: string[] = [];

    function isIgnoredRelation(relation: BAttribute) {
        return ["relationMapLink", "template", "inherit", "image", "ancestor"].includes(relation.name);
    }

    // forward links
    for (const relation of note.getRelations()) {
        if (isIgnoredRelation(relation)) {
            continue;
        }

        const targetNote = relation.getTargetNote();

        if (!targetNote || targetNote.isLabelTruthy("excludeFromNoteMap")) {
            continue;
        }

        retNoteIds.push(targetNote.noteId);

        for (const noteId of getNeighbors(targetNote, depth - 1)) {
            retNoteIds.push(noteId);
        }
    }

    // backward links
    for (const relation of note.getTargetRelations()) {
        if (isIgnoredRelation(relation)) {
            continue;
        }

        const sourceNote = relation.getNote();

        if (!sourceNote || sourceNote.isLabelTruthy("excludeFromNoteMap")) {
            continue;
        }

        retNoteIds.push(sourceNote.noteId);

        for (const noteId of getNeighbors(sourceNote, depth - 1)) {
            retNoteIds.push(noteId);
        }
    }

    return retNoteIds;
}

function getLinkMap(req: Request) {
    const mapRootNote = becca.getNoteOrThrow(req.params.noteId);

    // if the map root itself has "excludeFromNoteMap" attribute (journal typically) then there wouldn't be anything
    // to display, so we'll just ignore it
    const ignoreExcludeFromNoteMap = mapRootNote.isLabelTruthy("excludeFromNoteMap");
    let unfilteredNotes;

    const toSet = (data: unknown) => new Set<string>(data instanceof Array ? data : []);

    const excludeRelations = toSet(req.body.excludeRelations);
    const includeRelations = toSet(req.body.includeRelations);

    if (mapRootNote.type === "search") {
        // for search notes, we want to consider the direct search results only without the descendants
        unfilteredNotes = mapRootNote.getSearchResultNotes();
    } else {
        unfilteredNotes = mapRootNote.getSubtree({
            includeArchived: false,
            resolveSearch: true,
            includeHidden: mapRootNote.isInHiddenSubtree()
        }).notes;
    }

    const noteIds = new Set<string>(unfilteredNotes.filter((note) => ignoreExcludeFromNoteMap || !note.isLabelTruthy("excludeFromNoteMap")).map((note) => note.noteId));

    if (mapRootNote.type === "search") {
        noteIds.delete(mapRootNote.noteId);
    }

    for (const noteId of getNeighbors(mapRootNote, 3)) {
        noteIds.add(noteId);
    }

    const noteIdsArray = Array.from(noteIds);

    const notes = noteIdsArray.map((noteId) => {
        const note = becca.getNoteOrThrow(noteId);

        return [note.noteId, note.getTitleOrProtected(), note.type, note.getLabelValue("color")];
    });

    const links = Object.values(becca.attributes)
        .filter((rel) => {
            if (rel.type !== "relation" || rel.name === "relationMapLink" || rel.name === "template" || rel.name === "inherit") {
                return false;
            } else if (!noteIds.has(rel.noteId) || !noteIds.has(rel.value)) {
                return false;
            } else if (rel.name === "imageLink") {
                const parentNote = becca.getNote(rel.noteId);
                if (!parentNote) {
                    return false;
                }

                return !parentNote.getChildNotes().find((childNote) => childNote.noteId === rel.value);
            } else if (includeRelations.size != 0 && !includeRelations.has(rel.name)) {
                return false;
            } else if (excludeRelations.has(rel.name)) {
                return false;
            } else {
                return true;
            }
        })
        .map((rel) => ({
            id: `${rel.noteId}-${rel.name}-${rel.value}`,
            sourceNoteId: rel.noteId,
            targetNoteId: rel.value,
            name: rel.name
        }));

    return {
        notes: notes,
        noteIdToDescendantCountMap: buildDescendantCountMap(noteIdsArray),
        links: links
    };
}

function getTreeMap(req: Request) {
    const mapRootNote = becca.getNoteOrThrow(req.params.noteId);
    // if the map root itself has "excludeFromNoteMap" (journal typically) then there wouldn't be anything to display,
    // so we'll just ignore it
    const ignoreExcludeFromNoteMap = mapRootNote.isLabelTruthy("excludeFromNoteMap");
    const subtree = mapRootNote.getSubtree({
        includeArchived: false,
        resolveSearch: true,
        includeHidden: mapRootNote.isInHiddenSubtree()
    });

    const notes = subtree.notes
        .filter((note) => ignoreExcludeFromNoteMap || !note.isLabelTruthy("excludeFromNoteMap"))
        .filter((note) => {
            if (note.type !== "image" || note.getChildNotes().length > 0) {
                return true;
            }

            const imageLinkRelation = note.getTargetRelations().find((rel) => rel.name === "imageLink");

            if (!imageLinkRelation) {
                return true;
            }

            return !note.getParentNotes().find((parentNote) => parentNote.noteId === imageLinkRelation.noteId);
        })
        .map((note) => [note.noteId, note.getTitleOrProtected(), note.type, note.getLabelValue("color")]);

    const noteIds = new Set<string>();
    notes.forEach(([noteId]) => noteId && noteIds.add(noteId));

    const links: TreeLink[] = [];

    for (const { parentNoteId, childNoteId } of subtree.relationships) {
        if (!noteIds.has(parentNoteId) || !noteIds.has(childNoteId)) {
            continue;
        }

        links.push({
            sourceNoteId: parentNoteId,
            targetNoteId: childNoteId
        });
    }

    const noteIdToDescendantCountMap = buildDescendantCountMap(Array.from(noteIds));

    updateDescendantCountMapForSearch(noteIdToDescendantCountMap, subtree.relationships);

    return {
        notes: notes,
        noteIdToDescendantCountMap: noteIdToDescendantCountMap,
        links: links
    };
}

function updateDescendantCountMapForSearch(noteIdToDescendantCountMap: Record<string, number>, relationships: { parentNoteId: string; childNoteId: string }[]) {
    for (const { parentNoteId, childNoteId } of relationships) {
        const parentNote = becca.notes[parentNoteId];
        if (!parentNote || parentNote.type !== "search") {
            continue;
        }

        noteIdToDescendantCountMap[parentNote.noteId] = noteIdToDescendantCountMap[parentNoteId] || 0;
        noteIdToDescendantCountMap[parentNote.noteId] += noteIdToDescendantCountMap[childNoteId] || 1;
    }
}

function removeImages(document: Document) {
    const images = document.getElementsByTagName("img");
    while (images && images.length > 0) {
        images[0]?.parentNode?.removeChild(images[0]);
    }
}

const EXCERPT_CHAR_LIMIT = 200;
type ElementOrText = Element | Text;

function findExcerpts(sourceNote: BNote, referencedNoteId: string) {
    const html = sourceNote.getContent();
    const document = new JSDOM(html).window.document;

    const excerpts: string[] = [];

    removeImages(document);

    for (const linkEl of document.querySelectorAll("a")) {
        const href = linkEl.getAttribute("href");

        if (!href || !href.endsWith(referencedNoteId)) {
            continue;
        }

        linkEl.classList.add("backlink-link");

        let centerEl: HTMLElement = linkEl;

        while (centerEl.tagName !== "BODY" && centerEl.parentElement && (centerEl.parentElement?.textContent?.length || 0) <= EXCERPT_CHAR_LIMIT) {
            centerEl = centerEl.parentElement;
        }

        const excerptEls: ElementOrText[] = [centerEl];
        let excerptLength = centerEl.textContent?.length || 0;
        let left: ElementOrText = centerEl;
        let right: ElementOrText = centerEl;

        while (excerptLength < EXCERPT_CHAR_LIMIT) {
            let added = false;

            const prev: Element | null = left.previousElementSibling;

            if (prev) {
                const prevText = prev.textContent || "";

                if (prevText.length + excerptLength > EXCERPT_CHAR_LIMIT) {
                    const prefix = prevText.substr(prevText.length - (EXCERPT_CHAR_LIMIT - excerptLength));

                    const textNode = document.createTextNode(`…${prefix}`);
                    excerptEls.unshift(textNode);

                    break;
                }

                left = prev;
                excerptEls.unshift(left);
                excerptLength += prevText.length;
                added = true;
            }

            const next: Element | null = right.nextElementSibling;

            if (next) {
                const nextText = next.textContent;

                if (nextText && nextText.length + excerptLength > EXCERPT_CHAR_LIMIT) {
                    const suffix = nextText.substr(nextText.length - (EXCERPT_CHAR_LIMIT - excerptLength));

                    const textNode = document.createTextNode(`${suffix}…`);
                    excerptEls.push(textNode);

                    break;
                }

                right = next;
                excerptEls.push(right);
                excerptLength += nextText?.length || 0;
                added = true;
            }

            if (!added) {
                break;
            }
        }

        const excerptWrapper = document.createElement("div");
        excerptWrapper.classList.add("ck-content");
        excerptWrapper.classList.add("backlink-excerpt");

        for (const childEl of excerptEls) {
            excerptWrapper.appendChild(childEl);
        }

        excerpts.push(excerptWrapper.outerHTML);
    }
    return excerpts;
}

function getFilteredBacklinks(note: BNote): BAttribute[] {
    return (
        note
            .getTargetRelations()
            // search notes have "ancestor" relations which are not interesting
            .filter((relation) => !!relation.getNote() && relation.getNote().type !== "search")
    );
}

function getBacklinkCount(req: Request) {
    const { noteId } = req.params;

    const note = becca.getNoteOrThrow(noteId);

    return {
        count: getFilteredBacklinks(note).length
    };
}

function getBacklinks(req: Request): Backlink[] {
    const { noteId } = req.params;
    const note = becca.getNoteOrThrow(noteId);

    let backlinksWithExcerptCount = 0;

    return getFilteredBacklinks(note).map((backlink) => {
        const sourceNote = backlink.note;

        if (sourceNote.type !== "text" || backlinksWithExcerptCount > 50) {
            return {
                noteId: sourceNote.noteId,
                relationName: backlink.name
            };
        }

        backlinksWithExcerptCount++;

        const excerpts = findExcerpts(sourceNote, noteId);

        return {
            noteId: sourceNote.noteId,
            excerpts
        };
    });
}

export default {
    getLinkMap,
    getTreeMap,
    getBacklinkCount,
    getBacklinks
};
