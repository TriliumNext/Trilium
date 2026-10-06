import type { RelationMapReification } from "@triliumnext/commons";

/** Half of a note box's minimum width, used as the box's horizontal center. */
const NOTE_ANCHOR_X = 75;
/** Rough vertical center of a note box. */
const NOTE_ANCHOR_Y = 20;
const TOKEN_SIZE = 22;
const HALF = TOKEN_SIZE / 2;
/** Distance between two tokens that would otherwise share a point. */
const STACK = 28;
/** How far a self-relation's token sits above its note. */
const SELF_LIFT = 48;

export interface ReificationTokenPlacement {
    noteId: string;
    attributeId: string;
    title: string;
    kind: "relation" | "label";
    x: number;
    y: number;
}

/**
 * Positions each reification that this map draws as an edge.
 *
 * A relation sits on the midpoint of its two ends, so another arrow can start
 * or end there. A label sits above the note that owns it. An end that is itself
 * an edge is placed only after that edge has a position.
 *
 * A relation note that was also dropped on the map is still the edge when both
 * of its ends are here. Its saved box is not a center, or the arrow would aim
 * at that box instead of at the edge.
 */
export function placeReificationTokens(
    notes: readonly { noteId: string; x: number; y: number }[],
    reifications: readonly RelationMapReification[]
): ReificationTokenPlacement[] {
    const onMap = new Set(notes.map((note) => note.noteId));
    const pending = reifications.filter((item) => isEdgeHere(item, onMap));
    const pendingIds = new Set(pending.map((item) => item.noteId));
    const centers = new Map<string, { x: number; y: number }>();
    for (const note of notes) {
        if (pendingIds.has(note.noteId)) {
            continue;
        }
        centers.set(note.noteId, { x: note.x + NOTE_ANCHOR_X, y: note.y + NOTE_ANCHOR_Y });
    }

    const pairTotal = new Map<string, number>();
    for (const item of pending) {
        if (item.kind === "relation" && item.objectNoteId && item.subjectNoteId !== item.objectNoteId) {
            const key = pairKey(item.subjectNoteId, item.objectNoteId);
            pairTotal.set(key, (pairTotal.get(key) ?? 0) + 1);
        }
    }

    const pairIndex = new Map<string, number>();
    const labelIndex = new Map<string, number>();
    const placed: ReificationTokenPlacement[] = [];
    const tokenCenters: { x: number; y: number }[] = [];

    let guard = pending.length + 1;
    while (pending.length > 0 && guard > 0) {
        guard -= 1;
        const stillPending: RelationMapReification[] = [];
        let placedOne = false;

        for (const item of pending) {
            const center = centerFor(item, centers, pairTotal, pairIndex, labelIndex);
            if (!center) {
                stillPending.push(item);
                continue;
            }
            const spot = separateFrom(center, tokenCenters);
            tokenCenters.push(spot);
            centers.set(item.noteId, spot);
            placed.push({
                noteId: item.noteId,
                attributeId: item.attributeId,
                title: item.title,
                kind: item.kind,
                x: spot.x - HALF,
                y: spot.y - HALF
            });
            placedOne = true;
        }

        if (!placedOne) {
            break;
        }
        pending.length = 0;
        pending.push(...stillPending);
    }

    return placed;
}

export interface ProjectedNote {
    noteId: string;
    x: number;
    y: number;
}

export interface ProjectedRelation {
    attributeId?: string;
    sourceNoteId: string;
    targetNoteId: string;
}

const NOTHING_COLLAPSED: ReadonlySet<string> = new Set();

export interface RelationFold {
    noteId: string;
    attributeId: string;
}

export interface RelationProjection {
    circles: ProjectedNote[];
    tokens: ReificationTokenPlacement[];
    /** The note a drawn end stands for after collapses. An unfolded id is itself. */
    represent: (noteId: string) => string;
    /** Collapses that are still a circle of their own, not folded into a larger one. */
    folds: RelationFold[];
}

