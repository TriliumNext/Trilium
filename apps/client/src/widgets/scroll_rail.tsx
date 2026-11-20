import { useRef } from "preact/hooks";

import type NoteContext from "../components/note_context";
import { useGetContextDataFrom, useNoteContext } from "./react/hooks/note_context";
import { WithLazyModule } from "./react/LazyComponent";
import type { ScrollRailLayer } from "./scroll_rail_markers";

/** The kinds of markers, in drawing order, with the CSS variables of their colors. */
export const SCROLL_RAIL_KINDS = [
    {
        key: "scrollRailHeadings",
        color: "--scroll-rail-heading-color",
        emphasisColor: "--scroll-rail-heading-emphasis-color"
    },
    {
        key: "scrollRailFind",
        color: "--scroll-rail-find-color",
        emphasisColor: "--scroll-rail-find-emphasis-color"
    }
] as const;

export type ScrollRailKind = typeof SCROLL_RAIL_KINDS[number];

/** A layer that a note context publishes, with its kind. */
export interface PublishedLayer {
    kind: ScrollRailKind;
    layer: ScrollRailLayer;
}

const loadBody = () => import("./scroll_rail_body");

/**
 * The scroll rail of a note split: a strip beside the scrollbar with the markers that the split's
 * note context publishes, and the viewport. Its root is the first child of the scroller, and stays
 * empty until a layer is published, which loads the rest.
 */
export default function ScrollRail() {
    const hostRef = useRef<HTMLDivElement>(null);
    const { noteContext } = useNoteContext();
    const layers = usePublishedLayers(noteContext);

    return (
        <div ref={hostRef} className="scroll-rail-host">
            {layers.length > 0 && (
                <WithLazyModule load={loadBody}>
                    {({ default: ScrollRailBody }) => (
                        <ScrollRailBody hostRef={hostRef} layers={layers} />
                    )}
                </WithLazyModule>
            )}
        </div>
    );
}

/** The layers that `noteContext` publishes, in drawing order. */
function usePublishedLayers(noteContext: NoteContext | null | undefined) {
    const layers: PublishedLayer[] = [];
    // The list is constant, so the hooks run in the same order on every render.
    for (const kind of SCROLL_RAIL_KINDS) {
        const layer = useGetContextDataFrom(noteContext, kind.key);
        if (layer) {
            layers.push({ kind, layer });
        }
    }
    return layers;
}
