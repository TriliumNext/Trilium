import { useEffect, useRef, useState } from "preact/hooks";
import { CommandNames } from "../../components/app_context";
import { useStaticTooltip } from "./hooks";
import keyboard_actions from "../../services/keyboard_actions";
import { HTMLAttributes } from "preact";

export interface ActionButtonProps extends Pick<HTMLAttributes<HTMLButtonElement>, "onClick" | "onAuxClick" | "onContextMenu"> {
    text: string;
    titlePosition?: "top" | "right" | "bottom" | "left";
    icon: string;
    className?: string;
    triggerCommand?: CommandNames;
    noIconActionClass?: boolean;
    frame?: boolean;
    active?: boolean;
    disabled?: boolean;
}

export default function ActionButton({ text, icon, className, triggerCommand, titlePosition, noIconActionClass, frame, active, disabled, ...restProps }: ActionButtonProps) {
    const buttonRef = useRef<HTMLButtonElement>(null);
    const [ keyboardShortcut, setKeyboardShortcut ] = useState<string[]>();

    useStaticTooltip(buttonRef, {
        title: keyboardShortcut?.length ? `${text} (${keyboardShortcut?.join(",")})` : text,
        placement: titlePosition ?? "bottom",
        fallbackPlacements: [ titlePosition ?? "bottom" ],
        animation: false
    });

    useEffect(() => {
        if (triggerCommand) {
            keyboard_actions.getAction(triggerCommand, true).then(action => setKeyboardShortcut(action?.effectiveShortcuts));
        }
    }, [triggerCommand]);

    return <button
        ref={buttonRef}
        class={`${className ?? ""} ${!noIconActionClass ? "icon-action" : "btn"} ${icon} ${frame ? "btn btn-primary" : ""} ${disabled ? "disabled" : ""} ${active ? "active" : ""}`}
        data-trigger-command={triggerCommand}
        disabled={disabled}
        {...restProps}
    />;
}
