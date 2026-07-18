import "./NoItems.css";

import clsx from "clsx";
import { ComponentChildren } from "preact";

import Icon from "./Icon";

interface NoItemsProps {
    icon: string;
    text: string;
    children?: ComponentChildren;
    className?: string;
}

export default function NoItems({ icon, text, children, className }: NoItemsProps) {
    return (
        <div className={clsx("no-items", className)}>
            <Icon icon={icon} />
            {text}
            {children}
        </div>
    );
}
