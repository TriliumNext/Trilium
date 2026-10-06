import {
    buildReificationTitle,
    NoteMapFactEnds,
    NoteMapLink,
    NoteMapNote,
    NoteMapPostResponse,
    NoteMapReificationLink
} from "@triliumnext/commons";
import server from "../../services/server";
import { LinkObject, NodeObject } from "force-graph";

type MapType = "tree" | "link";

interface GroupedLink {
    id: string;
    sourceNoteId: string;
    targetNoteId: string;
    names: string[];
}

/**
 * One side of a folded relation.
 * A fact is the note that stands for that relation, found before the outer relation is read.
 */
export type FoldEnd =
    | { noteId: string }
    | { fact: { predicate: string; predicates?: string[]; source: FoldEnd; object: FoldEnd } };

/** The relation a folded node stands for, so a click can create the note for that row. */
export interface NoteMapFold {
    linkId: string;
    sourceNoteId: string;
    targetNoteId: string;
    predicate: string;
    /** Every predicate on the grouped edge. `predicate` is the first of these. */
    predicates: string[];
    /**
     * The key removed to put this statement back.
     * Set when one predicate of a grouped edge was folded and the others stayed on the line.
     */
    collapseKey?: string;
    /**
     * The notes this relation joins. An end drawn from a folded edge is that fact,
     * so the relation is read from the note that stands for it.
     */
    subject: FoldEnd;
    object: FoldEnd;
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
    /**
     * A folded statement with no relation of its own. It stays where it was placed:
     * a line back to the two notes would be a relation that is not there.
     */
    pinnedFold?: boolean;
    /**
     * A point on an edge, not a note. A relation aimed at that edge is drawn from here,
     * so two facts stay connected while both are still edges.
     */
    joint?: boolean;
    jointOf?: [ string, string ];
}

export interface NoteMapLinkObject extends LinkObject<NoteMapNodeObject> {
    id: string;
    name: string;
    x?: number;
    y?: number;
    hostPredicate?: string;
    hostEndId?: string;
    farPredicate?: string;
    farEndId?: string;
}

