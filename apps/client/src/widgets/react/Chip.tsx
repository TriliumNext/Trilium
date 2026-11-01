import "./Chip.css";

import type { ComponentChildren } from "preact";

import ActionButton from "./ActionButton.jsx";

interface ChipProps {
    children: ComponentChildren;
    /** What removing this chip means, in the host's own words (e.g. "Remove this option"). */
    removeButtonText: string;
    onRemove(): void;
    /** Leaves the chips as a display of the set, with nothing to press. */
    disabled?: boolean;
    className?: string;
}

/**
 * One entry of a set, drawn as a rounded chip with a button removing it. Whatever the chip stands
 * for goes inside — the text of a value, or a box the text is typed into — so that a set being read
 * and a set being edited look alike.
 */
export default function Chip({ children, removeButtonText, onRemove, disabled, className }: ChipProps) {
    return (
        <div className={`tn-chip ${className ?? ""}`}>
            {children}
            <ActionButton
                className="tn-chip-remove"
                icon="bx bx-x"
                text={removeButtonText}
                disabled={disabled}
                onClick={onRemove}
            />
        </div>
    );
}
