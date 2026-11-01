import "./PeekPaneButton.css";

import type { KeyboardActionNames } from "@triliumnext/commons";
import { Tooltip } from "bootstrap";
import clsx from "clsx";
import { useCallback, useMemo, useRef } from "preact/hooks";

import { useStaticTooltipWithKeyboardShortcut } from "./hooks";

// Gap (px) between the peek button and its tooltip, so the tooltip can't overlap the button.
const TOOLTIP_MARGIN_PX = 8;

/** The window edge a pane opens from, in the direction the text runs. */
export type PaneSide = "start" | "end";

interface PeekPaneButtonProps {
    side: PaneSide;
    /** Whether the pane is shown (peeked or docked). The pane owns this state. */
    isOpen: boolean;
    /** Peeks the pane open, or closes it; owned by the pane. */
    onToggle: () => void;
    /** The instance class, used by the pane's dismissal and stylesheet. */
    className: string;
    /** The label while the pane is open (a click hides it). */
    hideText: string;
    /** The label while the pane is closed (a click peeks it). */
    peekText: string;
    /** The keyboard action that does what a click does, whose shortcut the tooltip shows. */
    keyboardAction?: KeyboardActionNames;
}

/**
 * A full-height button on a window edge that peeks or hides a side pane. It sits in a gutter that
 * the pane's container reserves (see `PeekPaneButton.css`).
 */
export default function PeekPaneButton(props: PeekPaneButtonProps) {
    const { side, isOpen, onToggle, className, hideText, peekText, keyboardAction } = props;
    const buttonRef = useRef<HTMLButtonElement>(null);
    // Pointer's vertical position captured once on hover; null until the mouse enters
    // (e.g. on keyboard focus) so the tooltip falls back to the button's centre.
    const pointerY = useRef<number | null>(null);

    const handleClick = useCallback(() => {
        onToggle();
        // Reset Bootstrap's hover/focus trigger state. A click otherwise leaves the button
        // focused, which keeps the tooltip "stuck" and prevents it re-triggering on next hover.
        const button = buttonRef.current;
        if (button) {
            Tooltip.getInstance(button)?.hide();
            button.blur();
        }
    }, [ onToggle ]);

    const label = isOpen ? hideText : peekText;

    // Anchor the tooltip to the pointer's entry height rather than the centre of the
    // full-height button, by shifting it along the cross axis. Not tracked: `pointerY`
    // is only updated on mouse enter, and the offset is recomputed from it on show.
    // The `distance` (second value) keeps the tooltip clear of the button so it can't
    // overlap it and cause hover flicker.
    const tooltipOptions = useMemo(() => ({
        placement: side === "end" ? "left" as const : "right" as const,
        offset: (): [number, number] => {
            const rect = buttonRef.current?.getBoundingClientRect();
            if (!rect || pointerY.current === null) return [ 0, TOOLTIP_MARGIN_PX ];
            return [ pointerY.current - (rect.top + rect.height / 2), TOOLTIP_MARGIN_PX ];
        }
    }), [ side ]);
    useStaticTooltipWithKeyboardShortcut(buttonRef, label, keyboardAction, tooltipOptions);

    // The arrow points the way the pane moves: inward to peek it, outward to hide it.
    const pointsRight = (side === "start") !== isOpen;

    return (
        <button
            ref={buttonRef}
            type="button"
            aria-label={label}
            class={clsx(
                "peek-pane-button bx",
                className,
                `side-${side}`,
                pointsRight ? "bx-chevron-right" : "bx-chevron-left",
                isOpen ? "peek-pane-button-action-collapse" : "peek-pane-button-action-expand"
            )}
            onMouseEnter={(e) => { pointerY.current = e.clientY; }}
            onMouseLeave={() => { pointerY.current = null; }}
            onClick={handleClick}
        />
    );
}
