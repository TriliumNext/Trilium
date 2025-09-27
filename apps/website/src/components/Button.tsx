import { ComponentChildren } from "preact";
import Icon from "./Icon";
import "./Button.css";

interface LinkProps {
    className?: string;
    href?: string;
    openExternally?: boolean;
    children: ComponentChildren;
    title?: string;
    onClick?: (e: MouseEvent) => void;
}

interface ButtonProps extends Omit<LinkProps, "children"> {
    href?: string;
    iconSvg?: string;
    text: ComponentChildren;
    openExternally?: boolean;
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
    )
}

export function Link({ openExternally, children, ...restProps }: LinkProps) {
    return (
        <a
            {...restProps}
            target={openExternally ? "_blank" : undefined}
            rel={openExternally ? "noopener noreferrer" : undefined}
        >
            {children}
        </a>
    )
}
