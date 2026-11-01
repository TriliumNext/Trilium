import { createContext } from "preact";
import { useSyncExternalStore } from "preact/compat";
import { useCallback, useContext } from "preact/hooks";

/** Where the gap held open for a carried card stands. */
export interface DropState {
    /** The column the gap is in and the place it takes, or nothing while the card is over none. */
    position: { column: string, index: number } | null;
    /** The column the card is over, which is drawn as the one it would land in. */
    target: string | null;
}

/**
 * Where the gap stands, held outside the board's own state.
 *
 * Read as board state this moved on every step of a drag, and with it the whole board: 23 columns
 * and every card on them redrawn to move one gap. Held here, a step wakes only the columns whose
 * own answer changed, which is the one the gap left, the one it arrived in, and their neighbours.
 */
export class DropStateStore {
    private state: DropState = { position: null, target: null };
    private listeners = new Set<() => void>();

    get() {
        return this.state;
    }

    set(state: DropState) {
        this.state = state;
        for (const listener of [ ...this.listeners ]) {
            listener();
        }
    }

    subscribe(listener: () => void) {
        this.listeners.add(listener);
        return () => { this.listeners.delete(listener); };
    }
}

/* v8 ignore next -- the board always provides its own; this is what lets a consumer read it with a
   plain useContext(), with no guard for a provider that is structurally always there. */
export const BoardDropStateContext = createContext(new DropStateStore());

/** Which place the gap holds open in this column, or nothing while it is standing elsewhere. */
export function useDropIndex(column: string) {
    return useDropState(useCallback((state: DropState) =>
        state.position?.column === column ? state.position.index : null, [ column ]));
}

/** Whether a carried card is over this column, which draws it as the one it would land in. */
export function useIsDropTarget(column: string) {
    return useDropState(useCallback((state: DropState) => state.target === column, [ column ]));
}

/**
 * Follows one thing about where the gap stands, redrawing only when that thing changes.
 *
 * @param select what to read, which has to answer with a value comparable by identity: every
 * column asks on every step of a drag, and an answer built afresh each time would redraw them all.
 */
function useDropState<T>(select: (state: DropState) => T): T {
    const store = useContext(BoardDropStateContext);
    return useSyncExternalStore(
        useCallback((listener: () => void) => store.subscribe(listener), [ store ]),
        useCallback(() => select(store.get()), [ store, select ])
    );
}
