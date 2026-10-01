import { buildReificationTitle, NoteMapLink, NoteMapPostResponse, NoteMapReificationLink } from "@triliumnext/commons";
import server from "../../services/server";
import { LinkObject, NodeObject } from "force-graph";

type MapType = "tree" | "link";

interface GroupedLink {
    id: string;
    sourceNoteId: string;
    targetNoteId: string;
    names: string[];
}

/** The relation a folded node stands for, so a click can create the note for that row. */
export interface NoteMapFold {
    linkId: string;
    sourceNoteId: string;
    targetNoteId: string;
    predicate: string;
}

export interface NoteMapNodeObject extends NodeObject {
    id: string;
    name: string;
    type: string;
    /** What the note asks to be drawn in through its `color` label, if it asks at all. */
    color: string | null;
    /** The note's icon, as the classes it is drawn with everywhere else (e.g. `tn-icon bx bx-file`). */
    icon: string;
    /** Set when this circle is a relation folded out of the two notes it joined. */
    fold?: NoteMapFold;
}

export interface NoteMapLinkObject extends LinkObject<NoteMapNodeObject> {
    id: string;
    name: string;
    x?: number;
    y?: number;
}

export interface NotesAndRelationsData {
    nodes: NoteMapNodeObject[];
    links: {
        id: string;
        source: string | NoteMapNodeObject;
        target: string | NoteMapNodeObject;
        name: string;
    }[];
    noteIdToSizeMap: Record<string, number>;
    /** Relations of a folded fact. Absent from the drawn graph until that fact is a node. */
    reificationLinks?: NoteMapReificationLink[];
}

/**
 * @param hideUnlinkedNotes drops the notes that no relation touches from a link map, keeping only
 *                          the map root itself. The link map's nodes are the root's whole subtree
 *                          while its edges are relations only, so every descendant without a
 *                          relation is drawn as a loose dot — and still pushes the rest of the graph
 *                          around through the charge force. Worth hiding in a small local view of
 *                          one note; the full-size maps keep the subtree their users expect of them.
 */
export async function loadNotesAndRelations(mapRootNoteId: string, excludeRelations: string[], includeRelations: string[], mapType: MapType, hideUnlinkedNotes = false): Promise<NotesAndRelationsData> {
    const resp = await server.post<NoteMapPostResponse>(`note-map/${mapRootNoteId}/${mapType}`, {
        excludeRelations, includeRelations
    });

    const noteIdToSizeMap = calculateNodeSizes(resp, mapType);
    const links = getGroupedLinks(resp.links);
    let nodes = resp.notes.map(([noteId, title, type, color, icon]) => ({
        id: noteId,
        name: title,
        type,
        color,
        icon
    }));

    // A tree map links every node to its parent, so it has no unlinked notes to speak of.
    if (hideUnlinkedNotes && mapType === "link") {
        nodes = dropUnlinkedNotes(nodes, links, mapRootNoteId);
    }

    return {
        noteIdToSizeMap,
        nodes,
        links: links.map((link) => ({
            id: `${link.sourceNoteId}-${link.targetNoteId}`,
            source: link.sourceNoteId,
            target: link.targetNoteId,
            name: link.names.join(", ")
        })),
        reificationLinks: resp.reificationLinks ?? []
    };
}

/**
 * Keeps only the notes some relation touches, plus the map root itself — a note with no relations at
 * all is still worth showing as itself, rather than as an empty map.
 *
 * Filtering never empties the map: a search note is not part of its own results, so a search whose
 * results link to nothing would otherwise be left with no node to keep at all.
 */
export function dropUnlinkedNotes<T extends { id: string }>(nodes: T[], links: GroupedLink[], mapRootNoteId: string) {
    const linkedNoteIds = new Set(links.flatMap((link) => [ link.sourceNoteId, link.targetNoteId ]));
    const kept = nodes.filter((node) => node.id === mapRootNoteId || linkedNoteIds.has(node.id));

    return kept.length > 0 ? kept : nodes;
}

