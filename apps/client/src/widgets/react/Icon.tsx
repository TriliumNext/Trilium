import clsx from "clsx";
import { HTMLAttributes } from "preact";
import { useRef } from "preact/hooks";

import { isMobile } from "../../services/utils";
import { useStaticTooltip } from "./hooks";

interface IconProps extends Pick<HTMLAttributes<HTMLSpanElement>, "className" | "onClick" | "title" | "style"> {
    icon?: string;
    className?: string;
}

export default function Icon({ icon, className, ...restProps }: IconProps) {
    return (
        <span
            class={clsx(icon ?? "bx bx-empty", className, "tn-icon")}
            {...restProps}
        />
    );
}

interface TooltipIconProps extends Omit<IconProps, "title"> {
    /** Tooltip text, rendered as a Bootstrap tooltip rather than a native `title`. */
    tooltip: string;
    tooltipPosition?: "top" | "right" | "bottom" | "left";
    /** Extra class applied to the tooltip popup (e.g. `tooltip-top` to raise it above modals). */
    tooltipClass?: string;
}

/** An {@link Icon} that shows a Bootstrap tooltip on hover/focus instead of a native `title`. */
export function TooltipIcon({ icon, className, tooltip, tooltipPosition, tooltipClass, ...restProps }: TooltipIconProps) {
    const ref = useRef<HTMLSpanElement>(null);
    useStaticTooltip(ref, {
        title: tooltip,
        placement: tooltipPosition ?? "top",
        fallbackPlacements: [ tooltipPosition ?? "top" ],
        customClass: tooltipClass ?? "",
        trigger: isMobile() ? "focus" : "hover focus",
        animation: false
    });

    return (
        <span
            ref={ref}
            class={clsx(icon ?? "bx bx-empty", className, "tn-icon")}
            {...restProps}
        />
    );
}
