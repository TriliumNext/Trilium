import "./NoItems.css";

import clsx from "clsx";
import { ComponentChildren } from "preact";

import Icon from "./Icon";

interface NoItemsProps {
    icon: string;
    text: string;
    children?: ComponentChildren;
    className?: string;
    /**
     * How much room the placeholder takes. `small` shrinks the icon and the spacing around it, for
     * the places that only have a few lines to spare — a sidebar card or a ribbon tab — where the
     * full-size one would tower over the content it stands in for.
     */
    size?: "normal" | "small";
}

export default function NoItems({ icon, text, children, className, size }: NoItemsProps) {
    return (
        <div className={clsx("no-items", size === "small" && "no-items-small", className)}>
            <Icon icon={icon} />
            {text}
            {children}
        </div>
    );
}
