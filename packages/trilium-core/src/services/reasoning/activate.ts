import becca from "../../becca/becca.js";
import type { ClauseInterest } from "./rule_program.js";

/** What changed. `rule` means the program itself changed and a full pass is required. */
export interface ReasoningChange {
    noteId: string;
    kind: "label" | "relation" | "title" | "structure" | "content" | "rule";
    name?: string;
}

const HOPS = 2;
/** A descendant walk bigger than this falls back to a full pass. */
const SUBTREE_CAP = 1500;

export function wakes(interest: ClauseInterest, change: ReasoningChange): boolean {
    if (change.kind === "rule") {
        return true;
    }
    if (change.kind === "content") {
        return false;
    }
    if (change.kind === "title") {
        return interest.title;
    }
    if (change.kind === "structure") {
        return interest.child || interest.parent || interest.descendant;
    }
    if (change.kind === "label") {
        return !!change.name && interest.labels.includes(change.name);
    }
    if (change.kind === "relation") {
        return !!change.name && interest.relations.includes(change.name);
    }
    return false;
}

export interface Touch {
    ids: Set<string>;
    /** False when a descendant walk would have covered more notes than `SUBTREE_CAP`. */
    complete: boolean;
}

/**
 * Notes a local recheck has to see: `HOPS` of parents, children and relations around `seeds`,
 * plus the ancestor chain. When `descendants` is set, also the subtrees of those ancestors,
 * stopping at `stopAt` so a workspace rule does not walk the rest of the database.
 */
export function collectTouch(
    seeds: readonly string[],
    descendants: boolean,
    stopAt: string | null
): Touch {
    const ids = new Set<string>();
    const queue: { id: string; depth: number }[] = [];
    for (const id of seeds) {
        queue.push({ id, depth: 0 });
    }

    let index = 0;
    while (index < queue.length) {
        const item = queue[index];
        index += 1;
        if (!item || ids.has(item.id)) {
            continue;
        }
        const note = becca.notes[item.id];
        if (!note || note.isDeleted || item.id.startsWith("_")) {
            continue;
        }
        ids.add(item.id);
        if (item.depth >= HOPS) {
            continue;
        }
        for (const parent of note.getParentNotes()) {
            queue.push({ id: parent.noteId, depth: item.depth + 1 });
        }
        for (const child of note.getChildNotes()) {
            queue.push({ id: child.noteId, depth: item.depth + 1 });
        }
        for (const attr of note.getOwnedAttributes()) {
            if (attr.type === "relation" && attr.value && !attr.isDeleted) {
                queue.push({ id: attr.value, depth: item.depth + 1 });
            }
        }
        for (const incoming of note.getTargetRelations()) {
            if (!incoming.isDeleted) {
                queue.push({ id: incoming.noteId, depth: item.depth + 1 });
            }
        }
    }

    const ancestors = ancestorIds(seeds);
    for (const id of ancestors) {
        ids.add(id);
    }

    if (!descendants) {
        return { ids, complete: true };
    }

    const roots = descendantRoots(seeds, stopAt);
    for (const root of roots) {
        if (!addSubtree(root, ids, SUBTREE_CAP)) {
            return { ids, complete: false };
        }
    }
    return { ids, complete: true };
}

/** Adds `rootId` and its descendants to `ids`. Returns false when `ids` would pass `cap`. */
export function addSubtree(rootId: string, ids: Set<string>, cap: number): boolean {
    const stack = [rootId];
    const seen = new Set<string>();
    while (stack.length > 0) {
        const id = stack.pop();
        if (!id || seen.has(id)) {
            continue;
        }
        seen.add(id);
        if (id.startsWith("_")) {
            continue;
        }
        const note = becca.notes[id];
        if (!note || note.isDeleted) {
            continue;
        }
        ids.add(id);
        if (ids.size > cap) {
            return false;
        }
        for (const child of note.getChildNotes()) {
            stack.push(child.noteId);
        }
    }
    return true;
}

function ancestorIds(seeds: readonly string[]): Set<string> {
    const ids = new Set<string>();
    const queue = [...seeds];
    const seen = new Set<string>();
    let index = 0;
    while (index < queue.length) {
        const id = queue[index];
        index += 1;
        if (!id || seen.has(id)) {
            continue;
        }
        seen.add(id);
        const note = becca.notes[id];
        if (!note || note.isDeleted) {
            continue;
        }
        if (!id.startsWith("_")) {
            ids.add(id);
        }
        for (const parent of note.getParentNotes()) {
            queue.push(parent.noteId);
        }
    }
    return ids;
}

/**
 * Seeds and the ancestors a descendant rule has to recheck. Walks up through `stopAt` and no
 * further, so the siblings of a workspace are left out.
 */
function descendantRoots(seeds: readonly string[], stopAt: string | null): string[] {
    const roots: string[] = [];
    const seen = new Set<string>();
    const queue = [...seeds];
    let index = 0;
    while (index < queue.length) {
        const id = queue[index];
        index += 1;
        if (!id || seen.has(id) || id.startsWith("_")) {
            continue;
        }
        seen.add(id);
        const note = becca.notes[id];
        if (!note || note.isDeleted) {
            continue;
        }
        roots.push(id);
        if (id === stopAt) {
            continue;
        }
        for (const parent of note.getParentNotes()) {
            queue.push(parent.noteId);
        }
    }
    return roots;
}
