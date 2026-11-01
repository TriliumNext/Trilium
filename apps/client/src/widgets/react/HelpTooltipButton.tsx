import "./HelpTooltipButton.css";

import clsx from "clsx";
import { useRef } from "preact/hooks";

import HelpButton from "./HelpButton";
import { useStaticTooltip } from "./hooks";

interface HelpTooltipButtonProps {
    /** The explanation itself, shown on hover. May carry markup, e.g. `<code>` or a list of values. */
    description: string;
    /** When set, the button also opens this in-app help page on click. */
    helpPage?: string;
    className?: string;
    /** Where the tooltip goes relative to the button. Above it, by default. */
    placement?: "top" | "right" | "bottom" | "left";
}

/**
 * A help icon explaining on hover whatever it sits beside — for explanations too long to be shown under
 * a field as a description, or that only some of a set of fields have at all. Where the subject has an
 * in-app help page of its own, the icon opens it on click.
 */
export default function HelpTooltipButton({ description, helpPage, className, placement }: HelpTooltipButtonProps) {
    const ref = useRef<HTMLSpanElement>(null);

    useStaticTooltip(ref, {
        title: description,
        // Explanations carry markup of their own, e.g. <code> or a list of possible values.
        html: true,
        placement: placement ?? "top",
        customClass: "help-tooltip"
    });

    return (
        <span
            ref={ref}
            class={clsx("help-tooltip-button", className, !helpPage && "icon-action bx bx-help-circle")}
            // Focusable in its own right only when it holds no button of its own to tab to, so that the
            // explanation is reachable from the keyboard without doubling up as a second stop.
            tabIndex={helpPage ? undefined : 0}
        >
            {/* Suppressing the button's own title: the explanation is the tooltip here. */}
            {helpPage && <HelpButton helpPage={helpPage} title="" />}
        </span>
    );
}
