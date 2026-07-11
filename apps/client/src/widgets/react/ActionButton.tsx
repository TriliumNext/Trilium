import { Tooltip } from "bootstrap";
import { HTMLAttributes } from "preact";
import { useEffect, useMemo, useRef, useState } from "preact/hooks";

import { CommandNames } from "../../components/app_context";
import keyboard_actions from "../../services/keyboard_actions";
import { formatShortcut, joinShortcut } from "../../services/keyboard_shortcut_display";
import { isMobile } from "../../services/utils";
import { useStaticTooltip } from "./hooks";

export interface ActionButtonProps extends Pick<HTMLAttributes<HTMLButtonElement>, "onClick" | "onAuxClick" | "onContextMenu" | "onBlur" | "style"> {
    text: string;
    titlePosition?: "top" | "right" | "bottom" | "left";
    /** Extra class applied to the tooltip popup (e.g. `tooltip-top` to raise its z-index above modals). */
    tooltipClass?: string;
    /** Renders `text` as (sanitized) HTML in the tooltip instead of plain text. Only pass trusted, non-user content. */
    tooltipHtml?: boolean;
    icon: string;
    className?: string;
    triggerCommand?: CommandNames;
    noIconActionClass?: boolean;
    frame?: boolean;
    active?: boolean;
    disabled?: boolean;
}

const cachedIsMobile = isMobile();

export default function ActionButton({ text, icon, className, triggerCommand, titlePosition, tooltipClass, tooltipHtml, noIconActionClass, frame, active, disabled, ...restProps }: ActionButtonProps) {
    const buttonRef = useRef<HTMLButtonElement>(null);
    const [ keyboardShortcut, setKeyboardShortcut ] = useState<string[]>();

    const title = keyboardShortcut?.length
        ? `${text} (${keyboardShortcut.map((shortcut) => joinShortcut(formatShortcut(shortcut))).join(", ")})`
        : text;
    const titleRef = useRef(title);
    titleRef.current = title;
    const hasTitle = !!title && title.length > 0;

    // The tooltip is recreated only when its structural options (or its presence) change — not when
    // the label text changes. A plain text change is pushed into the live tooltip via setContent
    // below, so a dynamic label updates in place instead of disposing and recreating the tooltip,
    // which would drop the current hover. The title is resolved lazily (a function) so Bootstrap
    // always reads the latest value from titleRef rather than one captured when the config was memoized.
    const tooltipConfig = useMemo<Partial<Tooltip.Options>>(() => ({
        title: hasTitle ? () => titleRef.current ?? "" : undefined,
        placement: titlePosition ?? "bottom",
        fallbackPlacements: [ titlePosition ?? "bottom" ],
        customClass: tooltipClass ?? "",
        html: tooltipHtml ?? false,
        trigger: cachedIsMobile ? "focus" : "hover focus",
        animation: false
    }), [titlePosition, tooltipClass, tooltipHtml, hasTitle]);
    useStaticTooltip(buttonRef, tooltipConfig);

    useEffect(() => {
        if (buttonRef.current) {
            Tooltip.getInstance(buttonRef.current)?.setContent({ ".tooltip-inner": title ?? "" });
        }
    }, [title]);

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
