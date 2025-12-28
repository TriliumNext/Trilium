import "./Badge.css";

import clsx from "clsx";
import { ComponentChildren, HTMLAttributes } from "preact";
import { useRef } from "preact/hooks";

import Dropdown, { DropdownProps } from "./Dropdown";
import { useStaticTooltip } from "./hooks";
import Icon from "./Icon";

interface SimpleBadgeProps {
    className?: string;
    title: ComponentChildren;
}

interface BadgeProps extends Pick<HTMLAttributes<HTMLDivElement>, "onClick" | "style"> {
    text?: ComponentChildren;
    icon?: string;
    className?: string;
    tooltip?: string;
    href?: string;
}

export default function SimpleBadge({ title, className }: SimpleBadgeProps) {
    return <span class={`badge ${className ?? ""}`}>{title}</span>;
}

export function Badge({ icon, className, text, tooltip, href, ...containerProps }: BadgeProps) {
    const containerRef = useRef<HTMLDivElement>(null);
    useStaticTooltip(containerRef, {
        placement: "bottom",
        fallbackPlacements: [ "bottom" ],
        animation: false,
        html: true,
        title: tooltip,
        customClass: "pre-wrap-text"
    });

    const content = <>
        {icon && <Icon icon={icon} />}
        <span class="text">{text}</span>
    </>;

    return (
        <div
            ref={containerRef}
            className={clsx("ext-badge", className, { "clickable": !!containerProps.onClick })}
            {...containerProps}
        >
            {href ? <a href={href}>{content}</a> : <span>{content}</span>}
        </div>
    );
}

export function BadgeWithDropdown({ text, children, tooltip, className, dropdownOptions, ...props }: BadgeProps & {
    children: ComponentChildren,
    dropdownOptions?: Partial<DropdownProps>
}) {
    return (
        <Dropdown
            className={`dropdown-badge dropdown-${className}`}
            text={<Badge
                text={<>
                    <span class="text-inner">{text}</span>
                    <Icon className="arrow" icon="bx bx-chevron-down" />
                </>}
                className={className}
                {...props}
            />}
            noDropdownListStyle
            noSelectButtonStyle
            hideToggleArrow
            title={tooltip}
            titlePosition="bottom"
            {...dropdownOptions}
            dropdownOptions={{
                ...dropdownOptions?.dropdownOptions,
                popperConfig: {
                    ...dropdownOptions?.dropdownOptions?.popperConfig,
                    placement: "bottom", strategy: "fixed"
                }
            }}
        >{children}</Dropdown>
    );
}
