import "./Popup.css";

import { arrow, autoUpdate, computePosition, flip, hide, offset, type OffsetOptions, type Placement, type ReferenceElement, shift, size } from "@floating-ui/dom";
import clsx from "clsx";
import {
    type ComponentChildren, createContext, createPortal, type HTMLAttributes, type Ref
} from "preact";
import { useCallback, useContext, useLayoutEffect, useMemo, useRef } from "preact/hooks";

/**
 * A surface that stands beside something rather than in the page's flow: a dropdown's menu, and
 * anything else that pops up from a control or at a point. It knows nothing of what it holds; it
 * places itself, keeps inside the viewport, and says when it is dismissed.
 */
export interface PopupProps extends Pick<HTMLAttributes<HTMLDivElement>, "id" | "className" | "role" | "style" | "tabIndex"
        | "onClick" | "onPointerMove" | "onContextMenu" | "aria-labelledby"> {
    /**
     * What it stands beside: an element, a point in the viewport such as where a right-click landed,
     * or a rect that is no element, such as a text editor's caret.
     */
    anchor: HTMLElement | { x: number, y: number } | ReferenceElement;
    /**
     * The side of the anchor it prefers, flipped to the other side where that one has no room.
     * Below the anchor, lined up with its start, by default.
     */
    placement?: Placement;
    /** The gap, in pixels, it keeps from its anchor. */
    offset?: number;
    /**
     * Caps its height to the room on the side it takes, for content that scrolls in it. Without,
     * it grows past the viewport, as content that must not be clipped needs.
     */
    capHeight?: boolean;
    /**
     * Classes for an element it stands in, in the page's body, so the CSS scoped under the
     * classes of what opened it still applies there.
     */
    portalClassName?: string;
    /**
     * Leaves it where the stylesheet puts it rather than beside its anchor, as a sheet along the
     * bottom of a phone's screen is.
     */
    placedByStylesheet?: boolean;
    /** Classes for an element drawn just before it, which dims the page under it. */
    backdropClassName?: string;
    elementRef?: Ref<HTMLDivElement>;
    /**
     * Where it renders, for a caller that has placed that itself. By default the element showing
     * the screen fullscreen, or else the page's body.
     */
    container?: HTMLElement;
    /** Called once it is first placed and shown: a browser focuses nothing inside it before. */
    onPlaced?(): void;
    /**
     * Called on a press outside it and its anchor, and on Escape. A press on the anchor is left to
     * the anchor, as a dropdown's toggle closes its own popup. A popup opened inside it counts as
     * inside it, and takes Escape while it is open. Without it, nothing dismisses it.
     */
    onDismiss?(reason: "outside" | "escape"): void;
    /** Whether Escape dismisses it, as it does unless its content answers Escape itself, as a menu does. */
    escapeDismisses?: boolean;
    /**
     * A press in an element this selector matches does not dismiss it, for a surface it summons that
     * renders elsewhere in the page, as the shortcut-hints pane does. Named as on `Popover`.
     */
    keepOpenSelector?: string;
    children?: ComponentChildren;
}

/** How many pixels it keeps from the edges of the viewport. */
const VIEWPORT_PADDING = 5;