/**
 * The same relations, drawn from the note that is open.
 *
 * A relation that is not collapsed is an arrow. Collapsing it replaces the
 * two notes and the arrow with one circle, the relation's own note. Collapsing
 * a relation of that circle folds the result again. The note the view is
 * centered on stays a circle, so opening a collapsed relation is a separate step.
 */
export function projectRelationMap(
    notes: readonly ProjectedNote[],
    reifications: readonly RelationMapReification[],
    relations: readonly ProjectedRelation[],
    focusNoteId: string | null,
    collapsed: ReadonlySet<string> = NOTHING_COLLAPSED
): RelationProjection {
    const byNoteId = new Map(reifications.map((item) => [item.noteId, item]));
    let base: { circles: ProjectedNote[]; tokens: ReificationTokenPlacement[] };
    if (!focusNoteId) {
        base = circlesAndEdges(notes, reifications);
    } else {
        const opened = byNoteId.get(focusNoteId);
        base = opened?.kind === "relation" && opened.objectNoteId
            ? projectOpenedRelation(opened, notes, reifications, relations, byNoteId)
            : projectOpenedNote(focusNoteId, notes, byNoteId, reifications, relations);
    }
    return foldCollapsed(base, notes, reifications, relations, collapsed, focusNoteId);
}

function circlesAndEdges(
    notes: readonly ProjectedNote[],
    reifications: readonly RelationMapReification[]
): { circles: ProjectedNote[]; tokens: ReificationTokenPlacement[] } {
    const tokens = placeReificationTokens(notes, reifications);
    const edges = new Set(tokens.map((token) => token.noteId));
    return {
        circles: notes.filter((note) => !edges.has(note.noteId)),
        tokens
    };
}

function projectOpenedRelation(
    opened: RelationMapReification,
    notes: readonly ProjectedNote[],
    reifications: readonly RelationMapReification[],
    relations: readonly ProjectedRelation[],
    byNoteId: Map<string, RelationMapReification>
): { circles: ProjectedNote[]; tokens: ReificationTokenPlacement[] } {
    const placed = new Map(notes.map((note) => [note.noteId, note]));
    const circles: ProjectedNote[] = [relationAsNote(opened, placed)];
    const seen = new Set<string>([opened.noteId]);
    let index = 0;
    for (const relation of relations) {
        const other = otherEnd(relation, opened.noteId);
        if (!other || seen.has(other)) {
            continue;
        }
        const otherEdge = byNoteId.get(other);
        if (otherEdge?.kind === "relation" && otherEdge.objectNoteId) {
            seen.add(other);
            index = addEnds(otherEdge, circles, placed, byNoteId, seen, index);
            continue;
        }
        seen.add(other);
        const known = placed.get(other);
        circles.push(known ?? {
            noteId: other,
            x: circles[0].x + 240,
            y: circles[0].y + index * 140
        });
        index += 1;
    }

    return circlesAndEdges(
        circles,
        reifications.filter((item) => item.noteId !== opened.noteId)
    );
}

function projectOpenedNote(
    focusNoteId: string,
    notes: readonly ProjectedNote[],
    byNoteId: Map<string, RelationMapReification>,
    reifications: readonly RelationMapReification[],
    relations: readonly ProjectedRelation[]
): { circles: ProjectedNote[]; tokens: ReificationTokenPlacement[] } {
    const visible = new Set<string>([focusNoteId]);
    let guard = relations.length + reifications.length + 2;
    let grew = true;
    while (grew && guard > 0) {
        guard -= 1;
        grew = false;
        for (const relation of relations) {
            grew = followRelation(relation, visible, byNoteId) || grew;
        }
    }

    const placed = new Map(notes.map((note) => [note.noteId, note]));
    const circles: ProjectedNote[] = [];
    let index = 0;
    for (const noteId of visible) {
        const known = placed.get(noteId);
        circles.push(known ?? { noteId, x: 80 + index * 220, y: 80 });
        index += 1;
    }
    return circlesAndEdges(circles, reifications);
}

