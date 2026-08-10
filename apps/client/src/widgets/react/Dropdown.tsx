import { Dropdown as BootstrapDropdown, Tooltip } from "bootstrap";
import { ComponentChildren, HTMLAttributes } from "preact";
import { createPortal, CSSProperties, HTMLProps } from "preact/compat";
import { MutableRef, useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from "preact/hooks";

import { isMobile } from "../../services/utils";
import { useTooltip, useUniqueName } from "./hooks";
import { suspendModalFocusTraps } from "./modal_focustrap";

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
    /**
     * Drop the `tn-dropdown-list` class the menu otherwise carries by default.
     *
     * That class exists for **scrollable** menus: it moves the theme's backdrop blur off the menu's
     * `::before` layer — which a scrollable menu would scroll away with its content — and onto the
     * menu element itself. The element-level filter is the fragile one, though: opened over note
     * content it blurs nothing at all, leaving the menu merely translucent and reading as
     * see-through over anything dark.
     *
     * So set this on any menu that doesn't scroll (i.e. nearly every action menu) to keep it on the
     * working pseudo-element layer.
     */
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
    /**
     * On a phone, show the menu as a sheet rising from the bottom of the screen over a dimmed page,
     * the way the app's other mobile menus appear. No effect on a desktop layout.
     *
     * Prefer this to setting the pieces by hand. A menu left to place itself on mobile lands as a
     * narrow box adrift in the middle of the page — Popper computes an offset that the app's own
     * `body.mobile .dropdown-menu { position: fixed }` then measures from somewhere else — and one
     * opened inside a dialog needs {@link portalToBody} besides, since a transformed `.modal-dialog`
     * is both the box a fixed menu is placed against and a stacking context the backdrop, painting
     * above the whole modal, would otherwise dim the menu through.
     */
    mobileBottomSheet?: boolean;
}

