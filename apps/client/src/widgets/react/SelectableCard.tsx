import "./SelectableCard.css";

import type { ComponentChildren } from "preact";

import Icon from "./Icon";

export interface SelectableCardProps {
    title: ComponentChildren;
    description?: ComponentChildren;
    /** The icon class, such as `"bx bx-import"` or a brand mark's `"tn-brand tn-brand-notion"`. */
    icon?: string;
    selected: boolean;
    onSelect: () => void;
    /**
     * Greys the tile out and makes it unpickable, while leaving it in the list —
     * for a choice that exists but can't be taken here. Say why in
     * {@link description}: a card that simply refuses to respond is worse than no
     * card at all.
     */
    disabled?: boolean;
    className?: string;
}

/**
 * A selectable tile: an icon, a bold title and an optional description, with a highlighted "selected"
 * state. Used by the import and export dialogs to pick a provider/format. Lay several out together with
 * {@link SelectableCardGrid}.
 */
export default function SelectableCard({ title, description, icon, selected, onSelect, disabled, className }: SelectableCardProps) {
    return (
        <button type="button" className={`selectable-card ${selected ? "selected" : ""} ${className ?? ""}`} onClick={onSelect} disabled={disabled}>
            {icon && <Icon icon={icon} className="selectable-card-icon" />}
            <span className="selectable-card-text">
                <span className="selectable-card-name">{title}</span>
                {description && <span className="selectable-card-description">{description}</span>}
            </span>
        </button>
    );
}

/** Lays out {@link SelectableCard}s in an even grid. `columns` defaults to 3. */
export function SelectableCardGrid({ columns, className, children }: { columns?: number; className?: string; children: ComponentChildren }) {
    return (
        <div className={`selectable-card-grid ${className ?? ""}`} style={columns ? { "--selectable-card-columns": columns } : undefined}>
            {children}
        </div>
    );
}
