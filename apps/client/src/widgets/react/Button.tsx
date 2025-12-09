import type { ComponentChildren, RefObject } from "preact";
import type { CSSProperties } from "preact/compat";
import { useMemo } from "preact/hooks";
import { memo } from "preact/compat";
import { CommandNames } from "../../components/app_context";
import Icon from "./Icon";

export interface ButtonProps {
    name?: string;
    /** Reference to the button element. Mostly useful for requesting focus. */
    buttonRef?: RefObject<HTMLButtonElement>;
    text: string;
    className?: string;
    icon?: string;
    keyboardShortcut?: string;
    /** Called when the button is clicked. If not set, the button will submit the form (if any). */
    onClick?: () => void;
    primary?: boolean;
    disabled?: boolean;
    size?: "normal" | "small" | "micro";
    style?: CSSProperties;
    triggerCommand?: CommandNames;
    title?: string;
}

const Button = memo(({ name, buttonRef, className, text, onClick, keyboardShortcut, icon, primary, disabled, size, style, triggerCommand, ...restProps }: ButtonProps) => {
    // Memoize classes array to prevent recreation
    const classes = useMemo(() => {
        const classList: string[] = ["btn"];
        if (primary) {
            classList.push("btn-primary");
        } else {
            classList.push("btn-secondary");
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
    }, [primary, className, size]);

    // Memoize keyboard shortcut rendering
    const shortcutElements = useMemo(() => {
        if (!keyboardShortcut) return null;
        const splitShortcut = keyboardShortcut.split("+");
        return splitShortcut.map((key, index) => (
            <>
                <kbd key={index}>{key.toUpperCase()}</kbd>
                {index < splitShortcut.length - 1 ? "+" : ""}
            </>
        ));
    }, [keyboardShortcut]);

    return (
        <button
            name={name}
            className={classes}
            type={onClick || triggerCommand ? "button" : "submit"}
            onClick={onClick}
            ref={buttonRef}
            disabled={disabled}
            style={style}
            data-trigger-command={triggerCommand}
            {...restProps}
        >
            {icon && <Icon icon={`bx ${icon}`} />}
            {text} {shortcutElements}
        </button>
    );
});

export function ButtonGroup({ children }: { children: ComponentChildren }) {
    return (
        <div className="btn-group" role="group">
            {children}
        </div>
    )
}

export function SplitButton({ text, icon, children, ...restProps }: {
    text: string;
    icon?: string;
    title?: string;
    /** Click handler for the main button component (not the split). */
    onClick?: () => void;
    /** The children inside the dropdown of the split. */
    children: ComponentChildren;
}) {
    return (
        <ButtonGroup>
            <button type="button" class="btn btn-secondary" {...restProps}>
                {icon && <Icon icon={`bx ${icon}`} />}
                {text}
            </button>
            <button type="button" class="btn btn-secondary dropdown-toggle dropdown-toggle-split" data-bs-toggle="dropdown" aria-expanded="false">
                <span class="visually-hidden">Toggle Dropdown</span>
            </button>
            <ul class="dropdown-menu">
                {children}
            </ul>
        </ButtonGroup>
    )
}

export default Button;
