import { render } from "preact";
import { act } from "preact/test-utils";

import Component from "../components/component";
import type NoteContext from "../components/note_context";
import { NoteContextContext, ParentComponent } from "../widgets/react/react_utils";

export interface RenderHookResult<T> {
    /** Holds the latest value returned by the hook; re-read after each `fireEvent`/`flush`/`rerender`. */
    result: { current: T };
    /** The Trilium {@link Component} backing `ParentComponent`; Trilium events are dispatched through it. */
    parent: Component;
    /** Synchronously dispatch a Trilium event to the hook's `useTriliumEvent`/`useTriliumEvents` handlers. */
    fireEvent: (name: string, data: unknown) => void;
    /** Re-render with the same (or a new) hook closure, e.g. to change the hook's arguments. */
    rerender: (hook?: () => T) => void;
    /** Unmount the harness, running the hook's cleanup effects. */
    unmount: () => void;
}

/**
 * Renders a single Preact hook inside the Trilium context providers and exposes its return value.
 *
 * Mirrors the real render path in `react_utils.tsx` (a `ParentComponent.Provider`), so
 * `useTriliumEvent` handlers register against `parent` and can be driven via `fireEvent`.
 */
export function renderHook<T>(initialHook: () => T, { parent = new Component(), noteContext = null }: {
    parent?: Component;
    noteContext?: NoteContext | null;
} = {}): RenderHookResult<T> {
    const container = document.createElement("div");
    document.body.appendChild(container);
    const result = { current: undefined as unknown as T };

    function Harness({ hook }: { hook: () => T }) {
        result.current = hook();
        return null;
    }

    const doRender = (hook: () => T) => render((
        <ParentComponent.Provider value={parent}>
            <NoteContextContext.Provider value={noteContext}>
                <Harness hook={hook} />
            </NoteContextContext.Provider>
        </ParentComponent.Provider>
    ), container);

    act(() => doRender(initialHook));

    return {
        result,
        parent,
        fireEvent: (name, data) => act(() => {
            // eslint-disable-next-line @typescript-eslint/no-explicit-any
            (parent.handleEventInChildren as any)(name, data);
        }),
        rerender: (hook = initialHook) => act(() => doRender(hook)),
        unmount: () => act(() => { render(null, container); container.remove(); })
    };
}

/** Settle pending effects, async microtask chains (froca/server), and the resulting re-render. */
export async function flush() {
    await act(async () => { await new Promise(resolve => setTimeout(resolve, 0)); });
}

/**
 * Builds a duck-typed `LoadResults` for `entitiesReloaded`-style events. Only the accessors the
 * React hooks actually call are implemented; pass just the data the hook under test reads.
 */
export function makeLoadResults(opts: {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    attributeRows?: any[];
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    branchRows?: any[];
    optionNames?: string[];
    reloadedNoteIds?: string[];
    contentReloadedNoteIds?: string[];
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    entities?: Record<string, Record<string, any>>;
} = {}) {
    return {
        getAttributeRows: () => opts.attributeRows ?? [],
        getBranchRows: () => opts.branchRows ?? [],
        getOptionNames: () => opts.optionNames ?? [],
        isNoteReloaded: (noteId?: string | null) => !!noteId && (opts.reloadedNoteIds ?? []).includes(noteId),
        isNoteContentReloaded: (noteId?: string | null) => !!noteId && (opts.contentReloadedNoteIds ?? []).includes(noteId),
        getEntityRow: (entityName: string, id: string) => opts.entities?.[entityName]?.[id]
    };
}
