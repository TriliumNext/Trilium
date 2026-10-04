import type { Placement } from "@floating-ui/dom";
import type { Tooltip } from "bootstrap";
import clsx from "clsx";
import { ComponentChildren, HTMLAttributes } from "preact";
import { CSSProperties, HTMLProps } from "preact/compat";
import { MutableRef, useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from "preact/hooks";

import { isMobile, isNarrowLayout, onNarrowLayoutChange } from "../../services/utils";
import { focusListItem } from "./FormList";
import { useTooltip, useUniqueName } from "./hooks";
import { suspendModalFocusTraps } from "./modal_focustrap";
import Menu from "./Menu";
import Popup, { type PopupProps } from "./Popup";

type DataAttributes = {
    [key: `data-${string}`]: string | number | boolean | undefined;
};

export interface DropdownProps extends Pick<HTMLProps<HTMLDivElement>, "id" | "className"> {
    buttonClassName?: string;
    buttonProps?: Partial<HTMLAttributes<HTMLButtonElement> & DataAttributes>;
    children: ComponentChildren;
    title?: string;
    dropdownContainerStyle?: CSSProperties;
    dropdownContainerClassName?: string;
    dropdownContainerRef?: MutableRef<HTMLDivElement | null>;
    hideToggleArrow?: boolean;
    /** If set to true, then the dropdown button will be considered an icon action (without normal border and sized for icons only). */
    iconAction?: boolean;
    noSelectButtonStyle?: boolean;
    /** Disables the toggle, and closes the popup if it is open. */
    disabled?: boolean;
    text?: ComponentChildren;
    onShown?: () => void;
    onHidden?: () => void;
    /** The side of the toggle the popup prefers; it flips to the other near the viewport's edge. */
    placement?: Placement;
    /**
     * What closes the popup besides Escape and the toggle: `true` a click inside and a press
     * outside, `"inside"` or `"outside"` that one alone, `false` neither. A row that stops its click
     * keeps a menu open whatever this says.
     */
    autoClose?: boolean | "inside" | "outside";
    dropdownRef?: MutableRef<DropdownHandle | null>;
    titlePosition?: "top" | "right" | "bottom" | "left";
    titleOptions?: Partial<Tooltip.Options>;
    mobileBackdrop?: boolean;
    /**
     * On a phone, shows the popup as a sheet rising from the bottom of the screen over a dimmed
     * page, the way the app's other mobile menus appear. On a tablet's wider mobile layout, the
     * popup opens beside its toggle over the dimmed page instead. No effect on a desktop layout.
     */
    mobileBottomSheet?: boolean;
    /**
     * Dims the page behind the popup on any screen, for one that is a task of its own rather than
     * a list of actions: the icon picker, which holds a search field and a grid of a thousand
     * icons. Drawn in the popup's portal, immediately before it.
     */
    backdrop?: boolean;
}

export interface DropdownPanelProps extends DropdownProps {
    /**
     * Caps the panel to the room beside its toggle and scrolls its content inside it, for content
     * that can outgrow the screen. The panel's frame stays put, so the theme's blur on its
     * `::before` covers it whatever the content scrolls to.
     */
    scrollable?: boolean;
}

/** Opens and closes a dropdown from outside it, for a caller that decides when. */
export interface DropdownHandle {
    show(): void;
    hide(): void;
    toggle(): void;
}

/** The gap, in pixels, between the toggle and its popup, as Bootstrap's dropdowns kept. */
const TOGGLE_GAP = 2;

/**
 * A menu under a toggle: its rows are `FormListItem`s and the other `FormList` rows, which the
 * menu's keys move between. For anything else, such as a picker or a form, use {@link DropdownPanel}.
 */
export default function Dropdown(props: DropdownProps) {
    return (
        <DropdownToggle
            {...props}
            hasPopup="menu"
            popup={({ popupProps, className, bottomSheet, startAt, isWanted, dismiss, close }) => (
                <Menu
                    {...popupProps}
                    className={className}
                    bottomSheet={bottomSheet}
                    startAt={startAt}
                    isWanted={isWanted}
                    onDismiss={() => dismiss("outside")}
                    onClose={close}
                >
                    {props.children}
                </Menu>
            )}
        />
    );
}

/**
 * A popup under a toggle for content other than a menu's rows, such as a picker, a form or a
 * list of links. Its fields keep their keys; Up and Down move between its `.dropdown-item`s.
 */
export function DropdownPanel({ scrollable, ...props }: DropdownPanelProps) {
    return (
        <DropdownToggle
            {...props}
            hasPopup="true"
            onToggleArrow={(popup, edge) => focusListItem(popup, edge)}
            popup={({ popupProps, className, bottomSheet, startAt, dismiss }) => (
                <PanelPopup
                    {...popupProps}
                    // Otherwise it grows with its content, as Bootstrap's dropdowns did.
                    capHeight={!!scrollable}
                    placedByStylesheet={bottomSheet}
                    className={clsx("dropdown-menu show", className, bottomSheet && "mobile-bottom-menu")}
                    startAt={startAt}
                    onDismiss={dismiss}
                >
                    {scrollable
                        ? <div className="tn-panel-scroll">{props.children}</div>
                        : props.children}
                </PanelPopup>
            )}
        />
    );
}

/** What {@link DropdownToggle} hands the popup it draws. */
interface PopupSlot {
    /** Placement, portal, backdrop and click handling, for the `Popup` or `Menu`. */
    popupProps: Pick<PopupProps, "anchor" | "placement" | "offset" | "portalClassName" | "backdropClassName"
        | "elementRef" | "style" | "aria-labelledby" | "onClick">;
    className: string;
    bottomSheet: boolean;
    /** The item to start at, for a popup a key on the toggle opened. */
    startAt: "first" | "last" | undefined;
    isWanted(): boolean;
    /** Closes it for a press outside or Escape, as `autoClose` allows. */
    dismiss(reason: "outside" | "escape"): void;
    close(): void;
}

/**
 * The toggle both kinds of dropdown share: the button, its tooltip, the open state and its
 * callbacks, the handle, and the phone's cover. `popup` draws what opens under it.
 */
function DropdownToggle({ id, className, buttonClassName, title, text, dropdownContainerStyle, dropdownContainerClassName, dropdownContainerRef: externalContainerRef, hideToggleArrow, iconAction, disabled, noSelectButtonStyle, onShown, onHidden, placement, autoClose = true, buttonProps, dropdownRef, titlePosition, titleOptions, mobileBackdrop: mobileBackdropProp, mobileBottomSheet, backdrop, hasPopup, onToggleArrow, popup }: Omit<DropdownProps, "children"> & {
    hasPopup: "menu" | "true";
    /** Called for Up or Down on the toggle while the popup is up. */
    onToggleArrow?(popup: HTMLElement, edge: "first" | "last"): void;
    popup(slot: PopupSlot): ComponentChildren;
}) {
    // The sheet is placed by the app's own rule and dims what is behind it, so it is asked for as
    // one thing and unpacked here. It follows the layout, as a tablet can turn while it is open.
    const followsLayout = !!mobileBottomSheet && isMobile();
    const [ narrow, setNarrow ] = useState(isNarrowLayout);
    useEffect(() => {
        if (!followsLayout) return;
        setNarrow(isNarrowLayout());
        return onNarrowLayoutChange(() => setNarrow(isNarrowLayout()));
    }, [ followsLayout ]);
    const bottomSheet = followsLayout && narrow;
    const mobileBackdrop = (!!mobileBackdropProp || !!mobileBottomSheet) && isMobile();
    const containerRef = useRef<HTMLDivElement | null>(null);
    const triggerRef = useRef<HTMLButtonElement | null>(null);
    const popupRef = useRef<HTMLDivElement | null>(null);
    const [ shown, setShown ] = useState(false);
    /** The item to start at once the popup shows, for a popup a key on the toggle opened. */
    const [ startAt, setStartAt ] = useState<"first" | "last">();

    // Memoized so useTooltip's effect (keyed on config identity) doesn't dispose and recreate the
    // Bootstrap tooltip on every re-render — only when the title (or positioning) actually changes.
    const tooltipConfig = useMemo<Partial<Tooltip.Options>>(() => ({
        ...titleOptions,
        // Bootstrap reads the `title` attribute once, so a dynamic title is driven from config.
        // Bootstrap rejects `undefined`; "" shows no tooltip.
        title: title ?? titleOptions?.title ?? "",
        placement: titlePosition ?? "bottom",
        fallbackPlacements: [ titlePosition ?? "bottom" ]
    }), [ title, titleOptions, titlePosition ]);
    // On the wrapper, and silenced while the popup is up, so the title does not hang over it.
    const { hideTooltip } = useTooltip(containerRef, tooltipConfig, !shown);

    // Every open and close goes through here, which says so at once, as Bootstrap's events did
    // within the press: a caller holding something open for the menu's sake, such as the board's
    // card editor, must know before the focus the press moves reaches it.
    const shownRef = useRef(shown);
    const callbacks = useRef({ onShown, onHidden, hideTooltip });
    callbacks.current = { onShown, onHidden, hideTooltip };
    const setOpen = useCallback((open: boolean) => {
        if (shownRef.current === open) return;
        shownRef.current = open;
        // Focus that the popup holds goes back to the toggle, as a native menu button's does; a
        // command that moved it elsewhere keeps it there.
        if (!open && popupRef.current?.contains(document.activeElement)) triggerRef.current?.focus();
        if (!open) setStartAt(undefined);
        setShown(open);
        if (open) {
            callbacks.current.hideTooltip();
            callbacks.current.onShown?.();
        } else {
            callbacks.current.onHidden?.();
        }
    }, []);

    useLayoutEffect(() => {
        if (externalContainerRef) externalContainerRef.current = containerRef.current;
    }, [ externalContainerRef ]);

    useLayoutEffect(() => {
        if (!dropdownRef) return;
        dropdownRef.current = {
            show: () => setOpen(true),
            hide: () => setOpen(false),
            toggle: () => setOpen(!shownRef.current)
        };
    }, [ dropdownRef ]);

    // A disabled toggle cannot be pressed to close its popup, so disabling it closes the popup.
    useLayoutEffect(() => {
        if (disabled) setOpen(false);
    }, [ disabled ]);

    // The popup anchors to `triggerRef`, which is empty during the first render, so a dropdown shown
    // from the start renders again once the toggle is mounted, before the browser paints.
    const [ , setTriggerMounted ] = useState(false);
    useLayoutEffect(() => {
        if (shownRef.current) setTriggerMounted(true);
    }, []);

    // On a phone the shell's cover dims the page under the popup; a tap on it closes the popup,
    // being one outside it.
    useEffect(() => {
        if (!shown || !mobileBackdrop) return;
        const cover = document.getElementById("context-menu-cover");
        cover?.classList.add("show", "global-menu-cover");
        return () => cover?.classList.remove("show", "global-menu-cover");
    }, [ shown, mobileBackdrop ]);

    // A dialog's focus trap would pull focus out of a popup that stands outside the dialog.
    useLayoutEffect(() => {
        if (!shown) return;
        return suspendModalFocusTraps();
    }, [ shown ]);

    const ariaId = useUniqueName("button");
    const toggleId = id ?? ariaId;

    /** Closes it on a click inside, as Bootstrap's `autoClose` did, for content that is no row of a menu. */
    function closeOnClickInside(e: MouseEvent) {
        if (autoClose === "outside" || autoClose === false) return;
        const target = e.target as Element;
        // Neither the menu's own padding nor a field in it closes it.
        if (target === e.currentTarget || /input|select|option|textarea|form/i.test(target.tagName)) return;
        setOpen(false);
    }

    return (
        // `title` stands in only for the moment before the tooltip is wired: Bootstrap moves the
        // attribute into the tooltip and drops it, so the browser's own doesn't double up with ours.
        <div ref={containerRef} class={`dropdown ${className ?? ""}`} style={{ display: "flex" }} title={title}>
            <button
                {...buttonProps}
                className={clsx(
                    iconAction ? "icon-action" : "btn",
                    !noSelectButtonStyle && "select-button",
                    buttonClassName,
                    !hideToggleArrow && "dropdown-toggle",
                    shown && "show"
                )}
                ref={triggerRef}
                type="button"
                aria-haspopup={hasPopup}
                aria-expanded={shown}
                id={toggleId}
                disabled={disabled}
                onClick={(e) => {
                    buttonProps?.onClick?.(e);
                    setOpen(!shownRef.current);
                }}
                // Up or Down on the toggle opens the popup at its first or last item.
                onKeyDown={(e) => {
                    buttonProps?.onKeyDown?.(e);
                    if (e.key !== "ArrowDown" && e.key !== "ArrowUp") return;
                    e.preventDefault();
                    const edge = e.key === "ArrowDown" ? "first" : "last";
                    if (shown) {
                        if (popupRef.current) onToggleArrow?.(popupRef.current, edge);
                    } else {
                        setStartAt(edge);
                        setOpen(true);
                    }
                }}
            >
                {text}
                <span className="caret" />
            </button>

            {shown && triggerRef.current && popup({
                popupProps: {
                    anchor: triggerRef.current,
                    placement,
                    offset: TOGGLE_GAP,
                    // In a wrapper with the dropdown's classes, so CSS scoped under them still
                    // applies to the popup in the page's body. style.css stacks a portaled popup by
                    // `tn-dropdown-portal`, and its backdrop just under it.
                    portalClassName: clsx("tn-dropdown-portal", className),
                    backdropClassName: backdrop ? "tn-dropdown-backdrop" : undefined,
                    elementRef: popupRef,
                    style: dropdownContainerStyle,
                    "aria-labelledby": toggleId,
                    onClick: closeOnClickInside
                },
                className: clsx("tn-dropdown-menu", dropdownContainerClassName),
                bottomSheet,
                startAt,
                isWanted: () => shownRef.current,
                dismiss: (reason) => {
                    if (reason === "outside" && (autoClose === "inside" || autoClose === false)) return;
                    setOpen(false);
                },
                close: () => setOpen(false)
            })}
        </div>
    );
}

/** A panel's popup, whose items Up and Down move between. */
function PanelPopup({ startAt, elementRef, ...props }: PopupProps & { startAt: "first" | "last" | undefined }) {
    const popupRef = useRef<HTMLDivElement | null>(null);

    // Captured at the window, so Bootstrap's handler for keys in a `.dropdown-menu`, which finds
    // no toggle beside a popup, never sees them.
    useEffect(() => {
        const onKeyDown = (e: KeyboardEvent) => {
            const popup = popupRef.current;
            const target = e.target as Element;
            if (e.key !== "ArrowDown" && e.key !== "ArrowUp") return;
            if (!popup?.contains(target) || /input|textarea/i.test(target.tagName)) return;
            e.preventDefault();
            e.stopPropagation();
            focusListItem(popup, e.key === "ArrowDown" ? "next" : "previous", target);
        };
        window.addEventListener("keydown", onKeyDown, true);
        return () => window.removeEventListener("keydown", onKeyDown, true);
    }, []);

    const setElement = useCallback((element: HTMLDivElement | null) => {
        popupRef.current = element;
        if (typeof elementRef === "function") elementRef(element);
        else if (elementRef) elementRef.current = element;
    }, [ elementRef ]);

    return (
        <Popup
            {...props}
            elementRef={setElement}
            onPlaced={() => {
                if (startAt && popupRef.current) focusListItem(popupRef.current, startAt);
            }}
        />
    );
}
