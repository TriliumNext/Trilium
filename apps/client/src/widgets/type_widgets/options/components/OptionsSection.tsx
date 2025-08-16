import type { ComponentChildren } from "preact";
import { CSSProperties } from "preact/compat";

interface OptionsSectionProps {
    title?: string;
    children: ComponentChildren;
    noCard?: boolean;
    style?: CSSProperties;
    className?: string;
}

export default function OptionsSection({ title, children, noCard, ...rest }: OptionsSectionProps) {
    return (
        <div className={`options-section ${noCard && "tn-no-card"}`} {...rest}>
            {title && <h4>{title}</h4>}
            {children}
        </div>
    );
}
