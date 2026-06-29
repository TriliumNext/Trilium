import "./LazyComponent.css";

import { ComponentType } from "preact";
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
