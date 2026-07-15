import { Dropdown as BootstrapDropdown, Tooltip } from "bootstrap";
import { ComponentChildren, HTMLAttributes } from "preact";
import { createPortal, CSSProperties, HTMLProps } from "preact/compat";
import { MutableRef, useCallback, useEffect, useMemo, useRef, useState } from "preact/hooks";

import { isMobile } from "../../services/utils";
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
    mobileBackdrop?: boolean;
    /**
     * Render the dropdown menu into `document.body` instead of nesting it next to the toggle.
     *
     * Use this when an ancestor establishes a containment/backdrop root (e.g. `container-type`,
     * `transform`, `filter`) which would otherwise flatten the menu's `backdrop-filter` blur into a
     * flat tint. The menu is wrapped in a `<div class={className}>` so any CSS scoped under that
     * class keeps applying even though the menu no longer lives inside the toggle's wrapper.
     */
    portalToBody?: boolean;
}

export default function Dropdown({ id, className, buttonClassName, isStatic, children, title, text, dropdownContainerStyle, dropdownContainerClassName, dropdownContainerRef: externalContainerRef, hideToggleArrow, iconAction, disabled, noSelectButtonStyle, noDropdownListStyle, forceShown, onShown: externalOnShown, onHidden: externalOnHidden, dropdownOptions, buttonProps, dropdownRef, titlePosition, titleOptions, mobileBackdrop, portalToBody }: DropdownProps) {
    const containerRef = useRef<HTMLDivElement | null>(null);
    const triggerRef = useRef<HTMLButtonElement | null>(null);
    const dropdownContainerRef = useRef<HTMLUListElement | null>(null);

    // Memoized so useTooltip's effect (keyed on config identity) doesn't dispose and recreate the
    // Bootstrap tooltip on every re-render — only when the title (or positioning) actually changes.
    const tooltipConfig = useMemo<Partial<Tooltip.Options>>(() => ({
        ...titleOptions,
        // Drive the tooltip from config, not just the `title` attribute: Bootstrap reads the attribute once
        // on init, so a dynamic title (e.g. the media play-mode button) would otherwise go stale (`title` is
        // a dependency of this memo, so a change recreates the tooltip, keeping it in sync). Prefer the
        // `title` prop, then a `titleOptions.title` escape-hatch, then "" (Bootstrap rejects `undefined`;
        // "" shows no tooltip).
        title: title ?? titleOptions?.title ?? "",
        placement: titlePosition ?? "bottom",
        fallbackPlacements: [ titlePosition ?? "bottom" ],
        trigger: "manual"
    }), [title, titleOptions, titlePosition]);
    const { showTooltip, hideTooltip } = useTooltip(containerRef, tooltipConfig);

    const [ shown, setShown ] = useState(false);

    useEffect(() => {
        if (!triggerRef.current || !dropdownContainerRef.current) return;

        const dropdown = BootstrapDropdown.getOrCreateInstance(triggerRef.current, dropdownOptions);

        // When the menu is portaled to `document.body` it is no longer a sibling of the toggle, so
        // Bootstrap fails to locate it (it searches the toggle's wrapper). Wire it up by hand —
        // Bootstrap only ever positions/toggles whatever `_menu` points at, regardless of where it
        // lives in the DOM, and the popper reference stays the toggle button.
        if (portalToBody && dropdownContainerRef.current) {
            (dropdown as unknown as { _menu: HTMLElement })._menu = dropdownContainerRef.current;
        }

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
        if (mobileBackdrop && isMobile()) {
            document.getElementById("context-menu-cover")?.classList.add("show", "global-menu-cover");
        }
    }, [ hideTooltip, mobileBackdrop ]);

    const onHidden = useCallback(() => {
        setShown(false);
        externalOnHidden?.();
        if (mobileBackdrop && isMobile()) {
            document.getElementById("context-menu-cover")?.classList.remove("show", "global-menu-cover");
        }
    }, [ mobileBackdrop ]);

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

    const menu = (
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
    );

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

            {portalToBody
                // Keep the `className` scope on the portaled wrapper so CSS scoped under it (e.g.
                // `.note-icon-widget .icon-list`) still applies even though the menu now lives in body.
                ? createPortal(<div class={className ?? ""}>{menu}</div>, document.body)
                : menu}
        </div>
    );
}
