import clsx from "clsx";
import { HTMLAttributes } from "preact";
import { useRef } from "preact/hooks";

import { isMobile } from "../../services/utils";
import { useStaticTooltip } from "./hooks";
import RawHtml from "./RawHtml";

interface IconProps extends Pick<HTMLAttributes<HTMLSpanElement>,
    "className" | "onClick" | "title" | "style" | "role" | "aria-label"> {
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

/** An icon drawn from its SVG source, such as a CKEditor toolbar item's, sized as an {@link Icon}. */
export function SvgIcon({ svg, className }: { svg: string; className?: string }) {
    return <RawHtml className={clsx("tn-icon tn-svg-icon", className)} html={svg} />;
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
