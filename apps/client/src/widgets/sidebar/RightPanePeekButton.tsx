import "./RightPanePeekButton.css";

import { Tooltip } from "bootstrap";
import clsx from "clsx";
import { useCallback, useMemo, useRef } from "preact/hooks";

import { t } from "../../services/i18n";
import { useStaticTooltip } from "../react/hooks";

// Gap (px) between the peek button and its tooltip, so the tooltip can't overlap the button.
const TOOLTIP_MARGIN_PX = 8;

interface RightPanePeekButtonProps {
    /** Owned and persisted by RightPanelContainer; this component only reflects it. */
    rightPaneVisible: boolean;
    /** Toggles the right pane (peeks it open, or closes it); owned by RightPanelContainer. */
    onToggle: () => void;
}

export default function RightPanePeekButton({ rightPaneVisible, onToggle }: RightPanePeekButtonProps) {
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

    // Open: a click hides it. Closed: a click peeks it (the pin then docks it).
    const label = rightPaneVisible ? t("right_pane.hide") : t("right_pane.peek");

    // Anchor the tooltip to the pointer's entry height rather than the centre of the
    // full-height button, by shifting it along the cross axis. Not tracked: `pointerY`
    // is only updated on mouse enter, and the offset is recomputed from it on show.
    // The `distance` (second value) keeps the tooltip clear of the button so it can't
    // overlap it and cause hover flicker.
    const tooltipConfig = useMemo(() => ({
        title: label,
        placement: "left" as const,
        offset: () => {
            const rect = buttonRef.current?.getBoundingClientRect();
            if (!rect || pointerY.current === null) return [ 0, TOOLTIP_MARGIN_PX ] as [number, number];
            return [ pointerY.current - (rect.top + rect.height / 2), TOOLTIP_MARGIN_PX ] as [number, number];
        }
    }), [ label ]);
    useStaticTooltip(buttonRef, tooltipConfig);

    return (
        <button
            ref={buttonRef}
            type="button"
            aria-label={label}
            class={clsx(
                "right-pane-peek-button bx",
                rightPaneVisible ? "bx-chevron-right" : "bx-chevron-left",
                rightPaneVisible ? "right-pane-peek-button-action-collapse" : "right-pane-peek-button-action-expand"
            )}
            onMouseEnter={(e) => { pointerY.current = e.clientY; }}
            onMouseLeave={() => { pointerY.current = null; }}
            onClick={handleClick}
        />
    );
}
