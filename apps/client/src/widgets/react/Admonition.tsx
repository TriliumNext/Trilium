import { HTML } from "mermaid/dist/diagram-api/types.js";
import { ComponentChildren, HTMLAttributes } from "preact";

interface AdmonitionProps extends Pick<HTMLAttributes<HTMLDivElement>, "style"> {
    type: "warning" | "note" | "caution";
    children: ComponentChildren;
    className?: string;
}

export default function Admonition({ type, children, className, ...props }: AdmonitionProps) {
    return (
        <div className={`admonition ${type} ${className}`} role="alert" {...props}>
            {children}
        </div>
    );
}