function followRelation(
    relation: ProjectedRelation,
    visible: Set<string>,
    byNoteId: Map<string, RelationMapReification>
): boolean {
    const srcEdge = byNoteId.get(relation.sourceNoteId);
    const tgtEdge = byNoteId.get(relation.targetNoteId);
    const srcInPlay = srcEdge ? edgeTouches(srcEdge, visible) : visible.has(relation.sourceNoteId);
    const tgtInPlay = tgtEdge ? edgeTouches(tgtEdge, visible) : visible.has(relation.targetNoteId);
    if (!srcInPlay && !tgtInPlay) {
        return false;
    }

    let grew = false;
    if (srcEdge) {
        grew = revealEnds(srcEdge, visible, byNoteId) || grew;
    } else if (!visible.has(relation.sourceNoteId)) {
        visible.add(relation.sourceNoteId);
        grew = true;
    }
    if (tgtEdge) {
        grew = revealEnds(tgtEdge, visible, byNoteId) || grew;
    } else if (!visible.has(relation.targetNoteId)) {
        visible.add(relation.targetNoteId);
        grew = true;
    }
    return grew;
}

function revealEnds(
    item: RelationMapReification,
    visible: Set<string>,
    byNoteId: Map<string, RelationMapReification>
): boolean {
    let grew = false;
    for (const end of [item.subjectNoteId, item.objectNoteId]) {
        if (!end || visible.has(end) || byNoteId.has(end)) {
            continue;
        }
        visible.add(end);
        grew = true;
    }
    return grew;
}

function addEnds(
    item: RelationMapReification,
    circles: ProjectedNote[],
    placed: Map<string, ProjectedNote>,
    byNoteId: Map<string, RelationMapReification>,
    seen: Set<string>,
    index: number
): number {
    let next = index;
    for (const end of [item.subjectNoteId, item.objectNoteId]) {
        if (!end || seen.has(end) || byNoteId.has(end)) {
            continue;
        }
        seen.add(end);
        const known = placed.get(end);
        circles.push(known ?? {
            noteId: end,
            x: circles[0].x + 240,
            y: circles[0].y + next * 140
        });
        next += 1;
    }
    return next;
}

function edgeTouches(item: RelationMapReification, visible: Set<string>): boolean {
    if (visible.has(item.subjectNoteId)) {
        return true;
    }
    return !!item.objectNoteId && visible.has(item.objectNoteId);
}

function relationAsNote(opened: RelationMapReification, placed: Map<string, ProjectedNote>): ProjectedNote {
    const subject = placed.get(opened.subjectNoteId);
    const object = opened.objectNoteId ? placed.get(opened.objectNoteId) : undefined;
    if (subject && object) {
        return {
            noteId: opened.noteId,
            x: (subject.x + object.x) / 2,
            y: (subject.y + object.y) / 2
        };
    }
    return placed.get(opened.noteId) ?? { noteId: opened.noteId, x: 80, y: 80 };
}

function otherEnd(
    relation: { sourceNoteId: string; targetNoteId: string },
    noteId: string
): string | null {
    if (relation.sourceNoteId === noteId && relation.targetNoteId !== noteId) {
        return relation.targetNoteId;
    }
    if (relation.targetNoteId === noteId && relation.sourceNoteId !== noteId) {
        return relation.sourceNoteId;
    }
    return null;
}

/**
 * A relation of a note that was folded away is not a relation of the fact.
 * A relation of the fact itself still counts, and is drawn from the fold.
 */
