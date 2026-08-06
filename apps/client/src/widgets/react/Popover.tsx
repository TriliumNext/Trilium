import "./Popover.css";

import { createPopper, Instance, Placement, VirtualElement } from "@popperjs/core";
import clsx from "clsx";
import { ComponentChildren } from "preact";
import { createPortal } from "preact/compat";
import { useEffect, useRef } from "preact/hooks";

import { FLOATING_LAYER_SELECTOR, isWithinFloatingLayer } from "./floating_layers";

export interface PopoverProps {
    /**
     * Where the popover points: a rectangle in viewport coordinates, asked for afresh on every
     * reposition. A function rather than a rect or an element, so an anchor that is redrawn by
     * whatever it stands on — a canvas re-rendering its selection, say — is followed rather than
     * remembered.
     */
    getAnchorRect(): DOMRect;
    /** Which side of the anchor to stand on, flipped away from the viewport's edges as needed. */
    placement?: Placement;
    /**
     * Repositions when it changes. Popper watches scrolling and resizing on its own, but cannot
     * know the anchor moved for a reason of the caller's — the popover switching to stand for
     * something else, say — which is what this says.
     */
    updateKey?: unknown;
    className?: string;
    /**
     * Presses matching this keep the popover open, over and above the app's own floating layers
     * (see {@link FLOATING_LAYER_SELECTOR}) — for what the popover stands beside and answers to
     * rather than closes for: the calendar's chips, each of which re-points the standing popover
     * at its own event.
     */
    keepOpenSelector?: string;
    /** Called on a press outside the popover; the owner decides what being dismissed means. The
     *  press itself still lands where it fell — dismissal must not swallow it, or pressing the
     *  thing the popover stands beside would take two tries. */
    onDismiss?(): void;
    children: ComponentChildren;
}

/**
 * A small surface anchored beside something — a dragged-out calendar range, a clicked chip —
 * rather than docked at an edge or centred as a dialog. Portaled to the body, so no scroll
 * container clips it and no containment root flattens its frosting (see the Dropdown notes in
 * CLAUDE.md); positioned by Popper, which also keeps it in place while ancestors scroll.
 */
export default function Popover({ getAnchorRect, placement, updateKey, className, keepOpenSelector, onDismiss, children }: PopoverProps) {
    const elRef = useRef<HTMLDivElement>(null);
    const arrowRef = useRef<HTMLDivElement>(null);
    const popperRef = useRef<Instance>();

    // Held in a ref so the popper built once keeps asking the newest question — rebuilding it on
    // every render would reset the positioning mid-interaction.
    const getRectRef = useRef(getAnchorRect);
    getRectRef.current = getAnchorRect;

    useEffect(() => {
        const el = elRef.current;
        if (!el) return;

        const anchor: VirtualElement = { getBoundingClientRect: () => getRectRef.current() };
        const popper = createPopper(anchor, el, {
            placement: placement ?? "right-start",
            // Fixed, as the element stands in the body rather than beside its anchor.
            strategy: "fixed",
            modifiers: [
                // Room for the arrow to stand in, and a little air past its tip.
                { name: "offset", options: { offset: [ 0, 10 ] } },
                { name: "preventOverflow", options: { padding: 8 } },
                // Kept clear of the panel's rounded corners, where an arrow would grow out of thin
                // air; an anchor so near a corner that it cannot be pointed at squarely gets the
                // arrow as close as the padding allows.
                { name: "arrow", options: { element: arrowRef.current, padding: 10 } }
            ]
        });
        popperRef.current = popper;

        return () => {
            popperRef.current = undefined;
            popper.destroy();
        };
    }, [ placement ]);

    useEffect(() => {
        void popperRef.current?.update();
    }, [ updateKey ]);

    useEffect(() => {
        if (!onDismiss) return;

        const onPointerDown = (e: PointerEvent) => {
            const el = elRef.current;
            if (!el || !(e.target instanceof Node) || el.contains(e.target)) return;

            // A layer standing over the popover is not a place away from it: a dropdown the
            // popover opened lives in the body rather than within it, and dismissing on the press
            // would take the menu down before the click that chose anything could arrive (see
            // floating_layers.ts). Nor is what the popover answers to (see keepOpenSelector).
            if (isWithinFloatingLayer(e.target)) return;
            if (keepOpenSelector && e.target instanceof Element && e.target.closest(keepOpenSelector)) return;

            onDismiss();
        };
        // Captured, so the popover hears of the press wherever it lands — including places that
        // stop propagation for reasons of their own.
        document.addEventListener("pointerdown", onPointerDown, true);
        return () => document.removeEventListener("pointerdown", onPointerDown, true);
    }, [ onDismiss, keepOpenSelector ]);

    return createPortal(
        <div ref={elRef} className={clsx("tn-popover", className)}>
            {/* What the popover is pointing at, drawn by Popper against whichever side it ended up
                on (see the placements in Popover.css). First in the panel so its static position is
                the panel's own corner, which is what Popper's offset is reckoned from. */}
            <div ref={arrowRef} className="tn-popover-arrow" />
            {children}
        </div>,
        document.body
    );
}
