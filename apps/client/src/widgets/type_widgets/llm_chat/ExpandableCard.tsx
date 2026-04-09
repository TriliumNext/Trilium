import "./ExpandableCard.css";

import type { ComponentChildren } from "preact";

interface ExpandableSectionProps {
    icon: string;
    label: ComponentChildren;
    className?: string;
    children: ComponentChildren;
}

/** A collapsible section within an ExpandableCard. */
export function ExpandableSection({ icon, label, className, children }: ExpandableSectionProps) {
    return (
        <details className={`expandable-section ${className ?? ""}`}>
            <summary className="expandable-section-summary">
                <span className={icon} />
                <span className="expandable-section-label">{label}</span>
                <span className="bx bx-chevron-down expandable-section-chevron" />
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
