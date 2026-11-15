import { useSyncExternalStore } from "preact/compat";
import { useEffect } from "preact/hooks";

import type { WidgetsByParent } from "../../../services/bundle";

/**
 * The widgets of the `#widget` notes, which the layout loads after its first paint. The note splits
 * are legacy widgets, which take no Preact context, so the slots in them read the widgets from here.
 */
let customWidgets: WidgetsByParent | undefined;
const customWidgetsListeners = new Set<() => void>();

/** The widgets of the `#widget` notes, `undefined` until {@link useLoadCustomWidgets} has loaded them. */
export function useCustomWidgets() {
    return useSyncExternalStore((listener) => {
        customWidgetsListeners.add(listener);
        return () => customWidgetsListeners.delete(listener);
    }, () => customWidgets);
}

/** Loads the widgets of the `#widget` notes once the layout calling it has mounted. */
export function useLoadCustomWidgets() {
    useEffect(() => {
        void import("../../../services/bundle")
            .then(({ default: bundleService }) => bundleService.getWidgetBundlesByParent())
            .then(setCustomWidgets);
    }, []);
}

export function setCustomWidgets(widgets: WidgetsByParent | undefined) {
    customWidgets = widgets;
    for (const listener of customWidgetsListeners) {
        listener();
    }
}

/**
 * Places the custom widgets of a slot among its `builtInCount` built-in children as
 * `BasicWidget.child()` orders the children of a container: the n-th built-in child at position
 * 10n, and a widget without a position after the built-in children, in the order given. A widget
 * goes after every child of a lower or equal position. Returns the widgets of each gap, from the
 * one before the first built-in child to the one after the last.
 */
export function placeCustomWidgets<T>(widgets: { widget: T, position?: number }[], builtInCount: number) {
    let nextPosition = (builtInCount + 1) * 10;
    const positioned = widgets.map(({ widget, position }) => {
        if (position !== undefined) return { widget, position };
        const assigned = nextPosition;
        nextPosition += 10;
        return { widget, position: assigned };
    });
    positioned.sort((a, b) => a.position - b.position);

    const gaps: T[][] = Array.from({ length: builtInCount + 1 }, () => []);
    for (const { widget, position } of positioned) {
        gaps[Math.min(builtInCount, Math.max(0, Math.floor(position / 10)))].push(widget);
    }
    return gaps;
}
