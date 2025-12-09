import { ComponentChildren } from "preact";
import { CSSProperties } from "preact/compat";

interface AlertProps {
    type: "info" | "danger" | "warning";
    title?: string;
    children: ComponentChildren;
    className?: string;
    style?: CSSProperties;
}

export default function Alert({ title, type, children, className, style }: AlertProps) {
    return (
        <div className={`alert alert-${type} ${className ?? ""}`} style={style}>
            {title && <h4>{title}</h4>}

            {children}
        </div>
    );
}