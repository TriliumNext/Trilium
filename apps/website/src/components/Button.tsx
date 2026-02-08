import "./Button.css";

import { ComponentChildren } from "preact";

import Icon from "./Icon.js";

interface LinkProps {
    className?: string;
    href?: string;
    openExternally?: boolean;
    children?: ComponentChildren;
    title?: string;
    onClick?: (e: MouseEvent) => void;
    download?: boolean;
}

interface ButtonProps extends Omit<LinkProps, "children"> {
    href?: string;
    iconSvg?: string;
    text: ComponentChildren;
    openExternally?: boolean;
    download?: boolean;
    outline?: boolean;
}

export default function Button({ iconSvg, text, className, outline, ...restProps }: ButtonProps) {
    return (
        <Link
            className={`button ${className} ${outline ? "outline" : ""}`}
            {...restProps}
        >
            {iconSvg && <><Icon svg={iconSvg} />{" "}</>}
            <span class="text">{text}</span>
        </Link>
    );
}

export function Link({ openExternally, children, download, ...restProps }: LinkProps) {
    return (
        <a
            {...restProps}
            target={openExternally || download ? "_blank" : undefined}
            download={download}
            rel={openExternally || download ? "noopener noreferrer" : undefined}
        >
            {children}
        </a>
    );
}
