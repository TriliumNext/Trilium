/**
 * Pure helpers for the pinned-tabs feature. Kept free of DOM/appContext dependencies so the
 * decision logic can be unit-tested in isolation.
 */

/**
 * Decides whether a navigation request on a context should be redirected into a new tab.
 *
 * A pinned tab stays on the note it was pinned to: any attempt to navigate it to a *different*
 * note is redirected to a new tab instead. The first load (when the context has no note yet) and
 * same-note view changes are always allowed.
 */
export function shouldRedirectPinnedNavigation(
    pinned: boolean | undefined,
    currentNoteId: string | null | undefined,
    targetNoteId: string | null | undefined
): boolean {
    return !!pinned && !!currentNoteId && !!targetNoteId && currentNoteId !== targetNoteId;
}

/**
 * Stable partition that moves pinned items to the front while preserving the relative order within
 * the pinned and unpinned groups. This keeps pinned tabs grouped at the beginning of the tab row.
 */
export function partitionPinnedFirst<T>(items: T[], isPinned: (item: T) => boolean): T[] {
    const pinned: T[] = [];
    const unpinned: T[] = [];

    for (const item of items) {
        (isPinned(item) ? pinned : unpinned).push(item);
    }

    return [...pinned, ...unpinned];
}

/**
 * Clamps a drag-and-drop destination index so a tab cannot cross the pinned/unpinned boundary:
 * pinned tabs stay within `[0, pinnedCount - 1]`, unpinned tabs within `[pinnedCount, total - 1]`.
 */
export function clampDragDestination(destination: number, isPinned: boolean, pinnedCount: number, total: number): number {
    if (isPinned) {
        return Math.max(0, Math.min(destination, pinnedCount - 1));
    }

    return Math.max(pinnedCount, Math.min(destination, total - 1));
}
