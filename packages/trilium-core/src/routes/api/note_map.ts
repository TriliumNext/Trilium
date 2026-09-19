import BAttribute from "../../becca/entities/battribute";
import BNote from "../../becca/entities/bnote";
import becca from "../../becca/becca";
import type { BacklinkCountResponse, BacklinksResponse, NoteMapNote } from "@triliumnext/commons";
import type { Request } from "../../http_interface";

import { findExcerpts, findLlmChatExcerpts, findMindMapExcerpts } from "../../services/backlink_excerpts";

interface TreeLink {
    sourceNoteId: string;
    targetNoteId: string;
}

function buildDescendantCountMap(noteIdsToCount: string[]) {
    /* v8 ignore next 3 -- defensive guard: callers always pass a real array (noteIdsArray / Array.from(noteIds)) */
    if (!Array.isArray(noteIdsToCount)) {
        throw new Error("noteIdsToCount: type error");
    }

    const noteIdToCountMap: Record<string, number> = Object.create(null);

    function getCount(noteId: string): number {
        if (!(noteId in noteIdToCountMap)) {
            const note = becca.getNote(noteId);
            /* v8 ignore next 3 -- defensive guard: noteIds come from real notes / their resolved children */
            if (!note) {
                return 0;
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

function getLinkMap(req: Request<{ noteId: string }>) {
    const mapRootNote = becca.getNoteOrThrow(req.params.noteId);

    // if the map root itself has "excludeFromNoteMap" attribute (journal typically) then there wouldn't be anything
    // to display, so we'll just ignore it
    const ignoreExcludeFromNoteMap = mapRootNote.isLabelTruthy("excludeFromNoteMap");
    // a subtree walk skips an archived note along with everything below it — the map root included,
    // which left an archived note out of its own map, and its relations dropped with it (a link needs
    // both of its ends in the map). Someone reading an archived note is already looking at the
    // archive, so there we keep the archived notes instead of hiding them.
    const includeArchived = mapRootNote.isArchived;
    let unfilteredNotes;

    const toSet = (data: unknown) => new Set<string>(data instanceof Array ? data : []);

    const excludeRelations = toSet(req.body.excludeRelations);
    const includeRelations = toSet(req.body.includeRelations);

    if (mapRootNote.type === "search") {
        // for search notes, we want to consider the direct search results only without the descendants
        unfilteredNotes = mapRootNote.getSearchResultNotes();
    } else {
        unfilteredNotes = mapRootNote.getSubtree({
            includeArchived,
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

    const notes: NoteMapNote[] = noteIdsArray.map((noteId) => {
        const note = becca.getNoteOrThrow(noteId);

        return [ note.noteId, note.getTitleOrProtected(), note.type, note.getLabelValue("color"), note.getIcon() ];
    });

    const links = Object.values(becca.attributes)
        .filter((rel) => {
            if (rel.type !== "relation" || rel.name === "relationMapLink" || rel.name === "template" || rel.name === "inherit") {
                return false;
            } else if (!noteIds.has(rel.noteId) || !noteIds.has(rel.value)) {
                return false;
            } else if (rel.name === "imageLink") {
                const parentNote = becca.getNote(rel.noteId);
                /* v8 ignore next 3 -- defensive guard: rel.noteId is already constrained to noteIds (existing notes) */
                if (!parentNote) {
                    return false;
                }

                return !parentNote.getChildNotes().find((childNote) => childNote.noteId === rel.value);
            } else if (includeRelations.size != 0 && !includeRelations.has(rel.name)) {
                return false;
            } else if (excludeRelations.has(rel.name)) {
                return false;
            }
            return true;

        })
        .map((rel) => ({
            id: `${rel.noteId}-${rel.name}-${rel.value}`,
            sourceNoteId: rel.noteId,
            targetNoteId: rel.value,
            name: rel.name
        }));

    return {
        notes,
        noteIdToDescendantCountMap: buildDescendantCountMap(noteIdsArray),
        links
    };
}

function getTreeMap(req: Request<{ noteId: string }>) {
    const mapRootNote = becca.getNoteOrThrow(req.params.noteId);
    // if the map root itself has "excludeFromNoteMap" (journal typically) then there wouldn't be anything to display,
    // so we'll just ignore it
    const ignoreExcludeFromNoteMap = mapRootNote.isLabelTruthy("excludeFromNoteMap");
    // the map of an archived note keeps the archived notes — see getLinkMap
    const subtree = mapRootNote.getSubtree({
        includeArchived: mapRootNote.isArchived,
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
        .map((note): NoteMapNote => [ note.noteId, note.getTitleOrProtected(), note.type, note.getLabelValue("color"), note.getIcon() ]);

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
        notes,
        noteIdToDescendantCountMap,
        links
    };
}

/**
 * Placements of the map root: every parent path up to `root`, each shared ancestor once.
 *
 * Tree map walks children; this walks `getParentNotes()`. A note cloned under two parents is one
 * node with two incoming edges. `#excludeFromNoteMap` ancestors stay in. Hiding a journal date
 * would punch a hole in the topology.
 *
 * A search note is not a placement of itself: its results are the seeds. Combine is decided on
 * clone paths only, not on other tree children. `any` keeps a note if at least one seed is reachable
 * down those paths. `all` keeps a note if every seed is, and the clone paths from that meet down to
 * the seeds.
 */
function getCloneMap(req: Request<{ noteId: string }>) {
    const mapRootNote = becca.getNoteOrThrow(req.params.noteId);
    const seeds = cloneMapSeeds(mapRootNote);
    const walks = seeds.map((seed) => walkCloneAncestors(seed));
    const { nodeIds, edges } = combineCloneWalks(walks, parseCloneCombine(req.body?.combine));

    return {
        notes: notesFromIds(nodeIds),
        noteIdToDescendantCountMap: {},
        links: edges
    };
}

function cloneMapSeeds(mapRootNote: BNote): BNote[] {
    if (mapRootNote.type !== "search") {
        return [ mapRootNote ];
    }

    return mapRootNote.getSearchResultNotes().filter((note) => note.noteId !== mapRootNote.noteId);
}

interface CloneAncestorWalk {
    seedId: string;
    nodeIds: Set<string>;
    edges: TreeLink[];
}

function walkCloneAncestors(seed: BNote): CloneAncestorWalk {
    const nodeIds = new Set<string>();
    const edges: TreeLink[] = [];
    const seenEdges = new Set<string>();
    const visited = new Set<string>();

    function walk(note: BNote) {
        if (visited.has(note.noteId)) {
            return;
        }
        visited.add(note.noteId);
        nodeIds.add(note.noteId);

        for (const parent of note.getParentNotes()) {
            const edgeKey = `${parent.noteId}->${note.noteId}`;
            if (!seenEdges.has(edgeKey)) {
                seenEdges.add(edgeKey);
                edges.push({
                    sourceNoteId: parent.noteId,
                    targetNoteId: note.noteId
                });
            }
            walk(parent);
        }
    }

    walk(seed);
    return { seedId: seed.noteId, nodeIds, edges };
}

function parseCloneCombine(value: unknown): "any" | "all" {
    return value === "all" ? "all" : "any";
}

function combineCloneWalks(walks: CloneAncestorWalk[], mode: "any" | "all"): {
    nodeIds: Set<string>;
    edges: TreeLink[];
} {
    const unionNodes = new Set<string>();
    const allEdges: TreeLink[] = [];
    const seenEdges = new Set<string>();

    for (const walk of walks) {
        for (const id of walk.nodeIds) {
            unionNodes.add(id);
        }
        for (const edge of walk.edges) {
            const key = `${edge.sourceNoteId}->${edge.targetNoteId}`;
            if (!seenEdges.has(key)) {
                seenEdges.add(key);
                allEdges.push(edge);
            }
        }
    }

    if (mode === "any" || walks.length <= 1) {
        return { nodeIds: unionNodes, edges: allEdges };
    }

    const seedIds = new Set(walks.map((walk) => walk.seedId));
    const childMap = adjacency(allEdges, "source");
    const parentMap = adjacency(allEdges, "target");
    const reachableMemo = new Map<string, Set<string>>();
    const common = new Set<string>();
    for (const id of unionNodes) {
        if (seedIds.has(id)) {
            continue;
        }
        if (reachesEverySeed(id, seedIds, childMap, reachableMemo, new Set())) {
            common.add(id);
        }
    }

    const lcas = lowestCommonAncestors(common, parentMap, childMap);
    const keep = new Set<string>(seedIds);
    if (lcas.size > 0) {
        for (const id of unionNodes) {
            if (!keep.has(id) && reachesLca(id, parentMap, lcas, new Set())) {
                keep.add(id);
            }
        }
    }

    return {
        nodeIds: keep,
        edges: allEdges.filter((edge) => keep.has(edge.sourceNoteId) && keep.has(edge.targetNoteId))
    };
}

function adjacency(edges: TreeLink[], from: "source" | "target"): Map<string, string[]> {
    const map = new Map<string, string[]>();
    for (const edge of edges) {
        const key = from === "source" ? edge.sourceNoteId : edge.targetNoteId;
        const value = from === "source" ? edge.targetNoteId : edge.sourceNoteId;
        const list = map.get(key);
        if (list) {
            list.push(value);
        } else {
            map.set(key, [ value ]);
        }
    }
    return map;
}

/** Whether every seed sits on a clone path below this note. */
function reachesEverySeed(
    noteId: string,
    seedIds: Set<string>,
    childMap: Map<string, string[]>,
    memo: Map<string, Set<string>>,
    visiting: Set<string>
): boolean {
    if (seedIds.size === 0) {
        return false;
    }
    const reached = seedsReachedFrom(noteId, seedIds, childMap, memo, visiting);
    for (const seedId of seedIds) {
        if (!reached.has(seedId)) {
            return false;
        }
    }
    return true;
}

function seedsReachedFrom(
    noteId: string,
    seedIds: Set<string>,
    childMap: Map<string, string[]>,
    memo: Map<string, Set<string>>,
    visiting: Set<string>
): Set<string> {
    const cached = memo.get(noteId);
    if (cached !== undefined) {
        return cached;
    }
    if (visiting.has(noteId)) {
        return new Set();
    }
    visiting.add(noteId);

    const reached = new Set<string>();
    if (seedIds.has(noteId)) {
        reached.add(noteId);
    }
    for (const childId of childMap.get(noteId) ?? []) {
        for (const seedId of seedsReachedFrom(childId, seedIds, childMap, memo, visiting)) {
            reached.add(seedId);
        }
    }
    memo.set(noteId, reached);
    return reached;
}

/**
 * Common clone-path ancestors that have no common clone-path child. A forest root of the union is
 * always common (every walk stops there) and is not the meet: treating it as one would keep every
 * unique clone parent on the way down, and All would draw the same graph as Any.
 */
function lowestCommonAncestors(
    common: Set<string>,
    parentMap: Map<string, string[]>,
    childMap: Map<string, string[]>
): Set<string> {
    const lcas = new Set<string>();
    for (const id of common) {
        if ((parentMap.get(id) ?? []).length === 0) {
            continue;
        }
        const children = childMap.get(id) ?? [];
        let hasCommonChild = false;
        for (const child of children) {
            if (common.has(child)) {
                hasCommonChild = true;
                break;
            }
        }
        if (!hasCommonChild) {
            lcas.add(id);
        }
    }
    return lcas;
}

function reachesLca(
    noteId: string,
    parentMap: Map<string, string[]>,
    lcas: Set<string>,
    visiting: Set<string>
): boolean {
    if (lcas.has(noteId)) {
        return true;
    }
    if (visiting.has(noteId)) {
        return false;
    }
    visiting.add(noteId);
    for (const parent of parentMap.get(noteId) ?? []) {
        if (reachesLca(parent, parentMap, lcas, visiting)) {
            return true;
        }
    }
    return false;
}

function notesFromIds(ids: Set<string>): NoteMapNote[] {
    const notes: NoteMapNote[] = [];
    for (const noteId of ids) {
        const note = becca.getNote(noteId);
        if (!note) {
            continue;
        }
        notes.push([
            note.noteId,
            note.getTitleOrProtected(),
            note.type,
            note.getLabelValue("color"),
            note.getIcon()
        ]);
    }
    return notes;
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

function getFilteredBacklinks(note: BNote): BAttribute[] {
    return (
        note
            .getTargetRelations()
            // search notes have "ancestor" relations which are not interesting
            .filter((relation) => !!relation.getNote() && relation.getNote().type !== "search")
    );
}

function getBacklinks(req: Request<{ noteId: string }>): BacklinksResponse {
    const { noteId } = req.params;
    const note = becca.getNoteOrThrow(noteId);

    let backlinksWithExcerptCount = 0;

    return getFilteredBacklinks(note).map((backlink) => {
        const sourceNote = backlink.note;
        const supportsExcerpts = sourceNote.type === "text" || sourceNote.type === "llmChat" || sourceNote.type === "mindMap";

        if (!supportsExcerpts || backlinksWithExcerptCount > 50) {
            return {
                noteId: sourceNote.noteId,
                relationName: backlink.name
            } satisfies BacklinksResponse[number];
        }

        backlinksWithExcerptCount++;

        const excerpts = findSourceExcerpts(sourceNote, noteId);

        // A chat that references the note only through tool calls has no quotable prose, and a map
        // whose link sits somewhere its nodes are not has no node to quote; name the relation
        // instead, as for other excerpt-less sources.
        if (sourceNote.type !== "text" && excerpts.length === 0) {
            return {
                noteId: sourceNote.noteId,
                relationName: backlink.name
            } satisfies BacklinksResponse[number];
        }

        return {
            noteId: sourceNote.noteId,
            excerpts
        } satisfies BacklinksResponse[number];
    });
}

/** Quotes what surrounds a link, in the terms the note holding it is written in. */
function findSourceExcerpts(sourceNote: BNote, referencedNoteId: string): string[] {
    const content = sourceNote.getContent().toString();

    switch (sourceNote.type) {
        case "llmChat":
            return findLlmChatExcerpts(content, referencedNoteId);
        case "mindMap":
            return findMindMapExcerpts(content, referencedNoteId);
        default:
            return findExcerpts(content, referencedNoteId);
    }
}

function getBacklinkCount(req: Request<{ noteId: string }>): BacklinkCountResponse {
    const { noteId } = req.params;

    const note = becca.getNoteOrThrow(noteId);

    return {
        count: getFilteredBacklinks(note).length
    } satisfies BacklinkCountResponse;
}

export default {
    getLinkMap,
    getTreeMap,
    getCloneMap,
    getBacklinks,
    getBacklinkCount
};