export function relationSurvivesFold(
    relation: ProjectedRelation,
    represent: (noteId: string) => string,
    reificationNoteIds: ReadonlySet<string>,
    collapsed: ReadonlySet<string>
): boolean {
    if (relation.attributeId && collapsed.has(relation.attributeId)) {
        return false;
    }
    const sourceFolded = represent(relation.sourceNoteId) !== relation.sourceNoteId;
    const targetFolded = represent(relation.targetNoteId) !== relation.targetNoteId;
    if (sourceFolded && !reificationNoteIds.has(relation.sourceNoteId)) {
        return false;
    }
    if (targetFolded && !reificationNoteIds.has(relation.targetNoteId)) {
        return false;
    }
    return represent(relation.sourceNoteId) !== represent(relation.targetNoteId);
}

function foldCollapsed(
    base: { circles: ProjectedNote[]; tokens: ReificationTokenPlacement[] },
    mapNotes: readonly ProjectedNote[],
    reifications: readonly RelationMapReification[],
    relations: readonly ProjectedRelation[],
    collapsed: ReadonlySet<string>,
    focusNoteId: string | null
): RelationProjection {
    const folds = reifications.filter((item) =>
        item.kind === "relation" && item.objectNoteId && collapsed.has(item.attributeId)
    );
    if (folds.length === 0) {
        return { ...base, represent: (noteId) => noteId, folds: [] };
    }

    const byNote = new Map(folds.map((item) => [item.noteId, item]));
    const byAny = new Map(reifications.map((item) => [item.noteId, item]));
    const parent = new Map<string, string>();
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
    const link = (from: string, to: string) => {
        const root = find(to);
        const child = find(from);
        if (child !== root) {
            parent.set(child, root);
        }
    };
    // The open relation stays the circle. Its ends still fold into it.
    const pinned = focusNoteId && byNote.has(focusNoteId) ? focusNoteId : null;
    const absorbed = new Set<string>();
    const absorb = (noteId: string, into: string) => {
        if (noteId === pinned || absorbed.has(noteId)) {
            return;
        }
        absorbed.add(noteId);
        link(noteId, into);
        const edge = byAny.get(noteId);
        if (edge?.kind === "relation" && edge.objectNoteId) {
            absorb(edge.subjectNoteId, into);
            absorb(edge.objectNoteId, into);
        }
    };
    for (const fold of folds) {
        if (!parent.has(fold.noteId)) {
            parent.set(fold.noteId, fold.noteId);
        }
        absorb(fold.subjectNoteId, fold.noteId);
        if (fold.objectNoteId) {
            absorb(fold.objectNoteId, fold.noteId);
        }
    }

    const placed = new Map<string, { x: number; y: number }>();
    for (const note of mapNotes) {
        placed.set(note.noteId, note);
    }
    for (const note of base.circles) {
        placed.set(note.noteId, note);
    }
    for (const token of base.tokens) {
        placed.set(token.noteId, {
            x: token.x + HALF - NOTE_ANCHOR_X,
            y: token.y + HALF - NOTE_ANCHOR_Y
        });
    }

    const memo = new Map<string, { x: number; y: number }>();
    const visiting = new Set<string>();
    const locate = (noteId: string): { x: number; y: number } => {
        const known = memo.get(noteId);
        if (known) {
            return known;
        }
        const fold = byNote.get(noteId);
        if (fold && !visiting.has(noteId)) {
            visiting.add(noteId);
            const subject = locate(fold.subjectNoteId);
            const object = fold.objectNoteId ? locate(fold.objectNoteId) : subject;
            visiting.delete(noteId);
            const position = { x: (subject.x + object.x) / 2, y: (subject.y + object.y) / 2 };
            memo.set(noteId, position);
            return position;
        }
        const at = placed.get(noteId) ?? { x: 80, y: 80 };
        memo.set(noteId, at);
        return at;
    };

    const reificationIds = new Set(reifications.map((item) => item.noteId));
    const touched = new Set<string>();
    for (const relation of relations) {
        if (!relationSurvivesFold(relation, find, reificationIds, collapsed)) {
            continue;
        }
        touched.add(find(relation.sourceNoteId));
        touched.add(find(relation.targetNoteId));
    }

    const circleIds = new Set<string>();
    for (const note of base.circles) {
        const id = find(note.noteId);
        if (id !== note.noteId) {
            continue;
        }
        // A note stays when a relation that still belongs to this view touches it.
        // The other relations of a folded fact's ends do not.
        if (byNote.has(id) || touched.has(id)) {
            circleIds.add(id);
        }
    }
    for (const fold of folds) {
        if (find(fold.noteId) === fold.noteId) {
            circleIds.add(fold.noteId);
        }
    }

    const tokens = base.tokens.filter((token) =>
        !collapsed.has(token.attributeId) && find(token.noteId) === token.noteId
    );
    const tokenIds = new Set(tokens.map((token) => token.noteId));
    const circles: ProjectedNote[] = [];
    for (const noteId of circleIds) {
        if (tokenIds.has(noteId)) {
            continue;
        }
        const position = locate(noteId);
        circles.push({ noteId, x: position.x, y: position.y });
    }

    return {
        circles,
        tokens,
        represent: find,
        folds: folds
            .filter((item) => find(item.noteId) === item.noteId)
            .map((item) => ({ noteId: item.noteId, attributeId: item.attributeId }))
    };
}

