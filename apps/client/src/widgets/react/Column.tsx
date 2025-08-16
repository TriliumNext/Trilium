import type { ComponentChildren } from "preact";
import { CSSProperties } from "preact/compat";

interface ColumnProps {
    md?: number;
    children: ComponentChildren;
    className?: string;
    style?: CSSProperties;
}

export default function Column({ md, children, className, style }: ColumnProps) {
    return (
        <div className={`col-md-${md ?? 6} ${className ?? ""}`} style={style}>
            {children}
        </div>
    )
}