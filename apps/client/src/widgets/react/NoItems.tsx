import "./NoItems.css";

import { ComponentChildren } from "preact";

import Icon from "./Icon";

interface NoItemsProps {
    icon: string;
    text: string;
    children?: ComponentChildren;
}

export default function NoItems({ icon, text, children }: NoItemsProps) {
    return (
        <div className="no-items">
            <Icon icon={icon} />
            {text}
            {children}
        </div>
    );
}
