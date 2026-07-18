import "./SelectableCard.css";

import type { ComponentChildren } from "preact";

import MaskedIcon from "./MaskedIcon";

export interface SelectableCardProps {
    title: ComponentChildren;
    description?: ComponentChildren;
    /** URL of an SVG rendered monochrome via a CSS mask (e.g. an imported `*.svg?url`). Provide either this or {@link icon}. */
    iconUrl?: string;
    /** Boxicons class (e.g. `"bx bx-import"`) shown in place of {@link iconUrl}. */
    icon?: string;
    selected: boolean;
    onSelect: () => void;
    className?: string;
}

/**
 * A selectable tile: an icon, a bold title and an optional description, with a highlighted "selected"
 * state. Used by the import and export dialogs to pick a provider/format. Lay several out together with
 * {@link SelectableCardGrid}.
 */
export default function SelectableCard({ title, description, iconUrl, icon, selected, onSelect, className }: SelectableCardProps) {
    return (
        <button type="button" className={`selectable-card ${selected ? "selected" : ""} ${className ?? ""}`} onClick={onSelect}>
            {iconUrl
                ? <MaskedIcon url={iconUrl} />
                : icon ? <span className={`selectable-card-bxicon ${icon}`} /> : null}
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
