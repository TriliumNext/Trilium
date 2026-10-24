import "./Button.css";

import type { Tooltip } from "bootstrap";
import type { ButtonHTMLAttributes, ComponentChildren, CSSProperties, MouseEventHandler, RefObject } from "preact";
import { useMemo, useRef } from "preact/hooks";

import { CommandNames } from "../../components/app_context";
import { t } from "../../services/i18n";
import { isDesktop, isMobile } from "../../services/utils";
import ActionButton from "./ActionButton";
import Dropdown from "./Dropdown";
import { useStaticTooltip } from "./hooks";
import Icon from "./Icon";
import { useCommandTrigger } from "./react_utils";
import { renderShortcutKbds } from "./shortcut_kbd";

const cachedIsMobile = isMobile();

export interface ButtonProps extends Pick<ButtonHTMLAttributes<HTMLButtonElement>,
    "tabIndex" | "aria-pressed" | "aria-haspopup" | "aria-expanded"> {
    name?: string;
    /** Reference to the button element. Mostly useful for requesting focus. */
    buttonRef?: RefObject<HTMLButtonElement | null>;
    text: string | ComponentChildren;
    className?: string;
    icon?: string;
    keyboardShortcut?: string;
    /**
     * Called when the button is clicked. If not set, the button will submit the form (if any).
     *
     * Handed the event, which the button already forwarded before this said so: some handlers read
     * the press's own target to know where to act — opening a note in the tab the button stands in,
     * for one (see `openInCurrentNoteContext`).
     */
    onClick?: MouseEventHandler<HTMLButtonElement>;
    kind?: "primary" | "secondary" | "lowProfile";
    disabled?: boolean;
    size?: "normal" | "small" | "micro";
    style?: CSSProperties;
    triggerCommand?: CommandNames;
    title?: string;
    /** Why the button is off, shown on hover while `disabled`. Ignored otherwise. */
    disabledTooltip?: string;
    /** Marks a toggle button as on or off for assistive technology. */
    "aria-pressed"?: boolean;
}

function Button({ name, buttonRef, className, text, onClick, keyboardShortcut, icon, kind, disabled, disabledTooltip, size, style, triggerCommand, ...restProps }: ButtonProps) {
    const triggerOwnCommand = useCommandTrigger(triggerCommand);
    // Memoize classes array to prevent recreation
    const classes = useMemo(() => {
        const classList: string[] = ["btn"];

        // Said here because a stylesheet cannot see it: the label is a text node, which no selector
        // reaches, so the spacing meant to part an icon from it has no way of knowing there is none.
        if (icon && (text === undefined || text === null || text === "")) {
            classList.push("tn-icon-only");
        }

        switch(kind) {
            case "primary":
                classList.push("btn-primary");
                break;
            case "lowProfile":
                classList.push("tn-low-profile");
                break;
            default:
                classList.push("btn-secondary");
                break;
        }

        if (className) {
            classList.push(className);
        }
        if (size === "small") {
            classList.push("btn-sm");
        } else if (size === "micro") {
            classList.push("btn-micro");
        }
        return classList.join(" ");
    }, [kind, className, size, icon, text]);

    // Memoize keyboard shortcut rendering
    const shortcutElements = useMemo(() => {
        if (!keyboardShortcut || cachedIsMobile) return null;
        return renderShortcutKbds(keyboardShortcut);
    }, [keyboardShortcut]);

    const button = (
        <button
            name={name}
            className={classes}
            type={onClick || triggerCommand ? "button" : "submit"}
            onClick={onClick ?? triggerOwnCommand}
            ref={buttonRef}
            disabled={disabled}
            style={style}
            {...restProps}
        >
            {icon && <Icon icon={`bx ${icon}`} />}
            {text} {shortcutElements}
        </button>
    );

    if (disabled && disabledTooltip) {
        return <DisabledReason reason={disabledTooltip}>{button}</DisabledReason>;
    }

    return button;
}

/**
 * Carries the tooltip for a disabled control. A disabled `<button>` emits no pointer events, so the
 * explanation for why it is off has to hang off a wrapper the pointer can still reach.
 */
function DisabledReason({ reason, children }: { reason: string; children: ComponentChildren }) {
    const ref = useRef<HTMLSpanElement>(null);

    useStaticTooltip(ref, useMemo<Partial<Tooltip.Options>>(() => ({
        title: reason,
        placement: "top"
    }), [reason]));

    return <span ref={ref} class="tn-disabled-reason">{children}</span>;
}

export function ButtonGroup({ size, className, children }: { size?: "sm" | "lg"; className?: string; children: ComponentChildren }) {
    return (
        <div className={`btn-group ${size ? `btn-group-${size}` : ""} ${className ?? ""}`} role="group">
            {children}
        </div>
    );
}

/** A button with the related actions in a menu beside it. */
export function SplitButton({ text, icon, kind = "secondary", size = "normal", keyboardShortcut, children, ...restProps }: {
    text: string;
    /** The icon's full class, as `"bx bx-search"`. */
    icon?: string;
    kind?: "primary" | "secondary";
    size?: "normal" | "small" | "micro";
    title?: string;
    /** The keys that run the main action, shown after its label as a button shows them. */
    keyboardShortcut?: string;
    /** Click handler for the main button component (not the split). */
    onClick?: () => void;
    /** The menu's rows: `FormListItem`s and the other `FormList` rows. */
    children: ComponentChildren;
}) {
    const look = `btn-${kind}${size === "small" ? " btn-sm" : size === "micro" ? " btn-micro" : ""}`;
    const shortcutElements = !keyboardShortcut || cachedIsMobile ? null : renderShortcutKbds(keyboardShortcut);
    return (
        <ButtonGroup className="tn-split-button" size={size === "small" ? "sm" : undefined}>
            <button type="button" class={`btn ${look}`} {...restProps}>
                {icon && <Icon icon={icon} />}
                {text} {shortcutElements}
            </button>
            <Dropdown
                buttonClassName={`${look} dropdown-toggle-split`}
                buttonProps={{ "aria-label": t("split_button.more_actions") }}
                noSelectButtonStyle
                placement="bottom-end"
                mobileBottomSheet
            >
                {children}
            </Dropdown>
        </ButtonGroup>
    );
}

export function ButtonOrActionButton(props: {
    text: string;
    icon: string;
} & Pick<ButtonProps, "onClick" | "triggerCommand" | "disabled" | "title">) {
    if (isDesktop()) {
        return <Button {...props} />;
    }
    return <ActionButton {...props} />;
}

export default Button;
