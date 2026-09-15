import type { NotePathRecord } from "../../entities/fnote";

/** One note segment within a compressed inverse path chain. */
export interface InverseNotePathSegment {
    noteId: string;
    /** Path from a workspace root down to this ancestor, used to navigate directly to it. */
    ancestorPath: string;
    isOpenNote: boolean;
}

/**
 * One node of the compressed inverse note-path tree: linear non-branching ancestor sequences
 * are collapsed into a single `segments` breadcrumb chain (`parent > grandparent > ...`),
 * and only branch into `children` when there is a choice between multiple placements.
 */
export interface CompressedInverseTreeNode {
    segments: InverseNotePathSegment[];
    /** A full path from a workspace root down to the open note that passes through this branch. */
    pathToOpenNote: string;
    isOnActiveTrail: boolean;
    /** Path-level flags; set on leaves, where each node stands for one complete placement. */
    record?: NotePathRecord;
    children: CompressedInverseTreeNode[];
}

interface RawNode {
    noteId: string;
    ancestorPath: string;
    pathToOpenNote: string;
    isOpenNote: boolean;
    record?: NotePathRecord;
    children: Map<string, RawNode>;
}

interface UncompressedNode {
    noteId: string;
    ancestorPath: string;
    pathToOpenNote: string;
    isOpenNote: boolean;
    isOnActiveTrail: boolean;
    record?: NotePathRecord;
    children: UncompressedNode[];
}

export function buildInverseNotePathTree(
    records: NotePathRecord[],
    currentNotePath?: string | null
): CompressedInverseTreeNode | null {
    const roots = new Map<string, RawNode>();

    for (const record of records) {
        const originalPath = record.notePath;
        if (!originalPath.length) {
            continue;
        }

        const pathToOpenNote = originalPath.join("/");
        let level = roots;

        for (let i = originalPath.length - 1; i >= 0; i--) {
            const noteId = originalPath[i];
            const ancestorPath = originalPath.slice(0, i + 1).join("/");
            const isLeaf = i === 0;
            let node = level.get(noteId);

            if (!node) {
                node = {
                    noteId,
                    ancestorPath,
                    pathToOpenNote,
                    isOpenNote: i === originalPath.length - 1,
                    children: new Map()
                };
                if (isLeaf) {
                    node.record = record;
                }
                level.set(noteId, node);
            } else {
                if (isPathActive(pathToOpenNote, currentNotePath)) {
                    node.ancestorPath = ancestorPath;
                    node.pathToOpenNote = pathToOpenNote;
                    if (isLeaf) {
                        node.record = record;
                    }
                }
            }

            level = node.children;
        }
    }

    const rawRoot = roots.values().next().value;
    if (!rawRoot) {
        return null;
    }

    const activeSegments = currentNotePath ? currentNotePath.split("/") : null;
    const uncompressedRoot = resolveActiveTrail(rawRoot, true, 0, activeSegments);
    return compressNode(uncompressedRoot);
}

function isPathActive(path: string, currentNotePath?: string | null) {
    return !!currentNotePath && (currentNotePath === path || currentNotePath.startsWith(`${path}/`));
}

function resolveActiveTrail(
    raw: RawNode,
    parentIsActive: boolean,
    depth: number,
    activeSegments: string[] | null
): UncompressedNode {
    let isActive = false;
    if (depth === 0) {
        isActive = activeSegments !== null;
    } else if (parentIsActive && activeSegments !== null) {
        const expectedIndex = activeSegments.length - 1 - depth;
        if (expectedIndex >= 0 && raw.noteId === activeSegments[expectedIndex]) {
            const expectedAncestorPath = activeSegments.slice(0, expectedIndex + 1).join("/");
            if (raw.ancestorPath === expectedAncestorPath) {
                isActive = true;
            }
        }
    }

    const children: UncompressedNode[] = [];
    for (const child of raw.children.values()) {
        children.push(resolveActiveTrail(child, isActive, depth + 1, activeSegments));
    }

    return {
        noteId: raw.noteId,
        ancestorPath: raw.ancestorPath,
        pathToOpenNote: raw.pathToOpenNote,
        isOpenNote: raw.isOpenNote,
        isOnActiveTrail: isActive,
        record: raw.record,
        children
    };
}

function compressNode(node: UncompressedNode): CompressedInverseTreeNode {
    const segments: InverseNotePathSegment[] = [
        {
            noteId: node.noteId,
            ancestorPath: node.ancestorPath,
            isOpenNote: node.isOpenNote
        }
    ];

    let current = node;
    while (current.children.length === 1) {
        const onlyChild = current.children[0];
        segments.push({
            noteId: onlyChild.noteId,
            ancestorPath: onlyChild.ancestorPath,
            isOpenNote: onlyChild.isOpenNote
        });
        current = onlyChild;
    }

    const children = current.children.map(compressNode);

    return {
        segments,
        pathToOpenNote: current.pathToOpenNote,
        isOnActiveTrail: current.isOnActiveTrail,
        record: current.record,
        children
    };
}

/** Stable id for a compressed branch, independent of which clone path is currently open. */
export function inverseTreeBranchId(node: CompressedInverseTreeNode) {
    return node.segments.map((segment) => segment.noteId).join("/");
}
