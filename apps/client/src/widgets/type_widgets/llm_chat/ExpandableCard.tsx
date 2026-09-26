import "./ExpandableCard.css";

import type { ComponentChildren } from "preact";

interface ExpandableSectionProps {
    icon: string;
    label: ComponentChildren;
    className?: string;
    /** Whether the section is expanded on initial render. */
    open?: boolean;
    children?: ComponentChildren;
    /** Buttons placed after the chevron. Their click handlers must prevent the default toggle. */
    actions?: ComponentChildren;
    /**
     * `card` is a row of an ExpandableCard; `line` is a bare muted line whose body hangs off a rule
     * under the icon, as used by thoughts and tool calls.
     */
    variant?: "card" | "line";
}

/** A collapsible section, either a row of an ExpandableCard or a standalone disclosure line. */
export function ExpandableSection({ icon, label, className, open, children, actions, variant = "card" }: ExpandableSectionProps) {
    return (
        <details className={`expandable-section ${variant === "line" ? "expandable-line" : ""} ${className ?? ""}`} open={open}>
            <summary className="expandable-section-summary">
                <span className={icon} />
                <span className="expandable-section-label">{label}</span>
                <span className="bx bx-chevron-down expandable-section-chevron" />
                {actions}
            </summary>
            <div className="expandable-section-body">
                {children}
            </div>
        </details>
    );
}

interface ExpandableCardProps {
    className?: string;
    children: ComponentChildren;
}

/** A bordered card that groups one or more ExpandableSections. */
export function ExpandableCard({ className, children }: ExpandableCardProps) {
    return (
        <div className={`expandable-card ${className ?? ""}`}>
            {children}
        </div>
    );
}
