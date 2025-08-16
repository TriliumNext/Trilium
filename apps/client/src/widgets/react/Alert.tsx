import { ComponentChildren } from "preact";

interface AlertProps {
    type: "info" | "danger" | "warning";
    title?: string;
    children: ComponentChildren;
}

export default function Alert({ title, type, children }: AlertProps) {
    return (
        <div className={`alert alert-${type}`}>
            {title && <h4>{title}</h4>}

            {children}
        </div>
    );
}