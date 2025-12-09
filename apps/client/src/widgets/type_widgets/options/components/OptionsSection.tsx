import type { ComponentChildren } from "preact";
import { CSSProperties } from "preact/compat";

interface OptionsSectionProps {
    title?: ComponentChildren;
    children: ComponentChildren;
    noCard?: boolean;
    style?: CSSProperties;
    className?: string;
}

export default function OptionsSection({ title, children, noCard, className, ...rest }: OptionsSectionProps) {
    return (
        <div className={`options-section ${noCard ? "tn-no-card" : ""} ${className ?? ""}`} {...rest}>
            {title && <h4>{title}</h4>}
            {children}
        </div>
    );
}
