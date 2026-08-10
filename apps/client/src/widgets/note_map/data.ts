import { NoteMapLink, NoteMapPostResponse } from "@triliumnext/commons";
import server from "../../services/server";
import { LinkObject, NodeObject } from "force-graph";

type MapType = "tree" | "link";

interface GroupedLink {
    id: string;
    sourceNoteId: string;
    targetNoteId: string;
    names: string[];
}

export interface NoteMapNodeObject extends NodeObject {
    id: string;
    name: string;
    type: string;
    /** What the note asks to be drawn in through its `color` label, if it asks at all. */
    color: string | null;
    /** The note's icon, as the classes it is drawn with everywhere else (e.g. `tn-icon bx bx-file`). */
    icon: string;
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
        }))
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