function calculateNodeSizes(resp: NoteMapPostResponse, mapType: MapType) {
    const noteIdToSizeMap: Record<string, number> = {};

    if (mapType === "tree") {
        const { noteIdToDescendantCountMap } = resp;

        for (const noteId in noteIdToDescendantCountMap) {
            noteIdToSizeMap[noteId] = 4;

            const count = noteIdToDescendantCountMap[noteId];

            if (count > 0) {
                noteIdToSizeMap[noteId] += 1 + Math.round(Math.log(count) / Math.log(1.5));
            }
        }
    } else if (mapType === "link") {
        const noteIdToLinkCount: Record<string, number> = {};

        for (const link of resp.links) {
            noteIdToLinkCount[link.targetNoteId] = 1 + (noteIdToLinkCount[link.targetNoteId] || 0);
        }

        for (const [noteId] of resp.notes) {
            noteIdToSizeMap[noteId] = 4;

            if (noteId in noteIdToLinkCount) {
                noteIdToSizeMap[noteId] += Math.min(Math.pow(noteIdToLinkCount[noteId], 0.5), 15);
            }
        }
    }

    return noteIdToSizeMap;
}

const FOLD_NODE_SIZE = 6;

/**
 * Replaces each collapsed relation with one node, and folds that node again when a relation of it
 * is collapsed too.
 *
 * A note that survives is the same object it was, so a position the graph has already given it
 * stays. The folded node sits halfway between the two things it replaces.
 */
export function collapseRelations(data: NotesAndRelationsData, collapsedLinkIds: ReadonlySet<string>): NotesAndRelationsData {
    if (collapsedLinkIds.size === 0) {
        return data;
    }

    const nodesById = new Map(data.nodes.map((node) => [ node.id, node ]));
    const parent = new Map<string, string>();
    const folds = new Map<string, NoteMapNodeObject>();

    const find = (noteId: string): string => {
        let current = noteId;
        const seen = new Set<string>();
        while (parent.has(current) && !seen.has(current)) {
            const next = parent.get(current);
            if (!next || next === current) {
                return current;
            }
            seen.add(current);
            current = next;
        }
        return current;
    };
    const linkInto = (from: string, to: string) => {
        const child = find(from);
        const root = find(to);
        if (child !== root) {
            parent.set(child, root);
        }
    };
    const labelOf = (noteId: string) => folds.get(find(noteId))?.name ?? nodesById.get(noteId)?.name ?? "";
    const positionOf = (noteId: string) => {
        const root = find(noteId);
        const fold = folds.get(root);
        if (fold) {
            return { x: fold.x ?? 0, y: fold.y ?? 0 };
        }
        const node = nodesById.get(noteId);
        return { x: node?.x ?? 0, y: node?.y ?? 0 };
    };

    for (const linkId of collapsedLinkIds) {
        const link = data.links.find((item) => item.id === linkId);
        const predicate = link?.name.split(",")[0]?.trim();
        if (!link || !predicate) {
            continue;
        }
        const sourceId = endId(link.source);
        const targetId = endId(link.target);
        const subject = positionOf(sourceId);
        const object = positionOf(targetId);
        const foldId = `fold:${linkId}`;
        const fold: NoteMapNodeObject = {
            id: foldId,
            name: buildReificationTitle({
                subjectTitle: labelOf(sourceId),
                predicate,
                objectTitle: labelOf(targetId)
            }),
            type: "text",
            color: null,
            icon: "bx bx-git-commit",
            x: (subject.x + object.x) / 2,
            y: (subject.y + object.y) / 2,
            fold: { linkId, sourceNoteId: sourceId, targetNoteId: targetId, predicate }
        };
        folds.set(foldId, fold);
        data.noteIdToSizeMap[foldId] = FOLD_NODE_SIZE;
        if (!parent.has(foldId)) {
            parent.set(foldId, foldId);
        }
        linkInto(sourceId, foldId);
        linkInto(targetId, foldId);
    }

    if (folds.size === 0) {
        return data;
    }

    const nodes: NoteMapNodeObject[] = [];
    for (const node of data.nodes) {
        if (find(node.id) === node.id) {
            nodes.push(node);
        }
    }
    for (const [ foldId, fold ] of folds) {
        if (find(foldId) === foldId) {
            nodes.push(fold);
        }
    }

    const links: NotesAndRelationsData["links"] = [];
    const keptEnds = new Set<string>();
    const droppedEnds = new Set<string>();
    for (const link of data.links) {
        const rawSource = endId(link.source);
        const rawTarget = endId(link.target);
        if (collapsedLinkIds.has(link.id)) {
            continue;
        }
        const source = find(rawSource);
        const target = find(rawTarget);
        // The fold is the fact, not the two notes it joined. A relation of one of
        // those notes is not a relation of the fact, so it is not redrawn from the fold.
        if (source !== rawSource || target !== rawTarget || source === target) {
            if (source === rawSource) {
                droppedEnds.add(rawSource);
            }
            if (target === rawTarget) {
                droppedEnds.add(rawTarget);
            }
            continue;
        }
        links.push({ id: link.id, source, target, name: link.name });
        keptEnds.add(source);
        keptEnds.add(target);
    }

    for (const attachment of data.reificationLinks ?? []) {
        if (!collapsedLinkIds.has(attachment.linkId)) {
            continue;
        }
        const [ noteId, title, type, color, icon ] = attachment.note;
        const foldId = find(`fold:${attachment.linkId}`);
        const otherId = find(noteId);
        if (!otherId || foldId === otherId) {
            continue;
        }
        if (!nodesById.has(noteId) && !nodes.some((node) => node.id === noteId)) {
            const added: NoteMapNodeObject = {
                id: noteId,
                name: title,
                type,
                color,
                icon
            };
            nodes.push(added);
            nodesById.set(noteId, added);
            data.noteIdToSizeMap[noteId] = FOLD_NODE_SIZE;
        }
        links.push({
            id: `${attachment.linkId}-${attachment.name}-${noteId}`,
            source: attachment.outgoing ? foldId : otherId,
            target: attachment.outgoing ? otherId : foldId,
            name: attachment.name
        });
        keptEnds.add(foldId);
        keptEnds.add(otherId);
    }

    const visibleNodes = nodes.filter((node) => !droppedEnds.has(node.id) || keptEnds.has(node.id));

    return { noteIdToSizeMap: data.noteIdToSizeMap, nodes: visibleNodes, links, reificationLinks: data.reificationLinks };
}

