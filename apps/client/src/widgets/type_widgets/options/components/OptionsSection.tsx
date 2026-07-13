import "./OptionsSection.css";

import { type ComponentChildren, createContext } from "preact";
import { CSSProperties } from "preact/compat";

import { Card } from "../../../react/Card";
import HelpButton from "../../../react/HelpButton";

/**
 * Whether the surrounding card lays its content out as segments — one per option row, separated by
 * the card's own seams — rather than as rows divided by hairlines inside a single box.
 *
 * The dialogs that reuse `OptionsRow` (import, delete, login) do not provide this, so their rows keep
 * the divided layout they were designed with.
 */
export const OptionsCardContext = createContext(false);

interface OptionsSectionProps {
    title?: ComponentChildren;
    description?: ComponentChildren;
    children: ComponentChildren;
    noCard?: boolean;
    style?: CSSProperties;
    className?: string;
    helpUrl?: string;
}

export default function OptionsSection({ title, description, children, noCard, className, helpUrl, ...rest }: OptionsSectionProps) {
    const header = (title || helpUrl) && (
        <div className="options-section-header">
            {title && <h4>{title}</h4>}
            {helpUrl && <HelpButton helpPage={helpUrl} />}
        </div>
    );

    if (noCard) {
        return (
            <div className={`options-section tn-no-card ${className ?? ""}`} {...rest}>
                {header}
                {description && <p className="options-section-description">{description}</p>}
                {children}
            </div>
        );
    }

    // The description introduces the card rather than belonging to it, so it sits above rather than
    // taking a segment of its own — which would read as a settings row with nothing to set.
    return (
        <div className={`options-section ${className ?? ""}`} {...rest}>
            {header}
            {description && <p className="options-section-description">{description}</p>}
            <OptionsCardContext.Provider value={true}>
                <Card className="options-section-card">
                    {children}
                </Card>
            </OptionsCardContext.Provider>
        </div>
    );
}
