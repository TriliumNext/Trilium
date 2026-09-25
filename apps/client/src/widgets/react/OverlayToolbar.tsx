import "./OverlayToolbar.css";

import clsx from "clsx";
import { type ComponentChildren, createContext } from "preact";
import { useContext } from "preact/hooks";

import ActionButton, { type ActionButtonProps } from "./ActionButton";

interface OverlayToolbarProps {
    /** Where the bar stands and what else is peculiar to it, styled by whoever puts it there. */
    className?: string;
    /** Which way the buttons' tooltips open — away from the edge the bar is pinned to. */
    titlePosition?: ActionButtonProps["titlePosition"];
    children: ComponentChildren;
}

/**
 * A bar of buttons standing over a canvas that is dragged and zoomed — a mind map, a geo map — where
 * what is done to the view has nowhere else to live.
 *
 * It brings the surface (see OverlayToolbar.css) and keeps itself out of the canvas's reach; where it
 * stands is left to the caller, which is the one thing that differs between two of them.
 */
export default function OverlayToolbar({ className, titlePosition, children }: OverlayToolbarProps) {
    return (
        <div
            className={`tn-overlay-toolbar ${className ?? ""}`}
            /* Keep interactions inside the bar from reaching the canvas underneath, which would
               otherwise take a press on a button for the start of a drag or a selection. */
            onMouseDown={(e) => e.stopPropagation()}
        >
            <TooltipDirection.Provider value={titlePosition ?? "top"}>
                {children}
            </TooltipDirection.Provider>
        </div>
    );
}

/**
 * A button on such a bar, dressed as the buttons floating over a relation map are (see
 * {@link RelationMap}).
 *
 * Its tooltip opens the way the bar it stands on says, so that a bar at the foot of a canvas does not
 * open its tooltips off the bottom edge — overridable per button where one of them is placed
 * differently from its neighbours.
 */
export function OverlayToolbarButton({ titlePosition, className, ...props }: ActionButtonProps) {
    const barDirection = useContext(TooltipDirection);

    return <ActionButton
        {...props}
        className={clsx("tn-tool-button", className)}
        noIconActionClass
        titlePosition={titlePosition ?? barDirection}
    />;
}

/** Which way the tooltips on a bar open, handed down by the bar rather than repeated on each button. */
const TooltipDirection = createContext<ActionButtonProps["titlePosition"]>("top");
