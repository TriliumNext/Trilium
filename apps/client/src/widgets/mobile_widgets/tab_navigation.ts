import type { Screen } from "../../components/mobile_screen_switcher.js";
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
    return buildStackForActiveNote(notePath, hoistedNoteId);
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

function buildStackForActiveNote(activeNotePath: string | null | undefined, hoistedId: string): string[] {
    if (!activeNotePath) return [hoistedId];

    const segments = activeNotePath.split("/");
    const activeNoteId = segments[segments.length - 1];
    const activeNote = froca.getNoteFromCache(activeNoteId);

    // If the active note is a folder, show its own children; otherwise show its parent's.
    // Notes marked with `#subtreeHidden` hide their children (e.g. options), so we
    // treat them like leaves and land on the parent column instead of an empty one.
    const treatAsFolder = !!activeNote?.hasChildren() && !activeNote.isLabelTruthy("subtreeHidden");
    const parentSegments = treatAsFolder ? segments : segments.slice(0, -1);

    // Clamp to the hoisted root.
    let start = parentSegments.indexOf(hoistedId);
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