export interface ReificationEnds {
    rootId: string;
    predicate: string;
    subject: NoteMapNodeObject;
    object: NoteMapNodeObject | null;
}

/**
 * Puts the two notes of a fact back, with the fact as the line between them.
 * Relations of the fact leave with it. Either note can then be opened on its own.
 */
export function expandReification(data: NotesAndRelationsData, ends: ReificationEnds): NotesAndRelationsData {
    const noteIdToSizeMap = { ...data.noteIdToSizeMap };
    const nodes: NoteMapNodeObject[] = [];
    for (const node of data.nodes) {
        if (node.id !== ends.rootId) {
            nodes.push(node);
        }
    }
    for (const extra of [ ends.subject, ends.object ]) {
        if (!extra || nodes.some((node) => node.id === extra.id)) {
            continue;
        }
        nodes.push(extra);
        if (!(extra.id in noteIdToSizeMap)) {
            noteIdToSizeMap[extra.id] = 4;
        }
    }

    const links: NotesAndRelationsData["links"] = [];
    for (const link of data.links) {
        if (endId(link.source) === ends.rootId || endId(link.target) === ends.rootId) {
            continue;
        }
        links.push(link);
    }
    if (ends.object) {
        links.push({
            id: `${ends.subject.id}-${ends.object.id}`,
            source: ends.subject.id,
            target: ends.object.id,
            name: ends.predicate
        });
    }

    const linked = new Set<string>();
    for (const link of links) {
        linked.add(endId(link.source));
        linked.add(endId(link.target));
    }
    if (!ends.object) {
        linked.add(ends.subject.id);
    }

    return {
        noteIdToSizeMap,
        nodes: nodes.filter((node) => linked.has(node.id)),
        links,
        reificationLinks: data.reificationLinks
    };
}

function endId(end: string | NoteMapNodeObject): string {
    return typeof end === "string" ? end : end.id;
}

function getGroupedLinks(links: NoteMapLink[]): GroupedLink[] {
    const linksGroupedBySourceTarget: Record<string, GroupedLink> = {};

    for (const link of links) {
        const key = `${link.sourceNoteId}-${link.targetNoteId}`;

        if (key in linksGroupedBySourceTarget) {
            if (!linksGroupedBySourceTarget[key].names.includes(link.name)) {
                linksGroupedBySourceTarget[key].names.push(link.name);
            }
        } else {
            linksGroupedBySourceTarget[key] = {
                id: key,
                sourceNoteId: link.sourceNoteId,
                targetNoteId: link.targetNoteId,
                names: [link.name]
            };
        }
    }

    return Object.values(linksGroupedBySourceTarget);
}