function isEdgeHere(item: RelationMapReification, onMap: Set<string>): boolean {
    if (!onMap.has(item.noteId)) {
        return true;
    }
    // Placed on the map as a box. A relation between two other notes is the arrow
    // between them. A label stays the box that was placed.
    if (item.kind !== "relation" || !item.objectNoteId) {
        return false;
    }
    return item.subjectNoteId !== item.noteId && item.objectNoteId !== item.noteId;
}

function centerFor(
    item: RelationMapReification,
    centers: Map<string, { x: number; y: number }>,
    pairTotal: Map<string, number>,
    pairIndex: Map<string, number>,
    labelIndex: Map<string, number>
): { x: number; y: number } | null {
    const subject = centers.get(item.subjectNoteId);
    if (!subject) {
        return null;
    }

    if (item.kind === "label" || !item.objectNoteId) {
        const index = nextIndex(labelIndex, item.subjectNoteId);
        return {
            x: subject.x,
            y: subject.y - SELF_LIFT - index * STACK
        };
    }

    if (item.subjectNoteId === item.objectNoteId) {
        return { x: subject.x, y: subject.y - SELF_LIFT };
    }

    const object = centers.get(item.objectNoteId);
    if (!object) {
        return null;
    }

    const key = pairKey(item.subjectNoteId, item.objectNoteId);
    const index = nextIndex(pairIndex, key);
    const total = pairTotal.get(key) ?? 1;
    const along = (index - (total - 1) / 2) * STACK;
    const dx = object.x - subject.x;
    const dy = object.y - subject.y;
    const len = Math.hypot(dx, dy) || 1;
    return {
        x: (subject.x + object.x) / 2 + (-dy / len) * along,
        y: (subject.y + object.y) / 2 + (dx / len) * along
    };
}

function separateFrom(center: { x: number; y: number }, taken: { x: number; y: number }[]): { x: number; y: number } {
    let spot = center;
    for (let attempt = 0; attempt < 6; attempt++) {
        const clash = taken.some((other) => Math.hypot(other.x - spot.x, other.y - spot.y) < TOKEN_SIZE);
        if (!clash) {
            return spot;
        }
        spot = { x: spot.x, y: spot.y + STACK };
    }
    return spot;
}

function pairKey(subjectNoteId: string, objectNoteId: string) {
    return `${subjectNoteId}\0${objectNoteId}`;
}

function nextIndex(indexes: Map<string, number>, key: string) {
    const index = indexes.get(key) ?? 0;
    indexes.set(key, index + 1);
    return index;
}
