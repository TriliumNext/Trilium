import type { ComponentChildren } from "preact";

import { CardNesting } from "../../../react/Card";

export interface OptionsGroupProps {
    /**
     * Whether the sub-options are shown. Mirror the governing option's existing behaviour rather
     * than changing it: reveal on enable where the rows already appear and disappear, or pass a
     * constant `true` and keep the rows `disabled` where they are currently visible-but-disabled.
     */
    visible?: boolean | null;
    children: ComponentChildren;
}

/**
 * Groups a run of sub-options under the option row preceding it: the rows stay segments of the same
 * card, but indent and tint to show they are governed by that row rather than merely following it.
 *
 * It renders no box of its own — only the nesting — so the rows within it keep their own seams
 * instead of being boxed together, and it works wherever it is placed.
 */
export default function OptionsGroup({ visible, children }: OptionsGroupProps) {
    if (!visible) {
        return null;
    }

    return <CardNesting>{children}</CardNesting>;
}
