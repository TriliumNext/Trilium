import { render, type VNode } from "preact";
import { act } from "preact/test-utils";
import { afterEach, vi } from "vitest";

import Component from "../components/component";
import type NoteContext from "../components/note_context";
import froca from "../services/froca";
import noteAttributeCache from "../services/note_attribute_cache";
import { NoteContextContext, ParentComponent } from "../widgets/react/react_utils";

// Every container rendered through this module is torn down automatically so Tooltips / listeners
// don't leak between tests. (Replaces the per-spec `let container … afterEach(render(null, …))` dance.)
const mounted: HTMLElement[] = [];
afterEach(() => {
    for (const container of mounted.splice(0)) {
        act(() => render(null, container));
        container.remove();
    }
});

function mount(): HTMLElement {
    const container = document.createElement("div");
    document.body.appendChild(container);
    mounted.push(container);
    return container;
}

/** Render a presentational component (no Trilium context) into a fresh happy-dom div; returns the container. */
export function renderInto(vnode: VNode | unknown): HTMLElement {
    const container = mount();
    act(() => render(vnode as VNode, container));
    return container;
}

export interface RenderResult {
    container: HTMLElement;
    parent: Component;
    rerender: (vnode: VNode | unknown) => void;
    unmount: () => void;
}

/**
 * Render a component inside the Trilium providers (`ParentComponent` + `NoteContextContext`), so
 * `useTriliumEvent` handlers register against `parent` and `noteContext` hooks resolve.
 */
export function renderComponent(vnode: VNode | unknown, { parent = new Component(), noteContext = null }: {
    parent?: Component;
    noteContext?: NoteContext | null;
} = {}): RenderResult {
    const container = mount();
    const wrap = (v: VNode | unknown) => (
        <ParentComponent.Provider value={parent}>
            <NoteContextContext.Provider value={noteContext}>
                {v as VNode}
            </NoteContextContext.Provider>
        </ParentComponent.Provider>
    );
    act(() => render(wrap(vnode), container));
    return {
        container,
        parent,
        rerender: (v) => act(() => render(wrap(v), container)),
        unmount: () => act(() => { render(null, container); container.remove(); })
    };
}

export interface RenderHookResult<T> {
    result: { current: T };
    parent: Component;
    fireEvent: (name: string, data: unknown) => void;
    rerender: (hook?: () => T) => void;
    unmount: () => void;
}

/** Render a single Preact hook and expose its return value (re-read `result.current` after each step). */
export function renderHook<T>(initialHook: () => T, { parent = new Component(), noteContext = null }: {
    parent?: Component;
    noteContext?: NoteContext | null;
} = {}): RenderHookResult<T> {
    const container = mount();
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

/** A minimal `NoteContext`-shaped object; the hooks/components under test only touch a few fields. */
export function fakeNoteContext(overrides: Record<string, unknown> = {}): NoteContext {
    return {
        ntxId: "ntx1",
        hoistedNoteId: "root",
        notePath: "root/note1",
        viewScope: { viewMode: "default", isReadOnly: false },
        setContextData: vi.fn(),
        getContextData: vi.fn(),
        clearContextData: vi.fn(),
        isReadOnly: vi.fn(async () => false),
        ...overrides
    } as unknown as NoteContext;
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

/** Clears the froca caches between tests (notes/branches/attributes + the attribute cache). */
export function resetFroca() {
    for (const key of Object.keys(froca.notes)) delete froca.notes[key];
    for (const key of Object.keys(froca.attributes)) delete froca.attributes[key];
    for (const key of Object.keys(froca.branches)) delete froca.branches[key];
    for (const key of Object.keys(noteAttributeCache.attributes)) delete noteAttributeCache.attributes[key];
}
