import "./OptionsSection.css";

import type { ComponentChildren } from "preact";
import { CSSProperties } from "preact/compat";

import HelpButton from "../../../react/HelpButton";

interface OptionsSectionProps {
    title?: ComponentChildren;
    description?: ComponentChildren;
    children: ComponentChildren;
    noCard?: boolean;
    style?: CSSProperties;
    className?: string;
    helpUrl?: string;
    /** Buttons for the section's own header, beside the help button — e.g. one that adds to the card. */
    actions?: ComponentChildren;
}

export default function OptionsSection({ title, description, children, noCard, className, helpUrl, actions, ...rest }: OptionsSectionProps) {
    const header = (title || helpUrl || actions) && (
        <div className="options-section-header">
            {title && <h4>{title}</h4>}
            {helpUrl && <HelpButton helpPage={helpUrl} />}
            {actions}
        </div>
    );

    const content = (
        <>
            {description && <p className="options-section-description">{description}</p>}
            {children}
        </>
    );

    if (noCard) {
        return (
            <div className={`options-section tn-no-card ${className ?? ""}`} {...rest}>
                {header}
                {content}
            </div>
        );
    }

    return (
        <div className={`options-section ${className ?? ""}`} {...rest}>
            {header}
            <div className="options-section-card">
                {content}
            </div>
        </div>
    );
}