export default function Dropdown({ id, className, buttonClassName, isStatic, children, title, text, dropdownContainerStyle, dropdownContainerClassName, dropdownContainerRef: externalContainerRef, hideToggleArrow, iconAction, disabled, noSelectButtonStyle, noDropdownListStyle, forceShown, onShown: externalOnShown, onHidden: externalOnHidden, dropdownOptions, buttonProps, dropdownRef, titlePosition, titleOptions, mobileBackdrop: mobileBackdropProp, portalToBody: portalToBodyProp, mobileBottomSheet }: DropdownProps) {
    // The sheet is three things at once — placed by the app's own rule, dimming what is behind it,
    // and lifted out of whatever opened it — so it is asked for as one thing and unpacked here.
    const bottomSheet = !!mobileBottomSheet && isMobile();
    const mobileBackdrop = mobileBackdropProp || bottomSheet;
    const portalToBody = portalToBodyProp || bottomSheet;

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
        fallbackPlacements: [ titlePosition ?? "bottom" ]
    }), [title, titleOptions, titlePosition]);
    const [ shown, setShown ] = useState(false);
    // On the wrapper, not on the toggle: Bootstrap keeps one component instance per element and the toggle
    // is already the dropdown's own, so a tooltip put there is refused registration and can never be
    // disposed — it goes on showing its title with nothing left to take it down.
    //
    // Triggering is Bootstrap's, though, rather than driven from the toggle's mouseenter/mouseleave as it
    // once was: only Bootstrap's own listeners keep the hover state it decides by, and a tooltip shown
    // around it is liable to be taken away again under the pointer. What that arrangement was for — the
    // wrapper holding the open menu too, so the title hung over the menu the pointer had moved into — is
    // answered by silencing the tooltip for as long as the menu is up.
    const { hideTooltip } = useTooltip(containerRef, tooltipConfig, !shown);

    // A portaled menu lives in `document.body`, detached from the toggle's subtree. Mounting it eagerly
    // for every instance leaves an empty menu wrapper in the body for every note context/tab, so only
    // mount it while it's actually needed: open (`shown`), about to open (`armed` — set on interaction
    // with the toggle, see the button handlers below), or forced open. Non-portaled menus stay inline
    // next to the toggle and are always mounted, as before.
    const [ armed, setArmed ] = useState(false);
    const menuMounted = !portalToBody || shown || armed || !!forceShown;
    const dropdownInstanceRef = useRef<BootstrapDropdown | null>(null);

    // Create/wire the Bootstrap dropdown. Re-runs whenever the (portaled) menu remounts so `_menu` gets
    // re-pointed at the fresh element. useLayoutEffect so the wiring lands synchronously after the
    // interaction that mounts the menu but before Bootstrap's click handler opens it.
    useLayoutEffect(() => {
        if (!triggerRef.current) return;

        const dropdown = BootstrapDropdown.getOrCreateInstance(triggerRef.current, dropdownOptions);
        dropdownInstanceRef.current = dropdown;
        if (dropdownRef) {
            dropdownRef.current = dropdown;
        }

        // When the menu is portaled to `document.body` it is no longer a sibling of the toggle, so
        // Bootstrap fails to locate it (it searches the toggle's wrapper). Wire it up by hand —
        // Bootstrap only ever positions/toggles whatever `_menu` points at, regardless of where it
        // lives in the DOM, and the popper reference stays the toggle button.
        if (portalToBody && dropdownContainerRef.current) {
            (dropdown as unknown as { _menu: HTMLElement })._menu = dropdownContainerRef.current;
        }

        // React to popup container size changes, which can affect the positioning.
        let resizeObserver: ResizeObserver | undefined;
        if (dropdownContainerRef.current) {
            resizeObserver = new ResizeObserver(() => dropdown.update());
            resizeObserver.observe(dropdownContainerRef.current);
        }

        return () => resizeObserver?.disconnect();
    }, [ menuMounted ]);

    // Show a forced-open dropdown once mounted, and dispose the instance only when the component truly
    // unmounts (not on every menu remount driven by the effect above).
    useEffect(() => {
        if (forceShown) {
            dropdownInstanceRef.current?.show();
            setShown(true);
        }
        return () => {
            dropdownInstanceRef.current?.dispose();
            dropdownInstanceRef.current = null;
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
        setArmed(false);
        externalOnHidden?.();
        if (mobileBackdrop && isMobile()) {
            document.getElementById("context-menu-cover")?.classList.remove("show", "global-menu-cover");
        }
    }, [ mobileBackdrop ]);

    // A portaled menu lives in `document.body`, outside any modal that opened it. That modal's focus-trap
    // would keep yanking focus back into the modal, so an input in the menu (e.g. the note-icon picker's
    // search box) could never hold focus. Suspend the shown modals' traps while the menu is open.
    useEffect(() => {
        if (!portalToBody || !shown) return;
        return suspendModalFocusTraps();
    }, [ portalToBody, shown ]);

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
            class={`dropdown-menu tn-dropdown-menu ${isStatic ? "static" : ""} ${dropdownContainerClassName ?? ""} ${bottomSheet ? "mobile-bottom-menu" : ""} ${!noDropdownListStyle ? "tn-dropdown-list" : ""}`}
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
        // `title` stands in only for the moment before the tooltip is wired: Bootstrap moves the
        // attribute into the tooltip and drops it, so the browser's own doesn't double up with ours.
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
                // Mount the portaled menu just before it can open: any interaction that leads to a
                // Bootstrap open (pointer press, or focusing the toggle ahead of a keyboard open) is
                // preceded by one of these, so `_menu` is wired by the time the click/keydown fires.
                // Releasing focus without opening tears the empty menu back down.
                onPointerDown={portalToBody ? () => setArmed(true) : undefined}
                onFocus={portalToBody ? () => setArmed(true) : undefined}
                onBlur={portalToBody ? () => { if (!shown) setArmed(false); } : undefined}
                {...buttonProps}
            >
                {text}
                <span className="caret" />
            </button>

            {portalToBody
                // Keep the `className` scope on the portaled wrapper so CSS scoped under it (e.g.
                // `.note-icon-widget .icon-list`) still applies even though the menu now lives in body.
                // Only mount it while needed (see `menuMounted`) so closed pickers don't each leave an
                // empty menu wrapper in the body.
                ? (menuMounted && createPortal(<div class={className ?? ""}>{menu}</div>, document.body))
                : menu}
        </div>
    );
}
