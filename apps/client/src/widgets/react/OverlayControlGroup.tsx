import "./OverlayControlGroup.css";

import clsx from "clsx";
import { type ComponentChildren, createContext, type HTMLAttributes } from "preact";
import { useContext, useMemo, useRef } from "preact/hooks";

import { t } from "../../services/i18n";
import type { ActionButtonProps } from "./ActionButton";
import { useStaticTooltip } from "./hooks";

/**
 * Where a group stands over what it is put on: which edge of it, and where along that edge. Every
 * group over the app's content stands at one of these six.
 */
export type OverlayPlacement = `${"top" | "bottom"}-${"start" | "center" | "end"}`;

interface OverlayControlGroupProps {
    /**
     * Which corner — or middle of which edge — the group is pinned to, over the nearest positioned
     * ancestor. How much room it keeps from the edges is the caller's to name, through
     * `--overlay-group-inset` or one of its per-edge forms, and so is what the group stands above
     * (`z-index`), that being about the company it keeps rather than about the group. Left out, the
     * group is laid out in the flow like anything else and placing it is the caller's business
     * entirely.
     */
    placement?: OverlayPlacement;
    /** What is peculiar to this group, styled by whoever puts it there. */
    className?: string;
    /**
     * Which way the buttons' tooltips open. Follows the placement by default — away from the edge the
     * group is pinned to — and is only worth passing for a group placed by hand.
     */
    titlePosition?: ActionButtonProps["titlePosition"];
    /**
     * Keeps a press on the group from reaching what it stands on, for a group over a canvas that is
     * dragged: a map would otherwise take a press on a button for the start of a drag.
     */
    overCanvas?: boolean;
    children: ComponentChildren;
}

/**
 * A run of buttons standing over content, joined edge to edge into one segmented chip: the image
 * viewer's zoom steps, and the like.
 *
 * The surface, the seams and the rounding of the two ends are the theme's to give (see the overlay
 * buttons in theme-next/forms.css). The standing is the group's own, and comes with it
 * (OverlayControlGroup.css): a group names the corner it is pinned to (see {@link OverlayPlacement})
 * rather than each site pinning itself afresh. What is left to the caller is the room to keep from
 * the edges and what the group stands above, both handed over as properties — the first because a
 * map in fullscreen keeps clear of what the screen keeps for itself, the second because it is about
 * what else is in that corner.
 *
 * Not to be confused with {@link OverlayToolbar}, the other thing that floats over content: that one
 * is a bar of separate buttons on a pane of glass, and it brings its own surface with it. This is a
 * single chip with no gaps, and it is what the app's zoom and navigation controls are built from.
 */
export default function OverlayControlGroup({ placement, className, titlePosition, overCanvas, children }: OverlayControlGroupProps) {
    return (
        <div
            className={clsx("tn-overlay-control-group", className)}
            data-placement={placement}
            onMouseDown={overCanvas ? (e) => e.stopPropagation() : undefined}
        >
            <TooltipDirection.Provider value={titlePosition ?? tooltipDirectionFor(placement)}>
                {children}
            </TooltipDirection.Provider>
        </div>
    );
}

/**
 * Which way a group's tooltips open, given where it stands: away from the edge it is pinned to, so
 * that a group at the head of the content does not open its tooltips off the top of it. A group
 * placed by hand is taken to stand at the foot, which is where all but one of them do.
 */
function tooltipDirectionFor(placement: OverlayPlacement | undefined): ActionButtonProps["titlePosition"] {
    return placement?.startsWith("top-") ? "bottom" : "top";
}

interface OverlayControlButtonProps extends Pick<HTMLAttributes<HTMLButtonElement>, "onClick" | "aria-label"> {
    /** What the button does, said on hover. Where the button wears nothing to read, it is its name too. */
    title?: string;
    /** The boxicons name of the mark it wears (`bx-plus-circle`). */
    icon?: string;
    /** What stands inside the button: the words it wears, or the value it shows. */
    text?: ComponentChildren;
    /** Extra class for whatever is peculiar to this one button. */
    className?: string;
    /** Shown held down, for a button standing for a choice in force. */
    active?: boolean;
    disabled?: boolean;
    /** Overrides the direction the group hands down, for a button placed unlike its neighbours. */
    titlePosition?: ActionButtonProps["titlePosition"];
}

/**
 * A button on such a group, in one of two shapes: a mark, drawn at an icon's width, or something to
 * read, drawn at a word's. Given both, the mark stands beside the words — as a child rather than as a
 * class on the button, the boxicons class setting the icon font on whatever wears it and the words
 * beside it being meant to stay words.
 *
 * What it is called follows from that: a button wearing words is named by them, and one wearing only a
 * mark by its title, so that a title saying more at length never speaks over the words on the face of
 * the button. Where what it wears is neither — a keycap, a glyph standing for itself — say so with a
 * plain `aria-label`.
 *
 * Its tooltip opens the way the group it stands on says, so that a group at the foot of the content
 * does not open its tooltips off the bottom edge.
 */
export function OverlayControlButton(props: OverlayControlButtonProps) {
    const { title, icon, text, className, active, disabled, titlePosition, ...restProps } = props;
    const buttonRef = useRef<HTMLButtonElement>(null);
    const groupDirection = useContext(TooltipDirection);
    const placement = titlePosition ?? groupDirection;
    const hasText = "text" in props;

    // Memoized so the tooltip is only rebuilt when what it says (or where it opens) actually changes,
    // rather than on every render of the group.
    const tooltipConfig = useMemo(() => ({ title, placement }), [ title, placement ]);
    useStaticTooltip(buttonRef, tooltipConfig);

    return (
        <button
            ref={buttonRef}
            // Driven by its onClick, so it must never act as a form's implicit submit button
            // (a <button> defaults to type="submit").
            type="button"
            className={clsx(hasText ? "tn-overlay-text-button" : [ "tn-overlay-icon-button bx", icon ], active && "active", className)}
            // A caller passing one of its own wins, for a face that is neither words nor a mark.
            aria-label={hasText ? undefined : title}
            disabled={disabled}
            {...restProps}
        >
            {hasText && icon && <span className={clsx("bx", icon)} aria-hidden="true" />}
            {text}
        </button>
    );
}

interface OverlayFullscreenButtonProps {
    /** Whether what the button stands over has the screen to itself. */
    isFullscreen: boolean;
    /** Gives it the screen, or takes it back. */
    onToggle: () => void;
}

/**
 * The button that gives what the group stands over the whole screen, and takes it back again — its
 * mark and what it is called both naming the way out once it is in. Every such button in the app says
 * the same two things, so it says them here rather than once per map.
 *
 * The state is handed to it rather than read: {@link useFullscreen} is what follows the browser, and
 * a caller may have to wrap it — the mind map takes the middle of its view before the change so as to
 * put it back after (see `useMapFullscreen`), which no button could do on its behalf.
 */
export function OverlayFullscreenButton({ isFullscreen, onToggle }: OverlayFullscreenButtonProps) {
    return (
        <OverlayControlButton
            title={isFullscreen ? t("common.exit_fullscreen") : t("common.fullscreen")}
            icon={isFullscreen ? "bx-exit-fullscreen" : "bx-fullscreen"}
            onClick={() => onToggle()}
        />
    );
}

/** Which way the tooltips on a group open, handed down by the group rather than repeated on each button. */
const TooltipDirection = createContext<ActionButtonProps["titlePosition"]>("top");
