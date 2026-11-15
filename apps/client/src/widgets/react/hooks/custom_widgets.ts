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
