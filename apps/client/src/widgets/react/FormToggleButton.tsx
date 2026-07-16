import clsx from "clsx";
import type { ComponentChildren } from "preact";

import Icon from "./Icon";

interface FormToggleButtonProps {
    /** Content shown inside the button. */
    label: string | ComponentChildren;
    /** Optional Boxicons icon name (e.g. `bx-check`) shown before the label. */
    icon?: string;
    currentValue: boolean;
    onChange(newValue: boolean): void;
    /** Button style, mirroring {@link Button}. Defaults to `primary`. */
    kind?: "primary" | "secondary";
    size?: "normal" | "small" | "micro";
    disabled?: boolean;
    title?: string;
    className?: string;
}

/**
 * A checkbox rendered as a pill button (pressed = on), consistent with Trilium's theme.
 *
 * Uses the same `btn`/`btn-primary`/`btn-secondary` + `active` classes as {@link Button} and the existing
 * in-repo toggle buttons (e.g. `ThemeModeSelector`) rather than Bootstrap's `btn-check`, which is not
 * styled in Trilium's theme. Accessibility is conveyed via `aria-pressed`.
 */
export default function FormToggleButton({ label, icon, currentValue, onChange, kind = "primary", size, disabled, title, className }: FormToggleButtonProps) {
    return (
        <button
            type="button"
            className={clsx("btn", kind === "secondary" ? "btn-secondary" : "btn-primary", {
                "active": currentValue,
                "btn-sm": size === "small",
                "btn-micro": size === "micro"
            }, className)}
            aria-pressed={currentValue}
            disabled={disabled}
            title={title}
            onClick={() => onChange(!currentValue)}
        >
            {icon && <Icon icon={`bx ${icon}`} />}
            {label}
        </button>
    );
}
