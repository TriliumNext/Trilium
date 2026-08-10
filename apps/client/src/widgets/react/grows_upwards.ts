import type { RefObject } from "preact";
import { useLayoutEffect, useState } from "preact/hooks";

/**
 * Whether an element standing over its parent should be anchored by its foot rather than its head —
 * that is, whether it should grow upwards.
 *
 * Such an element is as tall as what it holds while the thing it stands on is a fixed height, so it
 * can outgrow the room beneath and be cut off by the pane it scrolls in — as a cell editor does on
 * the last row of a table. Where that happens and there is room the other way, it is better turned
 * round: what it gains then rises over what has been read already rather than pressing past the foot
 * of the pane. Where it fits neither way it is left alone, its head being the part worth showing.
 *
 * The caller does the anchoring, this being a question of layout rather than of markup: with the
 * answer it swaps which edge the element is pinned by.
 *
 * Measured afresh whenever the element changes size or anything scrolls, and read from the document
 * each time rather than held — an element may be built and handed to its host before being put in
 * the document at all, which is how Tabulator hands out its editors.
 */
export function useGrowsUpwards(ref: RefObject<HTMLElement>) {
    const [ growsUpwards, setGrowsUpwards ] = useState(false);

    useLayoutEffect(() => {
        const element = ref.current;
        if (!element) return;

        const measure = () => {
            const anchor = element.parentElement;
            const pane = clippingAncestor(element);
            if (!anchor || !pane) return;

            const anchorRect = anchor.getBoundingClientRect();
            const paneRect = pane.getBoundingClientRect();
            const height = element.offsetHeight;
            setGrowsUpwards(
                anchorRect.top + height > paneRect.bottom && anchorRect.bottom - height >= paneRect.top
            );
        };

        measure();
        // Which way it goes does not change its height, so measuring cannot chase its own answer.
        const resizes = new ResizeObserver(measure);
        resizes.observe(element);
        // Captured, since what scrolls is a pane within the page rather than the page itself.
        window.addEventListener("scroll", measure, true);
        return () => {
            resizes.disconnect();
            window.removeEventListener("scroll", measure, true);
        };
    }, [ ref ]);

    return growsUpwards;
}

/** The ways of saying that what does not fit is cut off rather than left to spill out. */
const CLIPPING_OVERFLOWS = new Set([ "auto", "scroll", "hidden", "clip", "overlay" ]);

/** The nearest ancestor that cuts off what overflows it, whose edges an overlay has to stay within. */
function clippingAncestor(element: HTMLElement) {
    for (let node = element.parentElement; node; node = node.parentElement) {
        if (CLIPPING_OVERFLOWS.has(getComputedStyle(node).overflowY)) {
            return node;
        }
    }
    return null;
}
