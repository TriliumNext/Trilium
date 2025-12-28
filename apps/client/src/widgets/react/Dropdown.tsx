import { Dropdown as BootstrapDropdown, Tooltip } from "bootstrap";
import { ComponentChildren, HTMLAttributes } from "preact";
import { CSSProperties, HTMLProps } from "preact/compat";
import { MutableRef, useCallback, useEffect, useRef, useState } from "preact/hooks";

import { useTooltip, useUniqueName } from "./hooks";

type DataAttributes = {
    [key: `data-${string}`]: string | number | boolean | undefined;
};

export interface DropdownProps extends Pick<HTMLProps<HTMLDivElement>, "id" | "className"> {
    buttonClassName?: string;
    buttonProps?: Partial<HTMLAttributes<HTMLButtonElement> & DataAttributes>;
    isStatic?: boolean;
    children: ComponentChildren;
    title?: string;
    dropdownContainerStyle?: CSSProperties;
    dropdownContainerClassName?: string;
    dropdownContainerRef?: MutableRef<HTMLDivElement | null>;
    hideToggleArrow?: boolean;
    /** If set to true, then the dropdown button will be considered an icon action (without normal border and sized for icons only). */
    iconAction?: boolean;
    noSelectButtonStyle?: boolean;
    noDropdownListStyle?: boolean;
    disabled?: boolean;
    text?: ComponentChildren;
    forceShown?: boolean;
    onShown?: () => void;
    onHidden?: () => void;
    dropdownOptions?: Partial<BootstrapDropdown.Options>;
    dropdownRef?: MutableRef<BootstrapDropdown | null>;
    titlePosition?: "top" | "right" | "bottom" | "left";
    titleOptions?: Partial<Tooltip.Options>;
}

export default function Dropdown({ id, className, buttonClassName, isStatic, children, title, text, dropdownContainerStyle, dropdownContainerClassName, dropdownContainerRef: externalContainerRef, hideToggleArrow, iconAction, disabled, noSelectButtonStyle, noDropdownListStyle, forceShown, onShown: externalOnShown, onHidden: externalOnHidden, dropdownOptions, buttonProps, dropdownRef, titlePosition, titleOptions }: DropdownProps) {
    const containerRef = useRef<HTMLDivElement | null>(null);
    const triggerRef = useRef<HTMLButtonElement | null>(null);
    const dropdownContainerRef = useRef<HTMLUListElement | null>(null);

    const { showTooltip, hideTooltip } = useTooltip(containerRef, {
        ...titleOptions,
        placement: titlePosition ?? "bottom",
        fallbackPlacements: [ titlePosition ?? "bottom" ],
        trigger: "manual"
    });

    const [ shown, setShown ] = useState(false);

    useEffect(() => {
        if (!triggerRef.current || !dropdownContainerRef.current) return;

        const dropdown = BootstrapDropdown.getOrCreateInstance(triggerRef.current, dropdownOptions);
        if (dropdownRef) {
            dropdownRef.current = dropdown;
        }
        if (forceShown) {
            dropdown.show();
            setShown(true);
        }

        // React to popup container size changes, which can affect the positioning.
        const resizeObserver = new ResizeObserver(() => dropdown.update());
        resizeObserver.observe(dropdownContainerRef.current);

        return () => {
            resizeObserver.disconnect();
            dropdown.dispose();
        };
    }, []);

    const onShown = useCallback(() => {
        setShown(true);
        externalOnShown?.();
        hideTooltip();
    }, [ hideTooltip ]);

    const onHidden = useCallback(() => {
        setShown(false);
        externalOnHidden?.();
    }, []);

    useEffect(() => {
        if (!containerRef.current) return;
        if (externalContainerRef) externalContainerRef.current = containerRef.current;

        const $dropdown = $(containerRef.current);
        $dropdown.on("show.bs.dropdown", (e) => {
            // Stop propagation causing multiple shows for nested dropdowns.
            e.stopPropagation();
            onShown();
        });
        $dropdown.on("hide.bs.dropdown", (e) => {
            // Stop propagation causing multiple hides for nested dropdowns.
            e.stopPropagation();
            onHidden();
        });

        // Add proper cleanup
        return () => {
            $dropdown.off("show.bs.dropdown", onShown);
            $dropdown.off("hide.bs.dropdown", onHidden);
        };
    }, [ onShown, onHidden ]);

    const ariaId = useUniqueName("button");

    return (
        <div ref={containerRef} class={`dropdown ${className ?? ""}`} style={{ display: "flex" }} title={title}>
            <button
                className={`${iconAction ? "icon-action" : "btn"} ${!noSelectButtonStyle ? "select-button" : ""} ${buttonClassName ?? ""} ${!hideToggleArrow ? "dropdown-toggle" : ""}`}
                ref={triggerRef}
                type="button"
                data-bs-toggle="dropdown"
                data-bs-display={ isStatic ? "static" : undefined }
                aria-haspopup="true"
                aria-expanded="false"
                id={id ?? ariaId}
                disabled={disabled}
                onMouseEnter={showTooltip}
                onMouseLeave={hideTooltip}
                {...buttonProps}
            >
                {text}
                <span className="caret" />
            </button>

            <ul
                class={`dropdown-menu tn-dropdown-menu ${isStatic ? "static" : ""} ${dropdownContainerClassName ?? ""} ${!noDropdownListStyle ? "tn-dropdown-list" : ""}`}
                style={dropdownContainerStyle}
                aria-labelledby={ariaId}
                ref={dropdownContainerRef}
                onClick={(e) => {
                    // Prevent clicks directly inside the dropdown from closing.
                    if (e.target === dropdownContainerRef.current) {
                        e.stopPropagation();
                    }
                }}
            >
                {shown && children}
            </ul>
        </div>
    );
}
