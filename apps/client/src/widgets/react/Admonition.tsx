import { ComponentChildren } from "preact";

interface AdmonitionProps {
    type: "warning";
    children: ComponentChildren;
}

export default function Admonition({ type, children }: AdmonitionProps) {
    return (
        <div className={`admonition ${type}`} role="alert">
            {children}
        </div>
    )
}