import { createContext } from "preact";
import { useSyncExternalStore } from "preact/compat";
import { useCallback, useContext } from "preact/hooks";

/**
 * Which items a collection has selected, held outside component state.
 *
 * Kept in a store rather than in state so that a change wakes only the items whose own answer
 * changed. A board holds hundreds of cards, and selecting one must not redraw the rest.
 *
 * The keys are opaque strings the collection chooses. A board selects by `noteId`; another
 * collection can select by whatever identifies one of its rows.
 */
export class SelectionStore {
    private selected: ReadonlySet<string> = new Set();
    private anchorKey: string | null = null;
    private listeners = new Set<() => void>();

    /** The selected keys, which keep one identity until the selection changes. */
    get keys() {
        return this.selected;
    }

    /** Where a range starts, which is the item last picked without Shift. */
    get anchor() {
        return this.anchorKey;
    }

    get size() {
        return this.selected.size;
    }

    has(key: string) {
        return this.selected.has(key);
    }

    /** Selects one item on its own, dropping whatever else was selected. */
    selectOnly(key: string) {
        this.anchorKey = key;
        this.replace(new Set([ key ]));
    }

    /** Adds or removes one item, keeping the rest. Ctrl+Click does this. */
    toggle(key: string) {
        const next = new Set(this.selected);
        if (!next.delete(key)) {
            next.add(key);
        }

        this.anchorKey = key;
        this.replace(next);
    }

    /**
     * Selects a whole list at once, dropping whatever else was selected. Ctrl+A does this.
     *
     * The anchor lands on the first of them, so a Shift+Click afterwards ranges from the head of
     * what was just taken.
     */
    selectAll(keys: string[]) {
        this.anchorKey = keys[0] ?? null;
        this.replace(new Set(keys));
    }

    /**
     * Selects everything between the anchor and `to`, dropping whatever else was selected.
     *
     * The anchor stays where it was, so a second Shift+Click grows or shrinks the same range
     * rather than starting a new one.
     *
     * @param ordered the items a range can cover, in the order they are drawn. The caller decides
     * what that list holds, so a board passes one column and a range never crosses into another.
     * @param to the item that was clicked.
     */
    selectRange(ordered: string[], to: string) {
        const end = ordered.indexOf(to);
        if (end < 0) {
            return;
        }

        // No anchor yet, or one standing outside `ordered`, such as a card in another column.
        const start = this.anchorKey === null ? -1 : ordered.indexOf(this.anchorKey);
        if (start < 0) {
            this.selectOnly(to);
            return;
        }

        this.replace(new Set(ordered.slice(Math.min(start, end), Math.max(start, end) + 1)));
    }

    clear() {
        this.anchorKey = null;
        this.replace(new Set());
    }

    /**
     * Drops the keys `present` does not list, for items that have left the collection.
     *
     * Called when the collection redraws: a note deleted, archived out of view or moved off the
     * board must leave the selection, or a later command acts on an item that is no longer there.
     */
    retain(present: ReadonlySet<string>) {
        if ([ ...this.selected ].every((key) => present.has(key))) {
            return;
        }

        const kept = new Set([ ...this.selected ].filter((key) => present.has(key)));
        if (this.anchorKey !== null && !kept.has(this.anchorKey)) {
            this.anchorKey = null;
        }

        this.replace(kept);
    }

    subscribe(listener: () => void) {
        this.listeners.add(listener);
        return () => { this.listeners.delete(listener); };
    }

    /** Announces the new set, and only when it differs, so an unchanged pick redraws nothing. */
    private replace(next: ReadonlySet<string>) {
        if (next.size === this.selected.size
                && [ ...next ].every((key) => this.selected.has(key))) {
            return;
        }

        this.selected = next;
        for (const listener of [ ...this.listeners ]) {
            listener();
        }
    }
}

/* v8 ignore next -- a collection always provides its own; this is what lets a consumer read it
   with a plain useContext(), with no guard for a provider that is structurally always there. */
export const SelectionContext = createContext(new SelectionStore());

/** The store itself, for the handlers that change the selection. */
export function useSelection() {
    return useContext(SelectionContext);
}

/** Whether one item is selected. Redraws that item alone when its own answer changes. */
export function useIsSelected(key: string) {
    const store = useSelection();

    return useSyncExternalStore(
        useCallback((listener: () => void) => store.subscribe(listener), [ store ]),
        useCallback(() => store.has(key), [ store, key ])
    );
}

/** How many items are selected, for the components that report the size of a selection. */
export function useSelectionCount() {
    const store = useSelection();

    return useSyncExternalStore(
        useCallback((listener: () => void) => store.subscribe(listener), [ store ]),
        useCallback(() => store.size, [ store ])
    );
}