export default function Popup({ anchor, placement = "bottom-start", offset: gap = 0, capHeight = true, portalClassName, placedByStylesheet, backdropClassName, elementRef, container, onPlaced, onDismiss, escapeDismisses = true, keepOpenSelector, className, children, ...elementProps }: PopupProps) {
    const popupRef = useRef<HTMLDivElement | null>(null);
    // Stable, so the element is handed on once rather than taken back and given again each render.
    const setElement = useCallback((element: HTMLDivElement | null) => {
        popupRef.current = element;
        if (typeof elementRef === "function") elementRef(element);
        else if (elementRef) elementRef.current = element;
    }, [ elementRef ]);
    const placed = useRef(onPlaced);
    placed.current = onPlaced;
    /** Whether it has said it is placed, which it says once, however often it is placed again. */
    const hasPlaced = useRef(false);
    const reportPlaced = () => {
        if (hasPlaced.current) return;
        hasPlaced.current = true;
        placed.current?.();
    };
    // A popup opened inside this one stands in the page's body too, so it registers here to
    // count as inside this one.
    const layers = useRef(new Set<Layer>());
    const layer = useMemo<Layer>(() => ({
        contains: (target) => !!popupRef.current?.contains(target)
            || [ ...layers.current ].some((nested) => nested.contains(target))
    }), []);
    const layerRegistry = useMemo<LayerRegistry>(() => ({
        register(nested) {
            layers.current.add(nested);
            return () => layers.current.delete(nested);
        }
    }), []);
    const parentRegistry = useContext(PopupLayerContext);
    useLayoutEffect(() => parentRegistry?.register(layer), [ parentRegistry ]);

    const anchorX = "x" in anchor ? anchor.x : undefined;
    const anchorY = "y" in anchor ? anchor.y : undefined;

    const stylesheetPlaces = useRef(placedByStylesheet);
    stylesheetPlaces.current = placedByStylesheet;
    useLayoutEffect(() => {
        const popup = popupRef.current;
        if (!popup) return;
        if (placedByStylesheet) {
            clearPlacement(popup);
            popup.style.visibility = "visible";
            reportPlaced();
            return;
        }
        const reference = "x" in anchor ? pointAt(anchor.x, anchor.y) : anchor;
        // A placement settles after the fact, by which time it can have closed.
        let closed = false;
        // Places it now, and again whenever its anchor moves or the viewport or it changes size.
        // Only a menu at a point moves over it. A rect, such as a caret, marks text the popup must not
        // cover, so the popup keeps to one side and its height is capped to the room there.
        const options = { placement, offset: gap, capHeight, shiftAcross: "x" in anchor };
        const stopUpdating = autoUpdate(reference, popup, () => void placeFloating(popup, reference, options).then(() => {
            if (!closed) reportPlaced();
            // Resolved after the stylesheet took over, so what it wrote goes again.
            else if (stylesheetPlaces.current) clearPlacement(popup);
        }));
        return () => {
            closed = true;
            stopUpdating();
        };
    }, [ "x" in anchor ? undefined : anchor, anchorX, anchorY, placement, gap, capHeight, placedByStylesheet ]);

    const dismiss = useRef(onDismiss);
    dismiss.current = onDismiss;
    const escapes = useRef(escapeDismisses);
    escapes.current = escapeDismisses;
    const keepOpen = useRef(keepOpenSelector);
    keepOpen.current = keepOpenSelector;
    useLayoutEffect(() => {
        if (!dismiss.current) return;
        // Captured at the window, so a host that stops its own presses, as the note tree does,
        // cannot keep them from here, and so Escape arrives before Bootstrap's handler for keys in
        // a `.dropdown-menu`, which looks for a toggle beside the popup and crashes without one.
        const onPointerDown = (e: PointerEvent) => {
            const target = e.target as Node;
            if (layer.contains(target)) return;
            if (anchor instanceof HTMLElement && anchor.contains(target)) return;
            if (keepOpen.current && target instanceof Element && target.closest(keepOpen.current)) return;
            dismiss.current?.("outside");
            swallowStrayClick(target);
        };
        const onKeyDown = (e: KeyboardEvent) => {
            // A popup open inside this one takes Escape first.
            if (e.key !== "Escape" || !escapes.current || layers.current.size) return;
            // A dialog under it stays open.
            e.stopPropagation();
            dismiss.current?.("escape");
        };
        window.addEventListener("pointerdown", onPointerDown, true);
        window.addEventListener("keydown", onKeyDown, true);
        return () => {
            window.removeEventListener("pointerdown", onPointerDown, true);
            window.removeEventListener("keydown", onKeyDown, true);
        };
    }, [ anchor ]);

    // Out of any ancestor that would clip it or, with a transform or a filter, place its fixed
    // position against itself. A browser showing an element fullscreen paints only that element.
    const popup = (
        <div
            {...elementProps}
            ref={setElement}
            className={clsx("tn-popup", className)}
        >
            <PopupLayerContext.Provider value={layerRegistry}>
                {children}
            </PopupLayerContext.Provider>
        </div>
    );
    const drawn = <>
        {backdropClassName && <div className={backdropClassName} />}
        {popup}
    </>;
    return createPortal(portalClassName ? <div className={portalClassName}>{drawn}</div> : drawn,
        container ?? document.fullscreenElement ?? document.body);
}

/**
 * Drops the click that follows a press dismissing a popup when it lands on something other than
 * `pressed`. A cover or backdrop is removed with the popup before a tap's click, so the click lands
 * on the element under it, such as an icon under the icon picker's menu.
 */
function swallowStrayClick(pressed: Node) {
    const onClick = (e: MouseEvent) => {
        stop();
        if (e.target instanceof Node && pressed.contains(e.target)) return;
        e.preventDefault();
        e.stopPropagation();
    };
    // The next press removes the listener, so a press without a click, such as a scroll, cannot
    // drop a later click.
    const stop = () => {
        window.removeEventListener("click", onClick, true);
        window.removeEventListener("pointerdown", stop, true);
    };
    window.addEventListener("click", onClick, true);
    window.addEventListener("pointerdown", stop, true);
}

/** Removes what `placeFloating()` wrote on `popup`, so the stylesheet places it. */
function clearPlacement(popup: HTMLElement) {
    popup.style.removeProperty("left");
    popup.style.removeProperty("top");
    popup.style.removeProperty("max-height");
}

/** A popup, as the one it opened inside knows it. */
interface Layer {
    /** Whether `target` is in the popup or in a popup opened inside it. */
    contains(target: Node): boolean;
}

/** Where a popup registers the popups opened inside it. */
interface LayerRegistry {
    /** Registers `layer` until the returned function is called. */
    register(layer: Layer): () => void;
}

