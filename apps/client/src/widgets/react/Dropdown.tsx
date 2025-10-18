import { Dropdown as BootstrapDropdown } from "bootstrap";
import { ComponentChildren } from "preact";
import { CSSProperties, HTMLProps } from "preact/compat";
import { useCallback, useEffect, useRef, useState } from "preact/hooks";
import { useUniqueName } from "./hooks";

export interface DropdownProps extends Pick<HTMLProps<HTMLDivElement>, "id" | "className"> {
    buttonClassName?: string;
    isStatic?: boolean;
    children: ComponentChildren;
    title?: string;
    dropdownContainerStyle?: CSSProperties;
    dropdownContainerClassName?: string;
    hideToggleArrow?: boolean;
    /** If set to true, then the dropdown button will be considered an icon action (without normal border and sized for icons only). */
    iconAction?: boolean;
    noSelectButtonStyle?: boolean;
    noDropdownListStyle?: boolean;
    disabled?: boolean;
    text?: ComponentChildren;
    forceShown?: boolean;
}

export default function Dropdown({ id, className, buttonClassName, isStatic, children, title, text, dropdownContainerStyle, dropdownContainerClassName, hideToggleArrow, iconAction, disabled, noSelectButtonStyle, noDropdownListStyle, forceShown }: DropdownProps) {
    const dropdownRef = useRef<HTMLDivElement | null>(null);
    const triggerRef = useRef<HTMLButtonElement | null>(null);

    const [ shown, setShown ] = useState(false);

    useEffect(() => {
        if (!triggerRef.current) return;

        const dropdown = BootstrapDropdown.getOrCreateInstance(triggerRef.current);
        if (forceShown) {
            dropdown.show();
            setShown(true);
        }
        return () => dropdown.dispose();
    }, []);

    const onShown = useCallback(() => {
        setShown(true);
    }, [])

    const onHidden = useCallback(() => {
        setShown(false);
    }, []);

    useEffect(() => {
        if (!dropdownRef.current) return;

        const $dropdown = $(dropdownRef.current);
        $dropdown.on("show.bs.dropdown", onShown);
        $dropdown.on("hide.bs.dropdown", onHidden);

        // Add proper cleanup
        return () => {
            $dropdown.off("show.bs.dropdown", onShown);
            $dropdown.off("hide.bs.dropdown", onHidden);
        };
    }, []); // Add dependency array

    const ariaId = useUniqueName("button");

    return (
        <div ref={dropdownRef} class={`dropdown ${className ?? ""}`} style={{ display: "flex" }}>
            <button
                className={`${iconAction ? "icon-action" : "btn"} ${!noSelectButtonStyle ? "select-button" : ""} ${buttonClassName ?? ""} ${!hideToggleArrow ? "dropdown-toggle" : ""}`}
                ref={triggerRef}
                type="button"
                data-bs-toggle="dropdown"
                data-bs-display={ isStatic ? "static" : undefined }
                aria-haspopup="true"
                aria-expanded="false"
                title={title}
                id={id ?? ariaId}
                disabled={disabled}
            >
                {text}
                <span className="caret"></span>
            </button>

            <ul
                class={`dropdown-menu ${isStatic ? "static" : ""} ${dropdownContainerClassName ?? ""} ${!noDropdownListStyle ? "tn-dropdown-list" : ""}`}
                style={dropdownContainerStyle}
                aria-labelledby={ariaId}
            >
                {shown && children}
            </ul>
        </div>
    )
}
