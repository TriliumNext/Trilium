import "./CollapseOnOverflow.css";

import clsx from "clsx";
import { ComponentChildren, RefObject } from "preact";
import { useLayoutEffect, useRef, useState } from "preact/hooks";

interface CollapseOnOverflowProps {
    /**
     * The element the control is weighed against — the pane or the bar it sits in, whose width is
     * decided by something other than which of the two renderings is currently up.
     *
     * It cannot be the control's own box: the folded rendering fits wherever it is put, so a control
     * measuring itself would find room the moment it folded and unfold straight back into the same
     * shortage.
     */
    container: RefObject<HTMLElement | null>;
    /** Keeps the folded rendering up whatever the width — for a phone, which has room for no other. */
    alwaysCollapsed?: boolean;
    className?: string;
    /** Draws the control, told which of its two renderings is being asked for. */
    children: (collapsed: boolean) => ComponentChildren;
}

/**
 * Shows a control one of two ways — as it stands, or folded into something narrower — by whether the
 * wide way fits the room it is given.
 *
 * For a row of named options that is worth showing whole where there is width for it (a calendar's
 * views, say) and is better as a menu where there is not: an alternative to hiding it behind a menu
 * everywhere, or to switching on the screen's own size, which says nothing about the width of the one
 * pane the control is in.
 *
 * A shortage is read either from the width the control is handed or from what it hangs outside the
 * container by, since a bar out of room may squeeze its parts or may simply grow past the pane. The
 * first is the tidier of the two and is worth arranging: `min-width: 0` on whatever the control sits
 * in, a flex item otherwise refusing to go under its content's width.
 */
export default function CollapseOnOverflow({ container, alwaysCollapsed, className, children }: CollapseOnOverflowProps) {
    const ref = useRef<HTMLDivElement>(null);
    const collapsed = useCollapsed(ref, container, alwaysCollapsed);

    return (
        <div
            ref={ref}
            className={clsx(
                "tn-collapse-on-overflow",
                // Stated only while the wide rendering is up: it is measured by what it spills, and the
                // folded one is a menu that clipping would cut off (see the CSS).
                !collapsed && "tn-collapse-on-overflow-wide",
                className
            )}
        >
            {children(collapsed)}
        </div>
    );
}

interface CollapseState {
    collapsed: boolean;
    /**
     * The container width the wide rendering is owed before it is tried again — nought while it is
     * up, there being nothing to wait for.
     */
    expandAt: number;
}

interface CollapseMeasurement {
    /** What the wide rendering asks for. */
    wantedWidth: number;
    /** What it is given where it stands, which is less than it asked for once the row is squeezed. */
    givenWidth: number;
    /**
     * How far it hangs outside the container, for a row that is not squeezed but spills.
     *
     * The other way a shortage shows itself, and the one that shows where a row cannot be squeezed:
     * a flex item keeps its content's width unless something states otherwise, so a bar with no room
     * left hands its parts nothing less and grows past the pane instead.
     */
    spilledWidth: number;
    /** The width of the container it is weighed against. */
    containerWidth: number;
}

/**
 * Whether the folded rendering should be up, from a measurement of the wide one.
 *
 * Folding is decided by what the wide rendering spills. Unfolding cannot be — the folded one spills
 * nothing wherever it is put — so the container width at the moment of folding is kept, raised by
 * what was missing, and the wide rendering is not tried again until the container has grown that far.
 *
 * What was missing is the control's own share of the shortage, the row it sits in sharing a shortage
 * out between everything that can give, so the mark can be set short and unfolding then folds
 * straight back with a higher one. It settles after a step or two, and each step puts the mark above
 * a width just shown not to work, so no single width can flip back and forth.
 */
export function nextCollapsedState(state: CollapseState, { wantedWidth, givenWidth, spilledWidth, containerWidth }: CollapseMeasurement): CollapseState {
    if (state.collapsed) {
        return containerWidth < state.expandAt ? state : { collapsed: false, expandAt: 0 };
    }

    // A pixel of slack: these widths are whole numbers rounded off a fractional layout, and a row
    // that fits exactly is as likely to report one over as one under.
    const missing = Math.max(wantedWidth - givenWidth, spilledWidth);
    return missing > 1 ? { collapsed: true, expandAt: containerWidth + missing } : state;
}

/** Watches the control and its container, answering which rendering the width allows for. */
function useCollapsed(ref: RefObject<HTMLDivElement>, container: RefObject<HTMLElement | null>, alwaysCollapsed?: boolean) {
    const [ collapsed, setCollapsed ] = useState(false);
    // Held rather than read from the state: the measuring below happens outside of a render, and what
    // it decides from is its own last answer along with the width it then found wanting.
    const stateRef = useRef<CollapseState>({ collapsed: false, expandAt: 0 });

    useLayoutEffect(() => {
        const element = ref.current;
        const containerElement = container.current;
        if (alwaysCollapsed || !element || !containerElement) return;

        const measure = () => {
            const box = element.getBoundingClientRect();
            const containerBox = containerElement.getBoundingClientRect();
            const next = nextCollapsedState(stateRef.current, {
                wantedWidth: element.scrollWidth,
                givenWidth: element.clientWidth,
                // Which edge it hangs past is a matter of the writing direction, so both are asked.
                spilledWidth: Math.max(0, box.right - containerBox.right, containerBox.left - box.left),
                containerWidth: containerElement.clientWidth
            });
            stateRef.current = next;
            setCollapsed(next.collapsed);
        };

        // Measured before the first paint rather than after it, so a control with no room for its
        // wide rendering is never shown wearing it.
        measure();
        // Both are watched: what the control is given comes from the row it is in, and what that row
        // has to give comes from the container.
        const resizes = new ResizeObserver(measure);
        resizes.observe(element);
        resizes.observe(containerElement);
        return () => resizes.disconnect();
    }, [ ref, container, alwaysCollapsed ]);

    return alwaysCollapsed || collapsed;
}