const PopupLayerContext = createContext<LayerRegistry | null>(null);

/** How it is placed beside its anchor. See {@link placeFloating}. */
export interface FloatingPlacement {
    /** The side of the anchor it prefers, and its alignment along that side. */
    placement: Placement;
    /** Its gap from the anchor, or how far it overlaps it, as Floating UI's `offset()` takes it. */
    offset?: OffsetOptions;
    /**
     * Lets it also move across the side it stands on, over its anchor, as a menu wider than the
     * room on either side of a point must. A popup under a toggle leaves this off, so it never
     * covers the toggle.
     */
    shiftAcross?: boolean;
    /** Caps its height to the room on the side it takes, for content that scrolls in it. */
    capHeight?: boolean;
    /** Hides it while its anchor is scrolled out of view, as a submenu whose row scrolled away. */
    hideWithAnchor?: boolean;
    /**
     * Keeps its top at this viewport y instead of where its height would place it, for a popup
     * whose content changes while it is read. With {@link capHeight}, the cap is the room below it.
     */
    pinTop?: number;
    /**
     * An arrow element inside it. Its offset along the edge facing the anchor is set to point at
     * the anchor, at least `padding` pixels from the corners.
     */
    arrow?: { element: HTMLElement, padding?: number };
}

/**
 * Positions `element` beside `anchor`, preferring its placement, then the side opposite, then the
 * other alignment on either side, the way a native menu opens above or to the left of a pointer
 * near the viewport's edge. It stays hidden until placed, so it never paints at a stale position.
 * Resolves to the placement Floating UI chose.
 */
export async function placeFloating(element: HTMLElement, anchor: ReferenceElement, { placement, offset: gap, shiftAcross, capHeight, hideWithAnchor, pinTop, arrow: pointer }: FloatingPlacement) {
    const padding = viewportPadding();
    const { x, y, placement: placed, middlewareData } = await computePosition(anchor, element, {
        strategy: "fixed",
        placement,
        middleware: [
            gap !== undefined && offset(gap),
            flip({ fallbackPlacements: mirroredPlacements(placement), padding }),
            shift({ crossAxis: !!shiftAcross, padding }),
            pointer && arrow({ element: pointer.element, padding: pointer.padding }),
            capHeight && size({
                padding,
                apply({ availableHeight }) {
                    element.style.maxHeight = `${availableHeight}px`;
                }
            }),
            hideWithAnchor && hide({ strategy: "referenceHidden" })
        ]
    });

    element.style.left = `${x}px`;
    element.style.top = `${pinTop ?? y}px`;
    if (capHeight && pinTop !== undefined) {
        element.style.maxHeight = `${document.documentElement.clientHeight - pinTop - padding.bottom}px`;
    }
    element.style.visibility = middlewareData.hide?.referenceHidden ? "hidden" : "visible";
    if (pointer) {
        // Only the offset along the facing edge; the stylesheet sets the other axis.
        const { x: arrowX, y: arrowY } = middlewareData.arrow ?? {};
        pointer.element.style.left = arrowX !== undefined ? `${arrowX}px` : "";
        pointer.element.style.top = arrowY !== undefined ? `${arrowY}px` : "";
    }
    return placed;
}

/**
 * How far a popup keeps from each edge of the viewport: `VIEWPORT_PADDING` past the safe-area
 * inset there, such as a notch or a gesture bar.
 */
function viewportPadding() {
    // An element whose padding is the insets (see Popup.css), as script cannot read `env()`. It
    // is in the page only while it is measured.
    const probe = document.createElement("div");
    probe.className = "tn-safe-area-probe";
    document.body.append(probe);
    const style = getComputedStyle(probe);
    const past = (inset: string) => VIEWPORT_PADDING + (parseFloat(inset) || 0);
    const padding = {
        top: past(style.paddingTop),
        right: past(style.paddingRight),
        bottom: past(style.paddingBottom),
        left: past(style.paddingLeft)
    };
    probe.remove();
    return padding;
}

const OPPOSITE_SIDES = { top: "bottom", bottom: "top", left: "right", right: "left" } as const;

/** The placements to fall back on from `placement`: the opposite side, then the other alignment on each. */
function mirroredPlacements(placement: Placement): Placement[] {
    const [ side, alignment ] = placement.split("-") as [ keyof typeof OPPOSITE_SIDES, "start" | "end" | undefined ];
    const opposite = OPPOSITE_SIDES[side];
    if (!alignment) return [ opposite ];
    const other = alignment === "start" ? "end" : "start";
    return [ `${opposite}-${alignment}`, `${side}-${other}`, `${opposite}-${other}` ];
}

/** A zero-size anchor at a point in the viewport. */
export function pointAt(x: number, y: number): ReferenceElement {
    return {
        getBoundingClientRect: () => DOMRect.fromRect({ x, y, width: 0, height: 0 })
    };
}
