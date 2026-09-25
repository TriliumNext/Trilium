import "./hover_name.css";

import {
    type Map as MapLibreGLMap, type MapGeoJSONFeature, type MapMouseEvent, Popup
} from "maplibre-gl";
import { useEffect, useRef } from "preact/hooks";

/** How long the pointer rests on something before its name appears. Shorter than the wait in
 *  Tooltips, which fetches the note, but long enough not to name what the pointer sweeps past. */
const REST_DELAY = 200;

/** Distance in pixels between the popup and the point it is anchored to. */
const NAME_OFFSET = 10;

/** A name to show, which also sets the cursor to `pointer`. */
export interface HoverName {
    /** Distinguishes one feature from the next, so moving between them replaces the name. */
    id: string;
    /** Where the popup is anchored. */
    lngLat: [number, number];
    /** Boxicons classes for the icon beside the name, where the feature has one. */
    icon?: string | null;
    text: string;
}

/**
 * What the pointer is over: a name to show, nothing, or `"deferred"` for a feature another layer
 * owns. `"deferred"` differs from nothing in that it leaves the cursor alone, the layer that owns
 * the feature having just set it.
 */
export type HoverAnswer = HoverName | null | "deferred";

interface HoverNameOptions {
    /** The layers to watch, read again whenever the style changes. */
    layers: (map: MapLibreGLMap) => string[];
    /** What the pointer is over, given the features those layers report under it. */
    answer: (e: MapMouseEvent & { features?: MapGeoJSONFeature[] }) => HoverAnswer;
    /** Binds nothing, for a map where the pointer means something else. */
    disabled?: boolean;
}

/**
 * Shows the name of the feature under the pointer in a small popup, once the pointer has rested.
 *
 * Shared by Pois and ShapeLayer, which supply only the layers to watch and the name to show. Both
 * name a feature from data already loaded, unlike Tooltips, which fetches the note.
 *
 * A click hides the name, and it does not return until the pointer leaves the feature and comes
 * back, so it never covers what the click opened.
 */
export function useHoverName(
    parentMap: MapLibreGLMap | null, { layers, answer, disabled }: HoverNameOptions) {
    // Read through a ref so inline callbacks do not rebind the handlers on every render.
    const latest = useRef({ layers, answer });
    latest.current = { layers, answer };

    useEffect(() => {
        if (!parentMap || disabled) return;
        // Aliased so the narrowing above carries into the functions below.
        const map = parentMap;

        const popup = new Popup({
            closeButton: false,
            closeOnClick: false,
            // MapLibre otherwise focuses the popup as it opens, taking focus out of the search box.
            focusAfterOpen: false,
            offset: NAME_OFFSET,
            className: "geo-hover-name"
        });

        let bound: string[] = [];
        /** The feature the name belongs to, or the one last clicked until the pointer leaves it. */
        let named: string | null = null;
        let showTimer: ReturnType<typeof setTimeout> | undefined;

        const setCursor = (cursor: string) => { map.getCanvas().style.cursor = cursor; };

        function hide() {
            clearTimeout(showTimer);
            popup.remove();
        }

        function onMouseMove(e: MapMouseEvent & { features?: MapGeoJSONFeature[] }) {
            const answered = latest.current.answer(e);

            if (answered === "deferred") {
                named = null;
                hide();
                return;
            }

            if (!answered) {
                named = null;
                setCursor("");
                hide();
                return;
            }

            setCursor("pointer");
            // Tracked on "mousemove" rather than "mouseenter", which fires on entering the layer:
            // moving from one feature to the next never leaves it, so the first name would stay up.
            if (answered.id === named) return;

            named = answered.id;
            hide();
            showTimer = setTimeout(() => {
                popup.setLngLat(answered.lngLat).setDOMContent(nameLabel(answered)).addTo(map);
            }, REST_DELAY);
        }

        function onMouseLeave() {
            named = null;
            setCursor("");
            hide();
        }

        function unbind() {
            if (bound.length) {
                map.off("mousemove", bound, onMouseMove);
                map.off("mouseleave", bound, onMouseLeave);
            }
            bound = [];
        }

        function bind() {
            const wanted = latest.current.layers(map);
            if (wanted.length === bound.length && wanted.every((id, i) => id === bound[i])) return;

            unbind();
            bound = wanted;
            if (bound.length) {
                map.on("mousemove", bound, onMouseMove);
                map.on("mouseleave", bound, onMouseLeave);
            }
        }

        bind();
        // "style.load" covers a style switch, which replaces every layer; "styledata" covers a
        // layer added or removed within one, such as a shape being drawn. bind() returns early when
        // the list is unchanged, so the frequent "styledata" costs only a comparison.
        map.on("style.load", bind);
        map.on("styledata", bind);
        // hide() leaves `named` set, so the name does not reappear over what the click opened
        // until the pointer moves to another feature.
        map.on("click", hide);

        return () => {
            map.off("style.load", bind);
            map.off("styledata", bind);
            map.off("click", hide);
            unbind();
            hide();
            // Reset by hand: this can be torn down while the pointer rests on a feature, and the
            // "mouseleave" that would have cleared the cursor is no longer bound.
            setCursor("");
        };
    }, [ parentMap, disabled ]);
}

/** The popup contents: the feature's icon, where it has one, and its name. */
function nameLabel({ icon, text }: HoverName) {
    const label = document.createElement("span");
    label.className = "geo-hover-name-label";

    if (icon) {
        const mark = document.createElement("i");
        mark.className = icon;
        label.appendChild(mark);
    }

    const name = document.createElement("span");
    // A place's name comes from OpenStreetMap and a shape's from its note title, neither of which
    // is markup.
    name.textContent = text;
    label.appendChild(name);

    return label;
}
