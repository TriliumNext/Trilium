import { ComponentChildren } from "preact";

interface AdmonitionProps {
    type: "warning" | "note" | "caution";
    children: ComponentChildren;
    className?: string;
}

export default function Admonition({ type, children, className }: AdmonitionProps) {
    return (
        <div className={`admonition ${type} ${className}`} role="alert">
            {children}
        </div>
    )
}
