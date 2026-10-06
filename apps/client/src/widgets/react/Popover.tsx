import "./Popover.css";

import { autoUpdate, type Placement, type VirtualElement } from "@floating-ui/dom";
import clsx from "clsx";
import { ComponentChildren, createPortal } from "preact";
import { useEffect, useRef } from "preact/hooks";

import { FLOATING_LAYER_SELECTOR, isWithinFloatingLayer } from "./floating_layers";
import { placeFloating } from "./Popup";

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
     * Places the popover again when it changes. `autoUpdate()` handles scrolling and resizing;
     * this covers an anchor that moves for another reason, such as the popover switching to a
     * different event.
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
     * unsaved. While maximized, the popover stops placing itself and removes its inline position
     * and `data-placement` (see the effect below), so only the stylesheet positions it.
     */
    maximized?: boolean;
    /**
     * Called once the card is first placed and shown. A field inside the card can only take the focus
     * from then on, since the card stays `visibility: hidden` until `placeFloating()` resolves.
     */
    onPlaced?(): void;
    children: ComponentChildren;
}

/**
 * A small surface anchored beside something — a dragged-out calendar range, a clicked chip —
 * rather than docked at an edge or centred as a dialog. Portaled to the body, so no scroll
 * container clips it and no containment root flattens its frosting (see the Dropdown notes in
 * CLAUDE.md). `placeFloating()` positions it, and `autoUpdate()` places it again as ancestors
 * scroll.
 */
export default function Popover({ getAnchorRect, placement, updateKey, className, keepOpenSelector, onDismiss, maximized, onPlaced, children }: PopoverProps) {
    const elRef = useRef<HTMLDivElement>(null);
    const arrowRef = useRef<HTMLDivElement>(null);
    const updateRef = useRef<(() => void) | undefined>(undefined);

    // In a ref, so the placement set up once reads the latest `getAnchorRect`. Setting it up again
    // on every render would reset the position mid-interaction.
    const getRectRef = useRef(getAnchorRect);
    getRectRef.current = getAnchorRect;
    const onPlacedRef = useRef(onPlaced);
    onPlacedRef.current = onPlaced;
    const hasBeenPlaced = useRef(false);

    useEffect(() => {
        const el = elRef.current;
        // The stylesheet positions a maximized card. The cleanup below removes the inline position
        // and `data-placement` as the card is maximized.
        if (!el || maximized) return;

        const anchor: VirtualElement = { getBoundingClientRect: () => getRectRef.current() };
        const options = {
            placement: placement ?? "right-start",
            // The arrow's depth, plus a small gap past its tip.
            offset: 10,
            // Keeps the card in the viewport on both axes. With no room on either side of the
            // anchor, as for a calendar chip as wide as the grid, the card is shifted over the
            // anchor instead of off the screen.
            shiftAcross: true,
            // Keeps the arrow off the card's rounded corners. Near a corner of the anchor, the arrow
            // stops at the padding instead of pointing at it squarely.
            arrow: arrowRef.current ? { element: arrowRef.current, padding: 10 } : undefined
        };
        let released = false;
        const release = () => {
            el.style.removeProperty("left");
            el.style.removeProperty("top");
            el.style.removeProperty("visibility");
            delete el.dataset.placement;
        };
        // `placeFloating()` resolves later, by which time the card can have been maximized.
        const update = () => void placeFloating(el, anchor, options).then((placed) => {
            if (released) {
                release();
                return;
            }

            el.dataset.placement = placed;
            if (!hasBeenPlaced.current) {
                hasBeenPlaced.current = true;
                onPlacedRef.current?.();
            }
        });
        updateRef.current = update;
        // Places the card again when an ancestor scrolls, the viewport resizes, or the card's
        // size changes, as it does when a note's editor or its promoted attributes load.
        const stopUpdating = autoUpdate(anchor, el, update);

        return () => {
            released = true;
            updateRef.current = undefined;
            stopUpdating();
            release();
        };
    }, [ placement, maximized ]);

    useEffect(() => {
        updateRef.current?.();
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
        <>
            {/* What dims the page behind a maximized card — its sibling rather than its child, for
                the reason given in Popover.css. Drawn before it, so it stands behind it whatever
                the two are given to stand at. */}
            {maximized && <div className="tn-popover-backdrop" />}

            <div ref={elRef} className={clsx("tn-popover", maximized && "maximized", className)}>
                {/* Points at the anchor from the side the card is on (see the placements in
                    Popover.css). First in the card, so its static position is the card's corner,
                    which `placeFloating()` measures the arrow's offset from. */}
                <div ref={arrowRef} className="tn-popover-arrow" />
                {children}
            </div>
        </>,
        document.body
    );
}
