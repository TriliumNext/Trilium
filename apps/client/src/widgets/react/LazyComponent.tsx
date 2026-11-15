import "./LazyComponent.css";

import { ComponentChildren, ComponentType } from "preact";
import { useEffect, useState } from "preact/hooks";

interface LazyComponentProps {
    /** Loader returning the module whose default export is the component to render, e.g. `() => import("./MyComponent.jsx")`. */
    loader: () => Promise<{ default: ComponentType }>;
}

/**
 * Renders a component that is loaded on demand via a dynamic import, keeping its module
 * graph out of the initial bundle. The loader runs on first mount.
 *
 * The component is rendered inside a stable `display: contents` wrapper: the legacy widget
 * adapter extracts the rendered root node out of Preact's render container, so the root
 * element must never change identity across re-renders — swapping it (or rendering nothing)
 * would make subsequent renders go to the discarded container instead of the live DOM.
 */
export default function LazyComponent({ loader }: LazyComponentProps) {
    const [ Component, setComponent ] = useState<ComponentType | null>(null);

    useEffect(() => {
        let cancelled = false;
        void loader().then(({ default: component }) => {
            if (!cancelled) {
                setComponent(() => component);
            }
        });
        return () => {
            cancelled = true;
        };
        // Loads once on mount; the loader is typically an inline arrow that changes identity each
        // render, so depending on it would re-run the import on every render.
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, []);

    return (
        <div className="lazy-component">
            {Component && <Component />}
        </div>
    );
}

/** The modules {@link useLazyModule} has loaded, by their loader. */
const loadedModules = new Map<() => Promise<unknown>, unknown>();

/**
 * Starts loading the module of `load`, so that {@link useLazyModule} returns it from the first
 * render once it has loaded, as for a menu about to open.
 */
export function preloadLazyModule<T>(load: () => Promise<T>) {
    if (loadedModules.has(load)) return;
    void load().then((loaded) => loadedModules.set(load, loaded));
}

/**
 * Returns the module `load` imports, once the component that calls it has mounted, and `undefined`
 * until then. A module loaded before is returned from the first render. `load` must keep its
 * identity across renders, so it is declared at module level.
 */
export function useLazyModule<T>(load: () => Promise<T>) {
    const [ module, setModule ] = useState(() => loadedModules.get(load) as T | undefined);
    useEffect(() => {
        if (module) return;
        let cancelled = false;
        void load().then((loaded) => {
            loadedModules.set(load, loaded);
            if (!cancelled) setModule(() => loaded);
        });
        return () => {
            cancelled = true;
        };
    }, [ load, module ]);
    return module;
}

/**
 * Renders `children` with the module `load` imports, once it has loaded, and nothing until then.
 * `load` keeps its identity across renders, as for {@link useLazyModule}.
 */
export function WithLazyModule<T>({ load, children }: {
    load: () => Promise<T>;
    children: (module: T) => ComponentChildren;
}) {
    const module = useLazyModule(load);
    return module ? <>{children(module)}</> : null;
}
