import { useEffect, useState } from "preact/hooks";

import type { Screen } from "../../components/mobile_screen_switcher.js";
import type FNote from "../../entities/fnote.js";
import froca from "../../services/froca.js";

/**
 * The column a tab's note tree stands on, as the stack of note paths leading to it, and the note path
 * and hoisted note the tab had when the stack was built.
 */
export interface TreeStack {
    notePath: string | null | undefined;
    hoistedNoteId: string;
    stack: string[];
}

/** What a tab shows on a phone: the tree or its note, and where its tree stands. */
export interface TabNavigation {
    screen?: Screen;
    tree?: TreeStack;
}

/** Keyed by the ntxId of each tab's main context, so the splits of a tab share one entry. */
const tabNavigations = new Map<string, TabNavigation>();

export function getTabNavigation(tabId: string | null | undefined) {
    return tabId ? tabNavigations.get(tabId) : undefined;
}

export function setTabScreen(tabId: string, screen: Screen) {
    tabNavigations.set(tabId, { ...tabNavigations.get(tabId), screen });
}

export function setTabTree(tabId: string, tree: TreeStack) {
    tabNavigations.set(tabId, { ...tabNavigations.get(tabId), tree });
}

export function forgetTabs(tabIds: string[]) {
    for (const tabId of tabIds) {
        tabNavigations.delete(tabId);
    }
}

/**
 * The stack the tree of `tabId` shows: the one the tab was left on, as long as the tab still has the
 * note and hoisting it had then, otherwise the column of the tab's note.
 */
export function getTreeStack(tabId: string | null | undefined, notePath: string | null | undefined, hoistedNoteId: string) {
    const saved = getTabNavigation(tabId)?.tree;
    if (saved && saved.notePath === notePath && saved.hoistedNoteId === hoistedNoteId) {
        return saved.stack;
    }
    return buildStackForActiveNote(notePath, hoistedNoteId, true);
}

/**
 * The stack of the column that lists the note at `notePath`, which a phone's tree goes back to from
 * the note, even when the note has children.
 */
export function getParentStack(notePath: string | null | undefined, hoistedNoteId: string) {
    return buildStackForActiveNote(notePath, hoistedNoteId, false);
}

/**
 * Leaves the tree of `tabId` on the column holding `hoistedNoteId` once the tab unhoists, as a step
 * up out of the hoisted note, instead of the column of the note the tab shows. Runs before the
 * unhoisting, which keeps `notePath` open.
 */
export function leaveHoistedNote(tabId: string, notePath: string | null | undefined, hoistedNoteId: string) {
    const segments = notePath?.split("/") ?? [];
    const parentSegments = segments.slice(0, Math.max(segments.indexOf(hoistedNoteId), 1));
    const stack = parentSegments.map((_, index) => parentSegments.slice(0, index + 1).join("/"));
    setTabTree(tabId, { notePath, hoistedNoteId: "root", stack: stack.length ? stack : [ "root" ] });
}

/**
 * Leaves the tree of `tabId` on the column of `hoistedNoteId` once the tab hoists it, as entering a
 * folder does, instead of the column of a note inside it that the tab shows. Runs before the
 * hoisting; when `notePath` lies outside the hoisted note, the hoisting opens the hoisted note
 * itself, whose tree starts on that column anyway.
 */
export function enterHoistedNote(tabId: string, notePath: string | null | undefined, hoistedNoteId: string) {
    setTabTree(tabId, { notePath, hoistedNoteId, stack: [ hoistedNoteId ] });
}

/**
 * The child of the column at `columnPath` that leads to `notePath`, which a column with
 * `#subtreeHidden` still lists, as the desktop tree's spotlight does. A hoisted tree's `columnPath`
 * starts at the hoisted note, so it can match the middle of `notePath`.
 */
export function getSpotlightedNoteId(columnPath: string | undefined, notePath: string | null | undefined) {
    if (!columnPath || !notePath) return undefined;
    const columnIds = columnPath.split("/");
    const noteIds = notePath.split("/");
    const start = noteIds.indexOf(columnIds[0]);
    if (start < 0 || columnIds.some((noteId, index) => noteIds[start + index] !== noteId)) return undefined;
    return noteIds[start + columnIds.length];
}

export function getLastSegment(notePath: string): string {
    const idx = notePath.lastIndexOf("/");
    return idx >= 0 ? notePath.slice(idx + 1) : notePath;
}

function buildStackForActiveNote(activeNotePath: string | null | undefined, hoistedId: string, openFolder: boolean): string[] {
    if (!activeNotePath) return [hoistedId];

    const segments = activeNotePath.split("/");
    const activeNoteId = segments[segments.length - 1];
    const activeNote = froca.getNoteFromCache(activeNoteId);

    // With `openFolder`, a folder shows its own children; otherwise the note shows its parent's.
    // Notes marked with `#subtreeHidden` hide their children (e.g. options), so we
    // treat them like leaves and land on the parent column instead of an empty one.
    const treatAsFolder = openFolder && !!activeNote?.hasChildren() && !activeNote.isLabelTruthy("subtreeHidden");
    const parentSegments = treatAsFolder ? segments : segments.slice(0, -1);

    // Clamp to the hoisted root.
    let start = segments.indexOf(hoistedId);
    if (start < 0) start = 0;
    const clamped = parentSegments.slice(start);
    if (clamped.length === 0) {
        return [hoistedId];
    }

    const stack: string[] = [];
    for (let i = 0; i < clamped.length; i++) {
        stack.push(clamped.slice(0, i + 1).join("/"));
    }
    return stack;
}

/** A child of a navigator column: its note and the branch that places it there. */
export interface NavigatorChild {
    note: FNote;
    branchId: string;
}

export function useNavigatorChildren(
    parentNote: FNote | null | undefined,
    hideArchived: boolean,
    isLoaded: boolean,
    isParentSubtreeHidden: boolean,
    spotlightedNoteId: string | undefined
): NavigatorChild[] {
    const [children, setChildren] = useState<NavigatorChild[]>([]);
    // Re-run when the parent's child list mutates in place (e.g., a new branch is added by
    // froca_updater). The join captures the current ordered noteIds so a real change in the
    // children set produces a new dep value.
    const childrenKey = parentNote?.children?.join(",");

    useEffect(() => {
        if (!parentNote || !isLoaded || (isParentSubtreeHidden && !spotlightedNoteId)) {
            setChildren([]);
            return;
        }
        let cancelled = false;
        // A parent with `#subtreeHidden` lists only the child on the active note's path.
        const branches = parentNote.getChildBranches()
            .filter((b): b is NonNullable<typeof b> => !!b)
            .filter((b) => !isParentSubtreeHidden || b.noteId === spotlightedNoteId);
        // Use the async loader so notes that aren't yet in cache (e.g., freshly created via "+")
        // are pulled in. `processNoteChange` only updates notes already in froca, so without this
        // newly-created child notes would be silently skipped.
        froca.getNotes(branches.map((b) => b.noteId), true).then((notes) => {
            if (cancelled) return;
            const noteMap = new Map(notes.map((n) => [n.noteId, n]));
            const result: NavigatorChild[] = [];
            for (const branch of branches) {
                const note = noteMap.get(branch.noteId);
                if (!note) continue;
                if (note.noteId === "_hidden") continue;
                if (hideArchived && note.isArchived) continue;
                result.push({ note, branchId: branch.branchId });
            }
            setChildren(result);
        });
        return () => { cancelled = true; };
    }, [parentNote, childrenKey, hideArchived, isLoaded, isParentSubtreeHidden, spotlightedNoteId]);

    return children;
}
