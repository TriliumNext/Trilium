import "./Popover.css";

import { createPopper, Instance, Placement, VirtualElement } from "@popperjs/core";
import clsx from "clsx";
import { ComponentChildren } from "preact";
import { createPortal } from "preact/compat";
import { useCallback, useEffect, useRef } from "preact/hooks";

import { FLOATING_LAYER_SELECTOR, isWithinFloatingLayer } from "./floating_layers";
import { useResizeObserver } from "./hooks";

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
    /**
     * Lets go of the anchor: the panel keeps its place in the body and is left to the stylesheet to
     * put where it likes — a card grown to fill the window (see the `.maximized` rules in
     * Popover.css), rather than one standing beside something.
     *
     * A state of this popover and not a surface of its own, which is the whole of the point: what
     * the card holds — a note's editor, mid-edit — stays mounted across the change, where a dialog
     * raised in its place would tear it down and build it again with whatever was typed still
     * unsaved. Popper is not merely stopped but taken down, its `applyStyles` giving back the
     * inline placement it wrote (see the effect below) so the stylesheet has the field to itself.
     */
    maximized?: boolean;
    children: ComponentChildren;
}

/**
 * A small surface anchored beside something — a dragged-out calendar range, a clicked chip —
 * rather than docked at an edge or centred as a dialog. Portaled to the body, so no scroll
 * container clips it and no containment root flattens its frosting (see the Dropdown notes in
 * CLAUDE.md); positioned by Popper, which also keeps it in place while ancestors scroll.
 */
export default function Popover({ getAnchorRect, placement, updateKey, className, keepOpenSelector, onDismiss, maximized, children }: PopoverProps) {
    const elRef = useRef<HTMLDivElement>(null);
    const arrowRef = useRef<HTMLDivElement>(null);
    const popperRef = useRef<Instance>();

    // Held in a ref so the popper built once keeps asking the newest question — rebuilding it on
    // every render would reset the positioning mid-interaction.
    const getRectRef = useRef(getAnchorRect);
    getRectRef.current = getAnchorRect;

    useEffect(() => {
        const el = elRef.current;
        // A maximized card is placed by the stylesheet rather than beside anything, so it is given
        // no popper at all. Tearing down the one it had is what hands its placement back: Popper's
        // `applyStyles` remembers the inline styles it found and restores them as it is destroyed,
        // which the cleanup below runs on the way into this state.
        if (!el || maximized) return;

        const anchor: VirtualElement = { getBoundingClientRect: () => getRectRef.current() };
        const popper = createPopper(anchor, el, {
            placement: placement ?? "right-start",
            // Fixed, as the element stands in the body rather than beside its anchor.
            strategy: "fixed",
            modifiers: [
                // Room for the arrow to stand in, and a little air past its tip.
                { name: "offset", options: { offset: [ 0, 10 ] } },
                // Held within the viewport on both axes. Popper keeps a popover inside it along the
                // axis it was placed on and no further — a card standing to the left or the right
                // is kept from running off the top and the bottom, and is left wherever the sides
                // put it however far outside the window that is. An anchor with the room for a card
                // on neither side (a calendar chip as wide as the grid, say) has no side to be
                // placed on, so without this the card is put off the screen entirely and only its
                // shadow is ever seen. Placement is still the first say — this is what is left when
                // no placement fits.
                { name: "preventOverflow", options: { padding: 8, altAxis: true } },
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
    }, [ placement, maximized ]);

    useEffect(() => {
        void popperRef.current?.update();
    }, [ updateKey ]);

    // Placed again whenever what is placed changes size: what a popover holds arrives after it does
    // — a note's editor mounting, its promoted attributes filling in — and Popper measures it once.
    useResizeObserver(elRef, useCallback(() => void popperRef.current?.update(), []));

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
        <>
            {/* What dims the page behind a maximized card — its sibling rather than its child, for
                the reason given in Popover.css. Drawn before it, so it stands behind it whatever
                the two are given to stand at. */}
            {maximized && <div className="tn-popover-backdrop" />}

            <div ref={elRef} className={clsx("tn-popover", maximized && "maximized", className)}>
                {/* What the popover is pointing at, drawn by Popper against whichever side it ended
                    up on (see the placements in Popover.css). First in the panel so its static
                    position is the panel's own corner, which is what Popper's offset is reckoned
                    from. */}
                <div ref={arrowRef} className="tn-popover-arrow" />
                {children}
            </div>
        </>,
        document.body
    );
}
