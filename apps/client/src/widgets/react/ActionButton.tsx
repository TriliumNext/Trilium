import { HTMLAttributes } from "preact";
import { useEffect, useRef, useState } from "preact/hooks";

import { CommandNames } from "../../components/app_context";
import keyboard_actions from "../../services/keyboard_actions";
import { isMobile } from "../../services/utils";
import { useStaticTooltip } from "./hooks";

export interface ActionButtonProps extends Pick<HTMLAttributes<HTMLButtonElement>, "onClick" | "onAuxClick" | "onContextMenu" | "onBlur" | "style"> {
    text: string;
    titlePosition?: "top" | "right" | "bottom" | "left";
    /** Extra class applied to the tooltip popup (e.g. `tooltip-top` to raise its z-index above modals). */
    tooltipClass?: string;
    icon: string;
    className?: string;
    triggerCommand?: CommandNames;
    noIconActionClass?: boolean;
    frame?: boolean;
    active?: boolean;
    disabled?: boolean;
}

const cachedIsMobile = isMobile();

export default function ActionButton({ text, icon, className, triggerCommand, titlePosition, tooltipClass, noIconActionClass, frame, active, disabled, ...restProps }: ActionButtonProps) {
    const buttonRef = useRef<HTMLButtonElement>(null);
    const [ keyboardShortcut, setKeyboardShortcut ] = useState<string[]>();

    useStaticTooltip(buttonRef, {
        title: keyboardShortcut?.length ? `${text} (${keyboardShortcut?.join(",")})` : text,
        placement: titlePosition ?? "bottom",
        fallbackPlacements: [ titlePosition ?? "bottom" ],
        customClass: tooltipClass ?? "",
        trigger: cachedIsMobile ? "focus" : "hover focus",
        animation: false
    });

    useEffect(() => {
        if (triggerCommand) {
            keyboard_actions.getAction(triggerCommand, true).then(action => setKeyboardShortcut(action?.effectiveShortcuts));
        }
    }, [triggerCommand]);

    return <button
        ref={buttonRef}
        // An action button is driven by its onClick — it must never act as a form's
        // implicit submit button (a <button> defaults to type="submit"). Otherwise,
        // inside a <form>, pressing Enter could activate it instead of submitting
        // (e.g. the error-dismiss button stealing the login form's Enter).
        type="button"
        class={`${className ?? ""} ${!noIconActionClass ? "icon-action" : "btn"} ${icon} ${frame ? "btn btn-primary" : ""} ${disabled ? "disabled" : ""} ${active ? "active" : ""}`}
        data-trigger-command={triggerCommand}
        disabled={disabled}
        {...restProps}
    />;
}