export interface NotesAndRelationsData {
    nodes: NoteMapNodeObject[];
    links: {
        id: string;
        source: string | NoteMapNodeObject;
        target: string | NoteMapNodeObject;
        name: string;
        /**
         * Set when this line is a relation of one statement on a grouped edge.
         * `hostEndId` is that edge's joint. The fold of this line is that statement.
         */
        hostPredicate?: string;
        hostEndId?: string;
        /** The other end, when this line joins two facts. A fold of that statement is that node. */
        farPredicate?: string;
        farEndId?: string;
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

    const absorbedEnd = (noteId: string) => {
        const node = nodesById.get(noteId);
        if (!node?.joint || !node.jointOf) {
            return noteId;
        }
        const [ subjectId, objectId ] = node.jointOf;
        const folded = find(subjectId);
        if (folded === find(objectId) && folds.has(folded)) {
            return folded;
        }
        return noteId;
    };

    // A relation drawn from a folded edge joins that fact. A relation of a note keeps the note,
    // even when the note was drawn inside another fold.
    const relationEnd = (rawId: string, absorbedId: string, seen = new Set<string>()): FoldEnd => {
        if (absorbedId.startsWith("fold:")) {
            const inner = folds.get(absorbedId)?.fold;
            if (inner) {
                return {
                    fact: {
                        predicate: inner.predicate,
                        predicates: inner.predicates,
                        source: inner.subject,
                        object: inner.object
                    }
                };
            }
        }
        const jointId = rawId.startsWith("edge:") ? rawId : absorbedId.startsWith("edge:") ? absorbedId : "";
        if (jointId && !seen.has(jointId)) {
            seen.add(jointId);
            const joint = nodesById.get(jointId);
            const [ subjectId, objectId ] = joint?.jointOf ?? [ "", "" ];
            const host = linkInJointDirection(data.links, subjectId, objectId, endId);
            const hostPredicates = host ? predicatesIn(host.name) : [];
            if (host && hostPredicates.length > 0 && subjectId && objectId) {
                return {
                    fact: {
                        predicate: hostPredicates[0],
                        predicates: hostPredicates,
                        source: relationEnd(endId(host.source), endId(host.source), seen),
                        object: relationEnd(endId(host.target), endId(host.target), seen)
                    }
                };
            }
        }
        return { noteId: rawId || absorbedId };
    };

    /**
     * The title of one end. A joint this relation hangs on is that one statement.
     * The two notes keep their own titles: `labelOf` would name the fold this edge just became.
     */
    const labelForHost = (rawId: string, absorbedId: string, hostPredicate?: string, hostEndId?: string) => {
        if (!hostPredicate || !hostEndId || rawId !== hostEndId) {
            return labelOf(absorbedId);
        }
        const joint = nodesById.get(hostEndId);
        const [ subjectId, objectId ] = joint?.jointOf ?? [ "", "" ];
        if (!subjectId || !objectId) {
            return labelOf(absorbedId);
        }
        return foldTitle([ hostPredicate ], endName(subjectId), endName(objectId));
    };

    const endName = (noteId: string) => {
        const node = nodesById.get(noteId);
        if (node?.joint) {
            const folded = absorbedEnd(noteId);
            if (folded !== noteId) {
                return folds.get(folded)?.name ?? node.name;
            }
        }
        return node?.name ?? "";
    };

    const partialFolds: { foldId: string; source: string; target: string }[] = [];
    const addPartialFold = (
        link: NotesAndRelationsData["links"][number],
        foldedPredicate: string
    ) => {
        const rawSource = endId(link.source);
        const rawTarget = endId(link.target);
        const sourceId = absorbedEnd(rawSource);
        const targetId = absorbedEnd(rawTarget);
        const subject = positionOf(sourceId);
        const object = positionOf(targetId);
        const beside = besideEdge(subject, object);
        const collapseKey = predicateCollapseKey(link.id, foldedPredicate);
        const foldId = `fold:${collapseKey}`;
        const fold: NoteMapNodeObject = {
            id: foldId,
            name: foldTitle([ foldedPredicate ], labelOf(sourceId), labelOf(targetId)),
            type: "text",
            color: null,
            icon: "bx bx-git-commit",
            x: beside.x,
            y: beside.y,
            fold: {
                linkId: link.id,
                collapseKey,
                sourceNoteId: sourceId,
                targetNoteId: targetId,
                predicate: foldedPredicate,
                predicates: [ foldedPredicate ],
                subject: relationEnd(rawSource, sourceId),
                object: relationEnd(rawTarget, targetId)
            }
        };
        folds.set(foldId, fold);
        data.noteIdToSizeMap[foldId] = FOLD_NODE_SIZE;
        if (!parent.has(foldId)) {
            parent.set(foldId, foldId);
        }
        partialFolds.push({ foldId, source: sourceId, target: targetId });
    };

    /** The fold of one statement, when this line hangs on that statement and the rest of the edge is still open. */
    const partialFoldAt = (hostEndId?: string, hostPredicate?: string) => {
        if (!hostEndId || !hostPredicate) {
            return;
        }
        const joint = nodesById.get(hostEndId);
        if (!joint?.jointOf) {
            return;
        }
        const [ subjectId, objectId ] = joint.jointOf;
        const host = linkInJointDirection(data.links, subjectId, objectId, endId);
        if (!host || collapsedLinkIds.has(host.id)) {
            return;
        }
        const key = predicateCollapseKey(host.id, hostPredicate);
        if (!collapsedLinkIds.has(key)) {
            return;
        }
        return `fold:${key}`;
    };

    const statementFold = (link: NotesAndRelationsData["links"][number], rawId: string) => {
        if (rawId === link.hostEndId) {
            return partialFoldAt(link.hostEndId, link.hostPredicate);
        }
        if (rawId === link.farEndId) {
            return partialFoldAt(link.farEndId, link.farPredicate);
        }
    };

    const retargetEnd = (link: NotesAndRelationsData["links"][number], rawId: string, found: string) =>
        statementFold(link, rawId) ?? found;

    for (const linkId of orderedFolds(data, collapsedLinkIds)) {
        const link = data.links.find((item) => item.id === linkId);
        const predicates = link ? predicatesIn(link.name) : [];
        const folding = link ? predicatesBeingFolded(link.id, predicates, collapsedLinkIds) : [];
        const predicate = folding[0];
        if (!link || !predicate) {
            continue;
        }
        // One statement of a grouped edge folds on its own. The other names stay on the line,
        // so the two notes are not pulled into this node.
        if (!collapsedLinkIds.has(link.id)) {
            for (const name of folding) {
                addPartialFold(link, name);
            }
            continue;
        }
        const rawSource = endId(link.source);
        const rawTarget = endId(link.target);
        // An end that is a point on an edge already folded is that fold, so this
        // edge folds around it rather than around the point. A single statement
        // folded off a shared edge is that statement's node, not the whole edge.
        const sourceStatement = statementFold(link, rawSource);
        const targetStatement = statementFold(link, rawTarget);
        const sourceId = sourceStatement ?? absorbedEnd(rawSource);
        const targetId = targetStatement ?? absorbedEnd(rawTarget);
        const subject = positionOf(sourceId);
        const object = positionOf(targetId);
        const foldId = `fold:${linkId}`;
        const fold: NoteMapNodeObject = {
            id: foldId,
            name: foldTitle(
                predicates,
                labelForHost(rawSource, sourceId, link.hostPredicate, link.hostEndId),
                labelForHost(rawTarget, targetId, link.hostPredicate, link.hostEndId)
            ),
            type: "text",
            color: null,
            icon: "bx bx-git-commit",
            x: (subject.x + object.x) / 2,
            y: (subject.y + object.y) / 2,
            fold: {
                linkId,
                sourceNoteId: sourceId,
                targetNoteId: targetId,
                predicate,
                predicates,
                subject: pinHost(relationEnd(rawSource, sourceId), rawSource, link.hostEndId, link.hostPredicate),
                object: pinHost(relationEnd(rawTarget, targetId), rawTarget, link.hostEndId, link.hostPredicate)
            }
        };
        folds.set(foldId, fold);
        data.noteIdToSizeMap[foldId] = FOLD_NODE_SIZE;
        if (!parent.has(foldId)) {
            parent.set(foldId, foldId);
        }
        linkInto(sourceId, foldId);
        linkInto(targetId, foldId);
        if (!sourceStatement && rawSource !== sourceId) {
            linkInto(rawSource, foldId);
        }
        if (!targetStatement && rawTarget !== targetId) {
            linkInto(rawTarget, foldId);
        }
    }

    // A point held on an edge belongs to the fold of that edge, so a relation drawn
    // from the edge is drawn from the fold once the edge is collapsed.
    for (const node of data.nodes) {
        if (!node.joint || !node.jointOf) {
            continue;
        }
        const [ subjectId, objectId ] = node.jointOf;
        const folded = find(subjectId);
        if (folded === find(objectId) && folded !== subjectId) {
            linkInto(node.id, folded);
        }
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
        const names = predicatesIn(link.name);
        const folding = predicatesBeingFolded(link.id, names, collapsedLinkIds);
        const remaining = names.filter((name) => !folding.includes(name));
        if (names.length > 0 && remaining.length === 0) {
            continue;
        }
        const source = find(rawSource);
        const target = find(rawTarget);
        const fromJoint = nodesById.get(rawSource)?.joint === true
            || nodesById.get(rawTarget)?.joint === true;
        // The fold is the fact, not the two notes it joined. A relation of one of
        // those notes is not a relation of the fact, so it is not redrawn from the fold.
        // A relation that was drawn from the edge itself is a relation of the fact.
        if (!fromJoint && (source !== rawSource || target !== rawTarget || source === target)) {
            if (source === rawSource) {
                droppedEnds.add(rawSource);
            }
            if (target === rawTarget) {
                droppedEnds.add(rawTarget);
            }
            continue;
        }
        if (source === target) {
            continue;
        }
        const from = retargetEnd(link, rawSource, source);
        const to = retargetEnd(link, rawTarget, target);
        links.push({
            id: link.id,
            source: from,
            target: to,
            name: folding.length === 0 ? link.name : remaining.join(", "),
            ...statementEnds(link)
        });
        keptEnds.add(from);
        keptEnds.add(to);
    }

    // Relations of a fact are drawn again here. applyRelationBridges has already drawn
    // the ones whose host edge is still open; this adds a host that this fold replaced,
    // including a fact the relation points at (`otherFact`, which has no `note`).
    for (const attachment of data.reificationLinks ?? []) {
        const host = data.links.find((item) => item.id === attachment.linkId);
        if (!host) {
            continue;
        }
        const hostJoint = edgeJointId(endId(host.source), endId(host.target));
        const predicateKey = attachment.hostPredicate
            ? predicateCollapseKey(attachment.linkId, attachment.hostPredicate)
            : "";
        const origin = collapsedLinkIds.has(attachment.linkId)
            ? find(`fold:${attachment.linkId}`)
            : predicateKey && collapsedLinkIds.has(predicateKey)
                ? `fold:${predicateKey}`
                : hostJoint;
        const fromId = find(origin);
        if (attachment.otherFact) {
            appendFactAttachment(attachment.otherFact, attachment.name, attachment.outgoing, hostJoint, fromId);
            continue;
        }
        if (!attachment.note) {
            continue;
        }
        const [ noteId, title, type, color, icon ] = attachment.note;
        const otherId = find(noteId);
        if (!otherId || fromId === otherId) {
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
        pushKeptLink(
            `${attachment.linkId}-${attachment.name}-${noteId}`,
            attachment.outgoing ? fromId : otherId,
            attachment.outgoing ? otherId : fromId,
            attachment.name
        );
    }

    function pushKeptLink(id: string, source: string, target: string, name: string) {
        if (!source || !target || source === target) {
            return;
        }
        if (links.some((item) => item.id === id)) {
            return;
        }
        links.push({ id, source, target, name });
        keptEnds.add(source);
        keptEnds.add(target);
    }

    function ensureMapNode(tuple: NoteMapNote) {
        const id = tuple[0];
        if (nodesById.has(id) || nodes.some((node) => node.id === id)) {
            return;
        }
        const added = nodeFromTuple(tuple);
        nodes.push(added);
        nodesById.set(id, added);
        data.noteIdToSizeMap[id] = FOLD_NODE_SIZE;
    }

    function appendFactAttachment(
        fact: NoteMapFactEnds,
        name: string,
        outgoing: boolean,
        hostJoint: string,
        fromId: string
    ) {
        const otherJoint = fact.object ? edgeJointId(fact.subject[0], fact.object[0]) : fact.subject[0];
        const partialKey = predicateCollapseKey(fact.linkId, fact.predicate);
        const otherEnd = collapsedLinkIds.has(fact.linkId)
            ? find(`fold:${fact.linkId}`)
            : collapsedLinkIds.has(partialKey)
                ? `fold:${partialKey}`
                : find(otherJoint);
        if (fact.object && !collapsedLinkIds.has(fact.linkId)) {
            ensureMapNode(fact.subject);
            ensureMapNode(fact.object);
            pushKeptLink(fact.linkId, find(fact.subject[0]), find(fact.object[0]), fact.predicate);
            if (!nodesById.has(otherJoint) && !nodes.some((node) => node.id === otherJoint)) {
                const joint = jointNode(otherJoint, fact.subject[0], fact.object[0]);
                nodes.push(joint);
                nodesById.set(otherJoint, joint);
            }
        } else if (!fact.object) {
            ensureMapNode(fact.subject);
        }
        const source = outgoing ? fromId : otherEnd;
        const target = outgoing ? otherEnd : fromId;
        pushKeptLink(`${hostJoint}-${name}-${otherJoint}`, source, target, name);
    }

    for (const placed of partialFolds) {
        if (keptEnds.has(placed.foldId)) {
            continue;
        }
        const fold = folds.get(placed.foldId);
        if (!fold) {
            continue;
        }
        fold.fx = fold.x;
        fold.fy = fold.y;
        fold.pinnedFold = true;
    }

    const visibleNodes = nodes.filter((node) => {
        if (node.joint && !keptEnds.has(node.id)) {
            return false;
        }
        return !droppedEnds.has(node.id) || keptEnds.has(node.id);
    });

    return { noteIdToSizeMap: data.noteIdToSizeMap, nodes: visibleNodes, links, reificationLinks: data.reificationLinks };
}

export interface ReificationEnds {
    rootId: string;
    predicate: string;
    subject: NoteMapNodeObject;
    object: NoteMapNodeObject | null;
}

/** The edge drawn when the reification note `rootId` is expanded into its two ends. */
export function expandedLinkId(rootId: string) {
    return `expanded:${rootId}`;
}

/** The reification note an expanded edge stands for, when the edge is one. */
export function expandedNoteId(linkId: string): string | null {
    const prefix = "expanded:";
    return linkId.startsWith(prefix) ? linkId.slice(prefix.length) : null;
}

/**
 * Removes `noteId` from the notes shown as edges, and the same for each end that was
 * itself shown as an edge. The next expansion of `noteId` then opens one layer.
 */
export function dropExpansion(
    noteId: string,
    expandedIds: Set<string>,
    endsById: Map<string, ReificationEnds>,
    collapsed: Set<string>
) {
    const pending = [ noteId ];
    const seen = new Set<string>();
    while (pending.length > 0) {
        const id = pending.pop();
        if (!id || seen.has(id)) {
            continue;
        }
        seen.add(id);
        expandedIds.delete(id);
        collapsed.delete(expandedLinkId(id));
        const ends = endsById.get(id);
        endsById.delete(id);
        if (!ends) {
            continue;
        }
        pending.push(ends.subject.id);
        if (ends.object) {
            pending.push(ends.object.id);
        }
    }
}

/**
 * Puts the two notes of a fact back, with the fact as the line between them.
 * A relation of the fact is drawn from the middle of that line. Either note can
 * then be opened on its own.
 */
export function expandReification(data: NotesAndRelationsData, ends: ReificationEnds): NotesAndRelationsData {
    const noteIdToSizeMap = data.noteIdToSizeMap;
    const nodes: NoteMapNodeObject[] = [];
    for (const node of data.nodes) {
        if (node.id !== ends.rootId) {
            nodes.push(node);
        }
    }
    for (const extra of [ ends.subject, ends.object ]) {
        rememberNode(nodes, noteIdToSizeMap, extra);
    }

    const links: NotesAndRelationsData["links"] = [];
    const jointId = ends.object ? edgeJointId(ends.subject.id, ends.object.id) : null;
    if (jointId && ends.object) {
        rememberNode(nodes, noteIdToSizeMap, jointNode(jointId, ends.subject.id, ends.object.id));
        links.push({
            id: expandedLinkId(ends.rootId),
            source: ends.subject.id,
            target: ends.object.id,
            name: ends.predicate
        });
    }
    for (const link of data.links) {
        const source = endId(link.source);
        const target = endId(link.target);
        if (source !== ends.rootId && target !== ends.rootId) {
            links.push(link);
            continue;
        }
        if (!jointId) {
            continue;
        }
        const otherId = source === ends.rootId ? target : source;
        if (otherId === ends.rootId) {
            continue;
        }
        links.push({
            id: link.id,
            source: source === ends.rootId ? jointId : otherId,
            target: target === ends.rootId ? jointId : otherId,
            name: link.name
        });
    }

    const keep = new Set<string>([ ends.subject.id ]);
    if (ends.object) {
        keep.add(ends.object.id);
    }
    if (jointId) {
        keep.add(jointId);
    }

    return {
        noteIdToSizeMap,
        nodes: nodesKeptBy(links, nodes, keep),
        links,
        reificationLinks: data.reificationLinks
    };
}

/**
 * Draws a relation that points at a fact from the middle of that fact's edge.
 * Pointing at another fact draws the line between the two edges, and brings the
 * other fact's notes onto the map.
 */
export function applyRelationBridges(data: NotesAndRelationsData): NotesAndRelationsData {
    if (!data.reificationLinks?.length) {
        return data;
    }

    const nodes = [ ...data.nodes ];
    const links = [ ...data.links ];
    const linkIds = new Set(links.map((link) => link.id));
    for (const attachment of data.reificationLinks) {
        const host = links.find((link) => link.id === attachment.linkId);
        if (!host) {
            continue;
        }
        const subjectId = endId(host.source);
        const objectId = endId(host.target);
        const jointId = edgeJointId(subjectId, objectId);
        rememberNode(nodes, data.noteIdToSizeMap, jointNode(jointId, subjectId, objectId));
        if (attachment.otherFact) {
            bridgeToFact(
                nodes, links, linkIds, data.noteIdToSizeMap,
                jointId, attachment.name, attachment.outgoing, attachment.otherFact,
                attachment.hostPredicate
            );
            continue;
        }
        if (!attachment.note) {
            continue;
        }
        const otherId = attachment.note[0];
        rememberNode(nodes, data.noteIdToSizeMap, nodeFromTuple(attachment.note));
        pushLink(links, linkIds, hostLink(
            `${attachment.linkId}-${attachment.name}-${otherId}`,
            attachment.outgoing ? jointId : otherId,
            attachment.outgoing ? otherId : jointId,
            attachment.name,
            attachment.hostPredicate,
            jointId
        ));
    }

    return { ...data, nodes, links };
}

/**
 * Expands each fact that is still a note on the map. One pass can reveal the
 * next fact, so a fact that was not on the map yet is tried again after the
 * others. A fact with no two ends is left as it is.
 */
export function expandReifications(data: NotesAndRelationsData, expanded: readonly ReificationEnds[]): NotesAndRelationsData {
    let current = data;
    let remaining = expanded.filter((ends) => ends.object);
    for (let pass = 0; pass < expanded.length && remaining.length > 0; pass++) {
        const pending: ReificationEnds[] = [];
        for (const ends of remaining) {
            if (current.nodes.some((node) => node.id === ends.rootId)) {
                current = expandReification(current, ends);
            } else {
                pending.push(ends);
            }
        }
        if (pending.length === remaining.length) {
            break;
        }
        remaining = pending;
    }
    return current;
}

/**
 * The graph the map shows: each expanded fact opened into its notes, or the
 * edges joined where a fact points at a fact, then any edge the reader folded.
 */
export function presentRelations(
    data: NotesAndRelationsData,
    collapsed: ReadonlySet<string>,
    expanded: readonly ReificationEnds[] = []
): NotesAndRelationsData {
    const opened = applyRelationBridges(expandReifications(data, expanded));
    if (collapsed.size > 0) {
        return collapseRelations(opened, collapsed);
    }
    return opened;
}

/**
 * The edges to fold for `linkId`, the ones it starts on before it.
 *
 * An edge drawn from the middle of another edge cannot fold until that one has,
 * and the same for the edge that one starts on. The edge asked for is last, so
 * it is the node that remains. Expanding removes only that one.
 */
export function foldOrder(data: { nodes: NoteMapNodeObject[]; links: NoteMapLinkObject[] }, linkId: string): string[] {
    const hosts = new Map<string, string>();
    for (const node of data.nodes) {
        if (!node.joint || !node.jointOf) {
            continue;
        }
        const [ subjectId, objectId ] = node.jointOf;
        const host = linkInJointDirection(data.links, subjectId, objectId, endKey);
        if (host) {
            hosts.set(node.id, host.id);
        }
    }

    const ordered: string[] = [];
    const visiting = new Set<string>();
    const visit = (id: string) => {
        if (ordered.includes(id) || visiting.has(id)) {
            return;
        }
        const link = data.links.find((item) => item.id === id);
        if (!link) {
            return;
        }
        visiting.add(id);
        for (const end of [ endKey(link.source), endKey(link.target) ]) {
            const hostId = hosts.get(end);
            if (hostId) {
                visit(hostId);
            }
        }
        visiting.delete(id);
        ordered.push(id);
    };
    visit(linkId);
    return ordered;
}

/**
 * The note id an end of a fold stands for.
 * A fact end is the note of that relation, so the caller can read the relation that hangs off it.
 */
export async function resolveFoldEnd(
    end: FoldEnd,
    reificationNoteId: (sourceNoteId: string, predicate: string, targetNoteId: string) => Promise<string | undefined>
): Promise<string | undefined> {
    if ("noteId" in end) {
        return end.noteId;
    }
    const sourceId = await resolveFoldEnd(end.fact.source, reificationNoteId);
    const objectId = await resolveFoldEnd(end.fact.object, reificationNoteId);
    if (!sourceId || !objectId) {
        return;
    }
    const predicates = end.fact.predicates?.length ? end.fact.predicates : [ end.fact.predicate ];
    const matches: string[] = [];
    for (const predicate of predicates) {
        const noteId = await reificationNoteId(sourceId, predicate, objectId);
        if (noteId && !matches.includes(noteId)) {
            matches.push(noteId);
        }
    }
    // Several statements on one edge can each have a note. The caller names the one this relation hangs on.
    if (matches.length === 1) {
        return matches[0];
    }
}

/** Collapsed edges in fold order: an edge after the edges it starts on. */
function orderedFolds(data: NotesAndRelationsData, collapsedLinkIds: ReadonlySet<string>): string[] {
    const ordered: string[] = [];
    const seen = new Set<string>();
    for (const key of collapsedLinkIds) {
        for (const id of foldOrder(data, linkIdOfCollapseKey(key))) {
            if (!isLinkCollapsed(data, id, collapsedLinkIds) || seen.has(id)) {
                continue;
            }
            seen.add(id);
            ordered.push(id);
        }
    }
    return ordered;
}

/**
 * The collapse keys for folding `linkId`.
 * An edge this line starts on contributes only the statement it hangs on.
 * `predicateFor` is that statement for each edge, including the far end of a fact-to-fact line.
 */
export function collapseKeys(
    order: string[],
    linkId: string,
    predicate: string | undefined,
    linkNames: (id: string) => string[],
    predicateFor: (edgeId: string) => string | undefined
): string[] {
    const keys: string[] = [];
    const sequence = order.includes(linkId) ? order : [ ...order, linkId ];
    for (const id of sequence) {
        const names = linkNames(id);
        const pinned = id === linkId ? predicate : predicateFor(id);
        if (pinned && names.length > 1 && names.includes(pinned)) {
            keys.push(predicateCollapseKey(id, pinned));
        } else {
            keys.push(id);
        }
    }
    return keys;
}

/** The statement `edgeId` contributes when a line in `order` hangs on it, at either end. */
export function predicateForEdge(
    edgeId: string,
    order: readonly string[],
    shown: { nodes: NoteMapNodeObject[]; links: NoteMapLinkObject[] }
) {
    for (const id of order) {
        const link = shown.links.find((item) => item.id === id);
        if (!link) {
            continue;
        }
        if (edgeOfJoint(link.hostEndId, shown) === edgeId) {
            return link.hostPredicate;
        }
        if (edgeOfJoint(link.farEndId, shown) === edgeId) {
            return link.farPredicate;
        }
    }
}

function edgeOfJoint(
    jointId: string | undefined,
    shown: { nodes: NoteMapNodeObject[]; links: NoteMapLinkObject[] }
) {
    if (!jointId) {
        return;
    }
    const joint = shown.nodes.find((node) => node.id === jointId);
    if (!joint?.jointOf) {
        return;
    }
    const [ subjectId, objectId ] = joint.jointOf;
    return linkInJointDirection(shown.links, subjectId, objectId, endKey)?.id;
}

/** One predicate of `linkId`, so that statement can fold while the edge's other names stay. */
export function predicateCollapseKey(linkId: string, predicate: string) {
    return `${linkId}${PREDICATE_FOLD_SEPARATOR}${predicate}`;
}

const PREDICATE_FOLD_SEPARATOR = "\u001f";

function linkIdOfCollapseKey(key: string) {
    const split = key.indexOf(PREDICATE_FOLD_SEPARATOR);
    return split < 0 ? key : key.slice(0, split);
}

function predicatesBeingFolded(linkId: string, names: string[], collapsed: ReadonlySet<string>): string[] {
    if (collapsed.has(linkId)) {
        return names;
    }
    const chosen: string[] = [];
    for (const name of names) {
        if (collapsed.has(predicateCollapseKey(linkId, name))) {
            chosen.push(name);
        }
    }
    return chosen;
}

function isLinkCollapsed(data: NotesAndRelationsData, linkId: string, collapsed: ReadonlySet<string>) {
    if (collapsed.has(linkId)) {
        return true;
    }
    const link = data.links.find((item) => item.id === linkId);
    if (!link) {
        return false;
    }
    return predicatesBeingFolded(linkId, predicatesIn(link.name), collapsed).length > 0;
}

/**
 * Gives every note of `next` a place on the map it is about to replace.
 *
 * A note that was already drawn keeps its place. One that is new takes the place of
 * `anchorId` when that note is leaving, spaced along the link so the fit has an extent
 * to frame. Without a place, the fit is taken over an empty box and the map goes blank.
 */
export function carryPositions(previous: NoteMapNodeObject[], next: NoteMapNodeObject[], anchorId: string) {
    const previousById = new Map(previous.map((node) => [ node.id, node ]));
    const anchor = previousById.get(anchorId);
    const anchorX = anchor?.x;
    const anchorY = anchor?.y;
    let placed = 0;

    for (const node of next) {
        const prior = previousById.get(node.id);
        if (prior?.x !== undefined && prior.y !== undefined) {
            node.x = prior.x;
            node.y = prior.y;
            continue;
        }
        if (anchorX === undefined || anchorY === undefined) {
            continue;
        }
        node.x = anchorX + placed * 40;
        node.y = anchorY;
        node.vx = 0;
        node.vy = 0;
        placed += 1;
    }
}

function rememberNode(nodes: NoteMapNodeObject[], sizes: Record<string, number>, node: NoteMapNodeObject | null) {
    if (!node || nodes.some((existing) => existing.id === node.id)) {
        return;
    }
    nodes.push(node);
    if (!(node.id in sizes)) {
        sizes[node.id] = node.joint ? 1 : 4;
    }
}

function jointNode(id: string, subjectId: string, objectId: string): NoteMapNodeObject {
    return {
        id,
        name: "",
        type: "text",
        color: null,
        icon: "",
        joint: true,
        jointOf: [ subjectId, objectId ]
    };
}

function edgeJointId(subjectId: string, objectId: string) {
    return `edge:${subjectId}-${objectId}`;
}

/** A spot just off the middle of an edge, so a folded statement is not drawn on top of the line it left. */
function besideEdge(subject: { x: number; y: number }, object: { x: number; y: number }) {
    const dx = object.x - subject.x;
    const dy = object.y - subject.y;
    const length = Math.hypot(dx, dy) || 1;
    return {
        x: (subject.x + object.x) / 2 + (-dy / length) * 36,
        y: (subject.y + object.y) / 2 + (dx / length) * 36
    };
}

function statementEnds(link: NotesAndRelationsData["links"][number]) {
    return {
        ...(link.hostPredicate ? { hostPredicate: link.hostPredicate, hostEndId: link.hostEndId } : {}),
        ...(link.farPredicate ? { farPredicate: link.farPredicate, farEndId: link.farEndId } : {})
    };
}

function nodeFromTuple(note: NoteMapNote): NoteMapNodeObject {
    const [ id, name, type, color, icon ] = note;
    return { id, name, type, color, icon };
}

function pushLink(
    links: NotesAndRelationsData["links"],
    ids: Set<string>,
    link: NotesAndRelationsData["links"][number]
) {
    if (ids.has(link.id)) {
        return;
    }
    ids.add(link.id);
    links.push(link);
}

function bridgeToFact(
    nodes: NoteMapNodeObject[],
    links: NotesAndRelationsData["links"],
    linkIds: Set<string>,
    sizes: Record<string, number>,
    jointId: string,
    name: string,
    outgoing: boolean,
    fact: NoteMapFactEnds,
    hostPredicate: string
) {
    rememberNode(nodes, sizes, nodeFromTuple(fact.subject));
    if (!fact.object) {
        const otherId = fact.subject[0];
        pushLink(links, linkIds, hostLink(
            `${jointId}-${name}-${otherId}`,
            outgoing ? jointId : otherId,
            outgoing ? otherId : jointId,
            name,
            hostPredicate,
            jointId
        ));
        return;
    }
    rememberNode(nodes, sizes, nodeFromTuple(fact.object));
    pushLink(links, linkIds, {
        id: fact.linkId,
        source: fact.subject[0],
        target: fact.object[0],
        name: fact.predicate
    });
    const otherJointId = edgeJointId(fact.subject[0], fact.object[0]);
    rememberNode(nodes, sizes, jointNode(otherJointId, fact.subject[0], fact.object[0]));
    const bridge = hostLink(
        `${jointId}-${name}-${otherJointId}`,
        outgoing ? jointId : otherJointId,
        outgoing ? otherJointId : jointId,
        name,
        hostPredicate,
        jointId
    );
    bridge.farPredicate = fact.predicate;
    bridge.farEndId = otherJointId;
    pushLink(links, linkIds, bridge);
}

/** A bridge line. `hostPredicate` is set only when the payload names the statement this relation hangs on. */
function hostLink(
    id: string,
    source: string,
    target: string,
    name: string,
    hostPredicate: string | undefined,
    hostEndId: string
): NotesAndRelationsData["links"][number] {
    const link: NotesAndRelationsData["links"][number] = { id, source, target, name };
    if (hostPredicate) {
        link.hostPredicate = hostPredicate;
        link.hostEndId = hostEndId;
    }
    return link;
}

/** Keeps `hostPredicate` as the only name of a fact end that is the joint this relation hangs on. */
function pinHost(end: FoldEnd, rawId: string, hostEndId?: string, hostPredicate?: string): FoldEnd {
    if (!hostPredicate || !hostEndId || rawId !== hostEndId || !("fact" in end)) {
        return end;
    }
    return {
        fact: {
            predicate: hostPredicate,
            predicates: [ hostPredicate ],
            source: end.fact.source,
            object: end.fact.object
        }
    };
}

/** Splits a grouped fold title on commas that sit between statements, not inside one. */
export function splitFoldTitle(title: string): string[] {
    const parts: string[] = [];
    let depth = 0;
    let start = 0;
    for (let i = 0; i < title.length; i++) {
        const ch = title[i];
        if (ch === "(") {
            depth++;
        } else if (ch === ")" && depth > 0) {
            depth--;
        } else if (ch === "," && depth === 0 && title[i + 1] === " ") {
            parts.push(title.slice(start, i));
            start = i + 2;
        }
    }
    const last = title.slice(start);
    if (last) {
        parts.push(last);
    }
    return parts;
}

function nodesKeptBy(
    links: NotesAndRelationsData["links"],
    nodes: NoteMapNodeObject[],
    keep: Set<string>
) {
    const linked = new Set<string>();
    for (const link of links) {
        linked.add(endId(link.source));
        linked.add(endId(link.target));
    }
    return nodes.filter((node) => linked.has(node.id) || keep.has(node.id));
}

function endId(end: string | NoteMapNodeObject): string {
    return typeof end === "string" ? end : end.id;
}

/**
 * The name of one end of a relation. A point on an edge is the title of that edge.
 * `predicate` keeps one statement when several share the edge and this line hangs on that one.
 */
export function relationEndTitle(
    end: NoteMapLinkObject["source"],
    data: { nodes: NoteMapNodeObject[]; links: NoteMapLinkObject[] },
    seen = new Set<string>(),
    predicate?: string
): string {
    const id = endKey(end);
    const node = typeof end === "object" && end ? end : data.nodes.find((item) => item.id === id);
    if (!node) {
        return "";
    }
    if (!node.joint || !node.jointOf || seen.has(node.id)) {
        return node.name;
    }
    seen.add(node.id);
    const [ subjectId, objectId ] = node.jointOf;
    const host = linkInJointDirection(data.links, subjectId, objectId, endKey);
    const predicates = host ? predicatesIn(host.name) : [];
    if (!host || predicates.length === 0) {
        return node.name;
    }
    const named = predicate && predicates.includes(predicate) ? [ predicate ] : predicates;
    return foldTitle(
        named,
        relationEndTitle(host.source, data, seen),
        relationEndTitle(host.target, data, seen)
    );
}

export interface StatementChoice {
    linkId: string;
    predicate: string;
    sourceId: string;
    targetId: string;
}

/**
 * The statements a right-click can fold between the same two notes as `linkId`, either way.
 * The clicked line's statements come first. A line that starts on a point of an edge stays that line.
 */
export function statementsBetween(
    linkId: string,
    links: readonly Pick<NoteMapLinkObject, "id" | "name" | "source" | "target">[]
): StatementChoice[] {
    const clicked = links.find((item) => item.id === linkId);
    if (!clicked) {
        return [];
    }
    const sourceId = endKey(clicked.source);
    const targetId = endKey(clicked.target);
    if (!isNoteEnd(sourceId) || !isNoteEnd(targetId)) {
        return statementChoices(clicked);
    }
    const sameWay: StatementChoice[] = [];
    const otherWay: StatementChoice[] = [];
    for (const item of links) {
        const source = endKey(item.source);
        const target = endKey(item.target);
        if (!isNoteEnd(source) || !isNoteEnd(target)) {
            continue;
        }
        if (source === sourceId && target === targetId) {
            sameWay.push(...statementChoices(item));
        } else if (sourceId !== targetId && source === targetId && target === sourceId) {
            otherWay.push(...statementChoices(item));
        }
    }
    return [ ...sameWay, ...otherWay ];
}

/**
 * The fold title of one statement.
 * An end that is a point on a grouped edge is named as the one statement this line hangs on.
 */
export function statementCaption(
    choice: StatementChoice,
    line: Pick<NoteMapLinkObject, "hostEndId" | "hostPredicate" | "farEndId" | "farPredicate"> | undefined,
    graph: { nodes: NoteMapNodeObject[]; links: NoteMapLinkObject[] }
): string {
    return foldTitle(
        [ choice.predicate ],
        relationEndTitle(choice.sourceId, graph, new Set(), predicateForEnd(line, choice.sourceId)),
        relationEndTitle(choice.targetId, graph, new Set(), predicateForEnd(line, choice.targetId))
    );
}

function predicateForEnd(
    line: Pick<NoteMapLinkObject, "hostEndId" | "hostPredicate" | "farEndId" | "farPredicate"> | undefined,
    endId: string
) {
    if (!line || !endId) {
        return;
    }
    if (endId === line.hostEndId) {
        return line.hostPredicate;
    }
    if (endId === line.farEndId) {
        return line.farPredicate;
    }
}

function isNoteEnd(id: string) {
    return id.length > 0 && !id.startsWith("edge:") && !id.startsWith("fold:");
}

function statementChoices(link: Pick<NoteMapLinkObject, "id" | "name" | "source" | "target">): StatementChoice[] {
    const sourceId = endKey(link.source);
    const targetId = endKey(link.target);
    const choices: StatementChoice[] = [];
    for (const predicate of predicatesIn(link.name)) {
        choices.push({ linkId: link.id, predicate, sourceId, targetId });
    }
    return choices;
}

/** The predicates written on one grouped edge, such as `loves, knows`. */
export function predicatesIn(names: string): string[] {
    const predicates: string[] = [];
    for (const part of names.split(",")) {
        const predicate = part.trim();
        if (predicate) {
            predicates.push(predicate);
        }
    }
    return predicates;
}

/** The fold title for every predicate on one edge, joined the same way the edge is. */
export function foldTitle(predicates: readonly string[], subjectTitle: string, objectTitle: string): string {
    const titles: string[] = [];
    for (const predicate of predicates) {
        titles.push(buildReificationTitle({ subjectTitle, predicate, objectTitle }));
    }
    return titles.join(", ");
}

/**
 * The link `jointOf` names, running from its subject to its object.
 * A link the other way between the same notes is a different edge.
 */
function linkInJointDirection<T extends { source?: NoteMapLinkObject["source"]; target?: NoteMapLinkObject["source"] }>(
    links: readonly T[],
    subjectId: string,
    objectId: string,
    keyOf: (end: T["source"]) => string
): T | undefined {
    return links.find((link) => keyOf(link.source) === subjectId && keyOf(link.target) === objectId);
}

/** The note id a graph link stores at an end, once the graph has replaced the id with the note. */
function endKey(end: NoteMapLinkObject["source"]): string {
    if (!end || typeof end === "number") {
        return "";
    }
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
