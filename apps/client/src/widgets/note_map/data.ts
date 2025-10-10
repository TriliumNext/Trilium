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
    color: string;
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

export async function loadNotesAndRelations(mapRootNoteId: string, excludeRelations: string[], includeRelations: string[], mapType: MapType): Promise<NotesAndRelationsData> {
    const resp = await server.post<NoteMapPostResponse>(`note-map/${mapRootNoteId}/${mapType}`, {
        excludeRelations, includeRelations
    });

    const noteIdToSizeMap = calculateNodeSizes(resp, mapType);
    const links = getGroupedLinks(resp.links);
    const nodes = resp.notes.map(([noteId, title, type, color]) => ({
        id: noteId,
        name: title,
        type: type,
        color: color
    }));

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
