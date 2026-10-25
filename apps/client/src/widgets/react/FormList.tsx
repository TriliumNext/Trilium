import "./FormList.css";

import { autoUpdate } from "@floating-ui/dom";
import type { KeyboardActionNames } from "@triliumnext/commons";
import type { Tooltip } from "bootstrap";
import clsx from "clsx";
import { ComponentChildren, createPortal, type CSSProperties, RefObject } from "preact";
import { useContext, useLayoutEffect, useMemo, useRef } from "preact/hooks";

import type { MenuHeaderActions } from "../../menus/context_menu";
import { t } from "../../services/i18n";
import { getActionSync } from "../../services/keyboard_actions";
import { handleRightToLeftPlacement, isMobile, openInAppHelpFromUrl } from "../../services/utils";
import ActionButton from "./ActionButton";
import FormTextBox from "./FormTextBox";
import FormToggle from "./FormToggle";
import { useStaticTooltip, useSyncedRef, useUniqueName } from "./hooks";
import Icon, { SvgIcon } from "./Icon";
import { MasterDetailHeader } from "./master_detail";
import { isRightToLeft, MenuContext, type MenuContextValue, type MenuFilter, MenuFilterContext, MenuLevelContext, type OpenSubmenu, pointerMoved, shouldDropStart, useMenu } from "./menu_context";
import { placeFloating } from "./Popup";
import { joinElements } from "./react_utils";
import { renderShortcutKbds } from "./shortcut_kbd";
import { type Slide, useSlide } from "./SlidePages";

interface FormListOpts {
    children: ComponentChildren;
    onSelect?: (value: string) => void;
    style?: CSSProperties;
    wrapperClassName?: string;
    fullHeight?: boolean;
}

export default function FormList({ children, onSelect, style, fullHeight, wrapperClassName }: FormListOpts) {
    const listRef = useRef<HTMLDivElement | null>(null);

    // Captured at the window: Bootstrap captures Escape, Up and Down at the document for any
    // `.dropdown-menu`, and throws when no toggle is next to it. Escape is stopped here, as
    // Bootstrap's handler also kept it from a dialog around the list.
    useLayoutEffect(() => {
        const onKeyDown = (e: KeyboardEvent) => {
            const list = listRef.current;
            const target = e.target as Element;
            if (!list?.contains(target)) return;
            if (e.key === "Escape") {
                e.stopPropagation();
            } else if ((e.key === "ArrowDown" || e.key === "ArrowUp") && !/input|textarea/i.test(target.tagName)) {
                e.preventDefault();
                e.stopPropagation();
                focusListItem(list, e.key === "ArrowDown" ? "next" : "previous", target);
            }
        };
        window.addEventListener("keydown", onKeyDown, true);
        return () => window.removeEventListener("keydown", onKeyDown, true);
    }, []);

    const builtinStyles = useMemo(() => {
        const style: CSSProperties = {};
        if (fullHeight) {
            style.height = "100%";
            style.overflow = "auto";
        }
        return style;
    }, [ fullHeight ]);

    return (
        <div className={clsx("dropdownWrapper", wrapperClassName)} style={builtinStyles}>
            <div className="dropdown" style={builtinStyles}>
                <div ref={listRef} class="dropdown-menu static show" style={{
                    ...style ?? {},
                    ...builtinStyles,
                    position: "relative",
                }} onClick={(e) => {
                    const dropdownItem = (e.target as HTMLElement).closest(".dropdown-item") as HTMLElement | null;
                    const value = dropdownItem?.dataset?.value;
                    if (value && onSelect) {
                        onSelect(value);
                    }
                }} onKeyDown={onDropdownMenuKeyDown}>
                    {children}
                </div>
            </div>
        </div>
    );
}

/**
 * Activates the currently focused list item on Enter/Space, so the list is keyboard-operable
 * and not mouse-only. The focused item is "clicked" to reuse the existing item- and list-level
 * click handlers (e.g. {@link FormList}'s `onSelect`, toggle items).
 */
function onDropdownMenuKeyDown(e: KeyboardEvent) {
    if (e.key !== "Enter" && e.key !== " ") {
        return;
    }

    const target = e.target as HTMLElement;

    const dropdownItem = target.closest(".dropdown-item") as HTMLElement | null;
    if (!dropdownItem || dropdownItem.classList.contains("disabled")) {
        return;
    }

    // Let interactive elements nested inside the item (inputs, buttons, links, anything
    // focusable) handle their own Enter/Space instead of hijacking it for the parent item.
    const interactive = target.closest("input, textarea, select, button, a, [tabindex]");
    if (interactive && interactive !== dropdownItem) {
        return;
    }

    e.preventDefault();
    dropdownItem.click();
}

/**
 * Focuses an enabled item that belongs to `list` itself, not to a nested submenu: the first, the
 * last, or the one after or before `from`, wrapping at either end.
 */
export function focusListItem(list: HTMLElement, where: "first" | "last" | "next" | "previous", from?: Element) {
    const items = [ ...list.querySelectorAll<HTMLElement>(".dropdown-item:not(.disabled):not(:disabled)") ]
        .filter((item) => item.parentElement?.closest(".dropdown-menu") === list);
    if (!items.length) return;

    const current = from?.closest<HTMLElement>(".dropdown-item");
    const index = current ? items.indexOf(current) : -1;
    let target: HTMLElement | undefined;
    if (where === "first" || (where === "next" && index < 0)) target = items[0];
    else if (where === "last" || (where === "previous" && index < 0)) target = items.at(-1);
    else target = items[(index + (where === "next" ? 1 : -1) + items.length) % items.length];
    target?.focus();
}

export interface FormListBadge {
    className?: string;
    text: string;
}

export interface FormListItemOpts {
    children: ComponentChildren;
    /** Without one the row keeps a blank slot, lining it up with the rows that have one; `null` leaves no slot. */
    icon?: string | null;
    /** The SVG of an icon drawn in place of {@link icon}, such as a CKEditor toolbar item's. */
    iconSvg?: string;
    /** Extra class for the icon itself, e.g. to hang a marker off its corner. */
    iconClassName?: string;
    value?: string;
    title?: string;
    active?: boolean;
    badges?: FormListBadge[];
    disabled?: boolean;
    /** Will indicate the reason why the item is disabled via an icon, when hovered over it. */
    disabledTooltip?: string;
    /**
     * Marks the row with a check: at the trailing edge when the row has an {@link icon} of its own,
     * which tells it from the other rows, and in place of the icon when it has none.
     */
    checked?: boolean | null;
    selected?: boolean;
    container?: boolean;
    onClick?: (e: MouseEvent) => void;
    /** Runs on a middle click on the row, which leaves the menu open. */
    onMiddleClick?: (e: MouseEvent) => void;
    /** Runs on a right-click on the row, which a menu ignores otherwise. */
    onContextMenu?: (e: MouseEvent) => void;
    description?: string;
    className?: string;
    rtl?: boolean;
    postContent?: ComponentChildren;
    itemRef?: RefObject<HTMLLIElement | null>;
    /**
     * Makes the row one that is checked or not, which a menu tells assistive technology;
     * {@link checked} says which.
     */
    checkable?: boolean;
    /**
     * Inside a menu, whether running the row closes the menu after its {@link onClick} runs. It
     * does unless this is `false`, for a caller that decides for itself, as `contextMenu` does.
     */
    closeOnSelect?: boolean;
    /** The action whose shortcuts, as the user configured them, show at the end of the row. */
    keyboardShortcut?: KeyboardActionNames;
    /** A shortcut shown as it is written, for a row with no action of its own. */
    shortcut?: string;
    /** Text at the end of the row, where a shortcut would go. */
    trailingText?: string;
    /** An icon at the end of the row, where a shortcut would go. */
    trailingIcon?: string;
}

const CHECK_ICON = "bx bx-check";
/** The blank icon a row carries only to line its title up with the icons of the others. */
const EMPTY_ICON = "bx bx-empty";

/** What in a row takes focus from a press: the controls that are typed into. */
const TEXT_ENTRY = "input:not([type='checkbox'], [type='radio']), textarea, select, [contenteditable='true']";

const TOOLTIP_CONFIG: Partial<Tooltip.Options> = {
    placement: menuItemTooltipSide,
    fallbackPlacements: [],
    animation: false
};

export function FormListItem({
    className, icon, iconSvg, iconClassName, value, title, active, disabled, checked, checkable,
    container, onClick, onMiddleClick, onContextMenu, selected, rtl, description,
    itemRef: externalItemRef, keyboardShortcut, shortcut, trailingText, trailingIcon, closeOnSelect,
    ...contentProps
}: FormListItemOpts) {
    const itemRef = useSyncedRef<HTMLLIElement>(externalItemRef, null);
    // Inside a `Menu` the row is one of its items; elsewhere, as in a dropdown, it stands alone.
    const menu = useContext(MenuContext);
    const level = useContext(MenuLevelContext);
    // Unique across portals, where `useId()` numbers a menu's layers over again.
    const id = useUniqueName("menu-row");
    const isActive = menu?.active?.id === id;

    /**
     * Runs the row, then closes the menu it stands in, as Bootstrap's dropdowns did, unless
     * {@link closeOnSelect} is `false` or the row's handler stopped the click: a row that stays up
     * to be worked again, such as a toggle, stops it.
     */
    function run(e: MouseEvent) {
        onClick?.(e);
        if (closeOnSelect !== false && !e.cancelBubble) menu?.close();
    }

    /**
     * Runs the row for the keys, as a click would, with the modifiers of the key that ran it, so
     * Ctrl+Enter does what a Ctrl+click does.
     */
    function select(e: MouseEvent | KeyboardEvent) {
        run(new MouseEvent("click", { ctrlKey: e.ctrlKey, shiftKey: e.shiftKey, altKey: e.altKey, metaKey: e.metaKey }));
    }

    function onPointed() {
        if (!menu || isMobile()) return;
        // First, as it can make the row of the submenus it closes active.
        menu.hoverSubmenu(level);
        // The keyboard goes on from the row the pointer last pointed at.
        if (!disabled) menu.setActive(level, id);
    }

    const hasOwnIcon = !!iconSvg || (!!icon && icon !== EMPTY_ICON);
    if (checked) {
        if (hasOwnIcon) trailingIcon ??= CHECK_ICON;
        else icon = CHECK_ICON;
    }

    useStaticTooltip(itemRef, TOOLTIP_CONFIG);

    return (
        <li
            ref={(element) => {
                itemRef.current = element;
                menu?.registerRow(id, element
                    ? { level, element, custom: false, disabled: !!disabled, hasSubmenu: false, select }
                    : undefined);
            }}
            id={menu ? id : undefined}
            class={clsx("dropdown-item", active && "active", disabled && "disabled", selected && "selected",
                container && "dropdown-container-item", isActive && "tn-menu-active", className)}
            data-value={value} title={title}
            role={menu ? (checkable ? "menuitemcheckbox" : "menuitem") : undefined}
            aria-checked={menu && checkable ? !!checked : undefined}
            aria-disabled={(menu && disabled) || undefined}
            // A menu keeps focus itself and marks the row its keys act on instead.
            tabIndex={menu ? undefined : container ? -1 : 0}
            // While the keys drive the menu, a row entered by a pointer at rest, as when the menu
            // appears under it, keeps the keys' row. See `pointerMoved`.
            onPointerEnter={menu ? () => {
                if (!menu.keyboardDriven) onPointed();
            } : undefined}
            // The keys can move the active row from under a pointer at rest, whose `:hover` would
            // then mark a second row. The next move of the pointer makes its row the active one.
            onPointerMove={menu ? (e) => {
                if (!isActive && pointerMoved(e)) onPointed();
            } : undefined}
            // A press keeps focus where it was, as in a native menu: a text editor keeps the
            // selection a command such as a spelling fix acts on, and a field beside a dropdown
            // stays in focus. A field inside the row takes focus as it would anywhere.
            onMouseDown={(e) => {
                if (e.button === 0 && !(e.target instanceof Element && e.target.closest(TEXT_ENTRY))) e.preventDefault();
                preventMiddlePress(e, onMiddleClick);
            }}
            // The row runs on the release, so a press can still be taken back by moving off.
            onClick={(e) => {
                if (!disabled) run(e);
            }}
            onAuxClick={middleClickHandler(onMiddleClick, disabled)}
            onContextMenu={onContextMenu}
            dir={rtl ? "rtl" : undefined}
        >
            {/* One classless span holds the row, as the rows of a menu are laid out. */}
            <span>
                {iconSvg
                    ? <SvgIcon svg={iconSvg} className={iconClassName} />
                    : icon === null ? <span /> : <Icon icon={icon} className={iconClassName} />}
                {/* An element, not spaces: in a flex row, text merges with a plain title but is
                    trimmed before one boxed by `menuName()`, indenting the two kinds of row apart. */}
                <span className="tn-menu-gap" />
                {description ? (
                    <div>
                        <FormListContent description={description} disabled={disabled} {...contentProps} />
                    </div>
                ) : (
                    <FormListContent description={description} disabled={disabled} {...contentProps} />
                )}
                <FormListShortcut keyboardShortcut={keyboardShortcut} shortcut={shortcut} />
                {trailingText && <span className="menu-trailing-text">{trailingText}</span>}
                {trailingIcon && <span className={clsx(trailingIcon, "tn-icon", "menu-trailing-icon")} />}
            </span>
        </li>
    );
}

/** Bootstrap's default `--bs-tooltip-max-width`, for a tooltip whose inner carries no cap of its own. */
const TOOLTIP_MAX_WIDTH = 200;
const TOOLTIP_OFFSET = 6;
/** The narrowest a tooltip is squeezed to. Below it the text is unreadable, so it is let to overflow. */
const MIN_TOOLTIP_WIDTH = 160;

/**
 * Puts a row's tooltip on the reading-direction end of the menu, or on the other side when the
 * viewport has no room there for a tooltip at its widest. The room is measured against that widest
 * tooltip rather than this one, so every row of a menu gets the same side whatever its text. A
 * window too narrow for either side gets the roomier one, with the tooltip wrapped to fit it.
 *
 * Bootstrap calls this with the tip first and the row it stands beside second, `this` being the
 * `Tooltip`.
 */
export function menuItemTooltipSide(tip?: HTMLElement, row?: Element): "left" | "right" {
    const preferred = handleRightToLeftPlacement("right");
    if (!tip || !row) return preferred;

    // A tooltip shown before may have been narrowed to the room it had then.
    tip.style.maxWidth = "";

    const { left, right } = row.getBoundingClientRect();
    const roomOn = (side: "left" | "right") => side === "right"
        ? window.innerWidth - right - TOOLTIP_OFFSET
        : left - TOOLTIP_OFFSET;
    const needed = tooltipWidth(tip) + TOOLTIP_OFFSET;
    const other = preferred === "right" ? "left" : "right";
    const room = roomOn(preferred);
    const side = room >= needed || roomOn(other) <= room ? preferred : other;
    const roomOnSide = roomOn(side);

    // Neither side may hold a tooltip at its widest, as a menu row on a narrow window leaves little
    // room either way: it wraps into what its side has rather than being cut by the window.
    if (roomOnSide < needed) {
        tip.style.maxWidth = `${Math.max(roomOnSide, MIN_TOOLTIP_WIDTH)}px`;
    }

    return side;
}

/**
 * The widest the tooltip can be: the cap its inner carries, which `tooltip.css` sets well above
 * Bootstrap's, on `.tooltip-inner`.
 */
function tooltipWidth(tip: HTMLElement) {
    const inner = tip.querySelector(".tooltip-inner");
    const cap = inner ? parseFloat(getComputedStyle(inner).maxWidth) : NaN;
    if (!Number.isNaN(cap)) return cap;

    const bootstrapCap = parseFloat(getComputedStyle(tip).getPropertyValue("--bs-tooltip-max-width"));
    return Number.isNaN(bootstrapCap) ? TOOLTIP_MAX_WIDTH : bootstrapCap;
}

export function FormListToggleableItem({
    title, currentValue, onChange, disabled, helpPage, helpTooltip, className, ...props
}: Omit<FormListItemOpts, "onClick" | "children"> & {
    title: string;
    currentValue: boolean;
    helpPage?: string;
    /** What the setting does, shown beside the menu while the row is hovered. */
    helpTooltip?: string;
    onChange(newValue: boolean): void | Promise<void>;
}) {
    const isWaiting = useRef(false);

    return (
        <FormListItem
            {...props}
            className={clsx("tn-menu-toggle", className)}
            title={helpTooltip}
            disabled={disabled}
            onClick={async (e) => {
                if ((e.target as HTMLElement | null)?.classList.contains("contextual-help")) {
                    return;
                }

                e.stopPropagation();
                if (!disabled && !isWaiting.current) {
                    isWaiting.current = true;
                    await onChange(!currentValue);
                    isWaiting.current = false;
                }
            }}>
            <FormToggle
                switchOnName={title}
                switchOffName={title}
                currentValue={currentValue}
                onChange={() => {}}
                afterName={<>
                    {helpPage && (
                        <span
                            class="bx bx-help-circle contextual-help"
                            onClick={() => openInAppHelpFromUrl(helpPage)}
                        />
                    )}
                    <span class="switch-spacer" />
                </>}
            />
        </FormListItem>
    );
}

function FormListContent({ children, badges, description, disabled, disabledTooltip }: Pick<FormListItemOpts, "children" | "badges" | "description" | "disabled" | "disabledTooltip">) {
    return <>
        {children}
        {badges && badges.map(({ className, text }) => (
            <span className={clsx("badge", className)}>{text}</span>
        ))}
        {disabled && disabledTooltip && (
            <span class="bx bx-info-circle contextual-help" title={disabledTooltip} />
        )}
        {description && <div className="description">{description}</div>}
    </>;
}

interface FormListHeaderOpts {
    /** Usually a heading, but anything a group can be introduced by: a summary, a row of marks. */
    text: ComponentChildren;
    /** Icon buttons at the end of the heading, which keep it as tall as a heading without them. */
    actions?: MenuHeaderActions;
}

/** The most actions a heading shows, as `MenuHeaderActions` allows. A script can pass more. */
const MAX_HEADER_ACTIONS = 3;

export function FormListHeader({ text, actions = [] }: FormListHeaderOpts) {
    const menu = useContext(MenuContext);
    const level = useContext(MenuLevelContext);
    const shownActions = actions.slice(0, MAX_HEADER_ACTIONS);
    const hasActions = shownActions.length > 0;

    // Its heading speaks for the row, which a menu does not count among its items.
    return (
        <li role="none">
            <h6 className={clsx("dropdown-header", hasActions && "tn-menu-header-with-actions")}>
                <span>{text}</span>
                {hasActions && (
                    <span
                        className="tn-menu-header-actions"
                        // As over a row, the pointer closes the submenu open at this level.
                        onPointerMove={(e) => {
                            if (menu && pointerMoved(e)) menu.hoverSubmenu(level);
                        }}
                        // A press keeps focus where it was, as on a row.
                        onMouseDown={(e) => e.preventDefault()}
                    >
                        {shownActions.map(({ icon, caption, callback }, index) => (
                            <ActionButton
                                key={index} icon={icon} text={caption} titlePosition="top"
                                onClick={(e) => {
                                    menu?.close();
                                    callback(e);
                                }}
                            />
                        ))}
                    </span>
                )}
            </h6>
        </li>
    );
}

/** A line between groups of rows. A click on it closes no menu. */
export function FormDropdownDivider() {
    return <li className="dropdown-divider" role="separator" onClick={(e) => e.stopPropagation()} />;
}

export interface FormDropdownSubmenuProps {
    icon?: string;
    /** The SVG of an icon drawn in place of {@link icon}, such as a CKEditor toolbar item's. */
    iconSvg?: string;
    title: ComponentChildren;
    children: ComponentChildren;
    /** A line under the title, as {@link FormListItem} shows one. */
    description?: string;
    /** Called when the row is clicked, or run from the keyboard, on the desktop. */
    onDropdownToggleClicked?: (e: MouseEvent) => void;
    /**
     * Whether the row runs an action of its own besides opening the submenu. A split row draws a
     * divider before its arrow, and a click on the arrow only opens the submenu. Defaults to
     * whether {@link onDropdownToggleClicked} is set.
     */
    split?: boolean;
    /** Whether running {@link onDropdownToggleClicked} closes the menu, as `FormListItem` does. */
    closeOnSelect?: boolean;
    /** Runs on a middle click on the row, which leaves the menu open. Not for a {@link tile}. */
    onMiddleClick?: (e: MouseEvent) => void;
    /** Runs on a right-click on the row, which a menu ignores otherwise. Not for a {@link tile}. */
    onContextMenu?: (e: MouseEvent) => void;
    disabled?: boolean;
    className?: string;
    /** Inside a menu, whether typing while the submenu is open filters it. See `MenuCommandItem.filterable`. */
    filterable?: boolean;
    /**
     * Draws the row as a tile of a `MenuTile` strip, which only opens the submenu: a tile has no
     * room for the arrow of a split row.
     */
    tile?: boolean;
}

/**
 * A row that opens its children as a submenu, in a separate layer beside the row, so a scrolling
 * menu neither clips it nor scrolls it away. Outside a `Menu`, which only a script can arrange, it
 * renders its title as a `FormListHeader` above its children.
 */
export function FormDropdownSubmenu(props: FormDropdownSubmenuProps) {
    const menu = useContext(MenuContext);
    if (!menu) return <><FormListHeader text={props.title} />{props.children}</>;
    return <MenuSubmenu {...props} menu={menu} />;
}

function MenuSubmenu({
    menu, icon, iconSvg, title, description, children, onDropdownToggleClicked,
    split = !!onDropdownToggleClicked, closeOnSelect, onMiddleClick, onContextMenu, disabled,
    className, filterable, tile
}: FormDropdownSubmenuProps & { menu: MenuContextValue }) {
    const level = useContext(MenuLevelContext);
    const id = useUniqueName("menu-row");
    const openSubmenu = menu.open[level];
    const open = openSubmenu?.id === id;
    const isActive = menu.active?.id === id;
    const filter = filterable ? { rowId: id, level, text: menu.filter?.rowId === id ? menu.filter.text : "" } : undefined;
    // A phone's page that closes keeps being drawn until it has slid out.
    const pageSlide = useSlide(open);

    function run(e: MouseEvent) {
        onDropdownToggleClicked?.(e);
        if (closeOnSelect) menu.close();
    }

    /** Runs the row's own action for the keys, with the modifiers of the key that ran it. */
    function select(e: MouseEvent | KeyboardEvent) {
        const { ctrlKey, shiftKey, altKey, metaKey } = e;
        run(new MouseEvent("click", { ctrlKey, shiftKey, altKey, metaKey }));
    }

    function onPointed(e: { currentTarget: HTMLLIElement }) {
        if (isMobile()) return;
        // The keyboard goes on from the row the pointer last pointed at.
        if (!disabled) menu.setActive(level, id);
        menu.hoverSubmenu(level, disabled ? undefined : id, e.currentTarget);
    }

    const layer = isMobile()
        // A phone has no room beside the menu, so a submenu replaces it as a page of its own.
        ? (open || pageSlide.from !== undefined) && menu.layerHost && createPortal((
            <SubmenuPage
                rowId={id} level={level + 1} title={title} slide={pageSlide} filter={filter}
            >
                {children}
            </SubmenuPage>
        ), menu.layerHost)
        : open && openSubmenu && menu.layerHost && createPortal((
            <SubmenuLayer level={level + 1} submenu={openSubmenu} filter={filter}>
                {children}
            </SubmenuLayer>
        ), menu.layerHost);

    if (tile) {
        return (
            <button
                id={id} type="button"
                ref={(element) => {
                    menu.registerRow(id, element
                        ? { level, element, custom: false, disabled: !!disabled, hasSubmenu: true, inline: true, filterable, select: () => {} }
                        : undefined);
                }}
                className={clsx("tn-menu-action", open && "submenu-open", isActive && "tn-menu-active", className)}
                role="menuitem" aria-haspopup="menu" aria-expanded={open}
                disabled={disabled} tabIndex={-1}
                // As over a row, the pointer closes another submenu at this level, but the tile
                // opens its own only on a press.
                onPointerMove={(e) => {
                    if (!pointerMoved(e)) return;
                    menu.hoverSubmenu(level, open ? id : undefined, e.currentTarget);
                    if (!disabled && !isActive) menu.setActive(level, id);
                }}
                // As any row: the press keeps focus where it was, and the release acts.
                onMouseDown={(e) => e.preventDefault()}
                onClick={(e) => {
                    // The dropdown's `closeOnClickInside` would close the whole menu.
                    e.stopPropagation();
                    menu.setActive(level, id);
                    menu.openSubmenu(level, id, e.currentTarget, true);
                }}
            >
                <span className="tn-menu-action-icon" aria-hidden="true">
                    {iconSvg ? <SvgIcon svg={iconSvg} /> : <Icon icon={icon} />}
                </span>
                <span id={titleId(id)} className="tn-menu-action-title">{title}</span>
                <span className="tn-menu-action-more bx bx-chevron-right" aria-hidden="true" />
                {layer}
            </button>
        );
    }

    return (
        <li
            id={id}
            ref={(element) => {
                menu.registerRow(id, element ? { level, element, custom: false, disabled: !!disabled, hasSubmenu: true, filterable, select } : undefined);
            }}
            className={clsx("dropdown-item dropdown-submenu", open && "submenu-open", isActive && "tn-menu-active",
                split && !isMobile() && "tn-menu-split", disabled && "disabled", className)}
            role="menuitem"
            aria-disabled={disabled || undefined}
            aria-haspopup="menu"
            aria-expanded={open}
            // While the keys drive the menu, a row entered by a pointer at rest, as when the menu
            // appears under it, keeps the keys' row. See `pointerMoved`.
            onPointerEnter={(e) => {
                if (!menu.keyboardDriven) onPointed(e);
            }}
            // The keys can move the active row from under a pointer at rest, whose `:hover` would
            // then mark a second row. The next move of the pointer makes its row the active one.
            onPointerMove={(e) => {
                if (!isActive && pointerMoved(e)) onPointed(e);
            }}
            // As any row: the press keeps focus where it was, and the release acts.
            onMouseDown={(e) => {
                if (e.button === 0) e.preventDefault();
                preventMiddlePress(e, onMiddleClick);
            }}
            onClick={(e) => {
                // The dropdown's `closeOnClickInside` would close the whole menu.
                e.stopPropagation();
                if (disabled) return;
                menu.openSubmenu(level, id, e.currentTarget, true);
                if (!isMobile()) run(e);
            }}
            onAuxClick={middleClickHandler(onMiddleClick, disabled)}
            onContextMenu={onContextMenu}
        >
            <span className="dropdown-toggle">
                {iconSvg ? <SvgIcon svg={iconSvg} /> : <Icon icon={icon} />}
                <span className="tn-menu-gap" />
                {description ? (
                    <div>
                        <span id={titleId(id)}>{title}</span>
                        <div className="description">{description}</div>
                    </div>
                ) : <span id={titleId(id)}>{title}</span>}
            </span>
            {split && !isMobile() && (
                <span
                    className="tn-menu-split-toggle"
                    aria-hidden="true"
                    onClick={(e) => {
                        e.stopPropagation();
                        const row = e.currentTarget.parentElement;
                        if (!disabled && row) menu.openSubmenu(level, id, row, true);
                    }}
                />
            )}
            {layer}
        </li>
    );
}

/**
 * A submenu opened on the desktop, placed beside the row it opened from rather than nested in it,
 * so a scrolling menu neither clips it nor scrolls it away. While its {@link filter} has text, the
 * layer keeps its top position relative to its row, and only its height changes with the matches.
 */
function SubmenuLayer({ level, submenu, filter, children }: {
    level: number,
    submenu: OpenSubmenu,
    filter: MenuFilter | undefined,
    children: ComponentChildren
}) {
    const layerRef = useRef<HTMLDivElement>(null);
    const { dropStart: dropStartLevels, setDropStart, submenuShown, hoverSubmenu } = useMenu();
    const dropStart = !!dropStartLevels[level - 1];
    const pinned = !!filter?.text;
    /** How far below its row's top the layer stands while pinned. */
    const pinnedOffset = useRef<number | undefined>(undefined);

    // Taken as the content changes, before the layer is placed again for its new height.
    useLayoutEffect(() => {
        const layer = layerRef.current;
        if (!pinned || !layer) {
            pinnedOffset.current = undefined;
        } else if (pinnedOffset.current === undefined) {
            pinnedOffset.current = parseFloat(layer.style.top) - submenu.anchor.getBoundingClientRect().top;
        }
    }, [ pinned, submenu.anchor ]);

    useLayoutEffect(() => {
        const layer = layerRef.current;
        if (!layer) return;

        const rtl = isRightToLeft();
        const startSide = rtl ? "right" : "left";
        const endSide = rtl ? "left" : "right";
        const options = {
            placement: `${dropStart ? startSide : endSide}-start`,
            // Overlaps its row by 2px, so the pointer crosses no gap on its way over, and lines its
            // first row up with that row.
            offset: ({ elements }: { elements: { floating: HTMLElement } }) => {
                const style = getComputedStyle(elements.floating);
                const inset = (parseFloat(style.paddingTop) || 0) + (parseFloat(style.borderTopWidth) || 0);
                return { mainAxis: -2, crossAxis: -inset };
            },
            shiftAcross: true, capHeight: true, hideWithAnchor: true
        } as const;
        const place = () => {
            const offset = pinnedOffset.current;
            const pinTop = offset === undefined || Number.isNaN(offset)
                ? undefined
                : submenu.anchor.getBoundingClientRect().top + offset;
            return placeFloating(layer, submenu.anchor, { ...options, pinTop });
        };
        return autoUpdate(submenu.anchor, layer, () => void place().then((placed) => {
            // After a flip, the parent level follows, so its rows' arrows match.
            const placedDropStart = placed.startsWith(startSide);
            if (placedDropStart !== dropStart) {
                setDropStart(level - 1, placedDropStart);
                return;
            }
            setDropStart(level, shouldDropStart(layer.getBoundingClientRect(),
                document.documentElement.clientWidth, rtl, dropStart));
        }));
    }, [ submenu.anchor, dropStart, level, setDropStart ]);

    // In a `.dropdown-submenu`, so the theme's submenu rules apply.
    return (
        <MenuLevelContext.Provider value={level}>
            <div className="dropdown-submenu">
                <div
                    ref={layerRef} role="menu" aria-labelledby={titleId(submenu.anchor.id)}
                    className={clsx("dropdown-menu show tn-menu", submenu.immediate && "tn-menu-immediate")}
                    // The fade starts once the opening delay is over.
                    onAnimationStart={(e) => {
                        if (e.target === e.currentTarget) submenuShown(submenu);
                    }}
                    // Over the layer, the pointer keeps it open as over its row, whatever rows it
                    // crossed on the way.
                    onPointerEnter={() => hoverSubmenu(level - 1, submenu.id, submenu.anchor)}
                >
                    <MenuList filter={filter}>{children}</MenuList>
                </div>
            </div>
        </MenuLevelContext.Provider>
    );
}

/**
 * A submenu opened on a phone: a page that takes the menu's place, headed by the submenu's title and
 * a way back. The level it covers stays mounted, as the row that owns this page stands in it.
 */
function SubmenuPage({ rowId, level, title, slide, filter, children }: {
    rowId: string,
    level: number,
    title: ComponentChildren,
    /** The slide of whether the page is open: from closed as it arrives, from open as it leaves. */
    slide: Slide<boolean>,
    filter: MenuFilter | undefined,
    children: ComponentChildren
}) {
    const menu = useMenu();

    function back() {
        menu.openSubmenu(level - 1);
        menu.setActive(level - 1, rowId);
    }

    return (
        <MenuLevelContext.Provider value={level}>
            <div
                role="menu" aria-labelledby={titleId(rowId)}
                className={clsx("tn-menu-page", slide.from === false && "tn-menu-page-entering",
                    slide.from === true && "tn-menu-page-leaving")}
                onAnimationEnd={slide.onAnimationEnd}
            >
                {/* As a row's press: the menu keeps focus, and the dropdown does not close on it. */}
                <div
                    className="tn-menu-page-header"
                    onMouseDown={(e) => e.preventDefault()}
                    onClick={(e) => e.stopPropagation()}
                >
                    <MasterDetailHeader inPage onBack={back} backTitle={t("menu.back")} pageTitle={title} listTitle={title} />
                </div>
                <MenuList filter={filter}>{children}</MenuList>
            </div>
        </MenuLevelContext.Provider>
    );
}

/**
 * One level of a menu: its rows in a scrolling list and, for a level with a {@link filter}, the
 * filter input above that list. The input stays in place while the rows scroll.
 */
export function MenuList({ filter, bottomUp, children }: {
    filter: MenuFilter | undefined,
    /** Puts the filter input below the list, for a menu that opens above its anchor. */
    bottomUp?: boolean,
    children: ComponentChildren
}) {
    // The rows scroll here and not in the frame, so the theme's `::before` blur stays behind
    // them. `role="none"` exposes the rows as the menu's own items.
    const list = <menu className="tn-menu-scroll" role="none">{children}</menu>;
    return (
        <MenuFilterContext.Provider value={filter}>
            {/* One box, so a phone's submenu page hides and slides the input with the rows. */}
            {filter ? (
                <div className="tn-menu-filterable">
                    {!bottomUp && <MenuFilterInput filter={filter} />}
                    {list}
                    {bottomUp && <MenuFilterInput filter={filter} />}
                </div>
            ) : list}
        </MenuFilterContext.Provider>
    );
}

/**
 * The filter input above a filterable level's rows. The input handles the editing keys; the menu
 * handles Up, Down, Enter, Escape and Tab, so a match can be picked while focus is in the input.
 */
function MenuFilterInput({ filter }: { filter: MenuFilter }) {
    const menu = useMenu();
    const inputRef = useRef<HTMLInputElement | null>(null);

    // An input unmounted while focused, as when the pointer closes its submenu, returns focus to
    // the menu and not to the page.
    useLayoutEffect(() => () => {
        if (document.activeElement !== inputRef.current) return;
        menu.layerHost?.focus({ preventScroll: true });
    }, [ menu.layerHost ]);

    return (
        <div className="tn-menu-filter">
            {/* A press anywhere in the box, the clear button's included, keeps focus in the input,
                and a click in it does not close the dropdown. */}
            <div
                className="tn-menu-filter-box tn-input-field"
                onMouseDown={(e) => {
                    if (e.target === inputRef.current) return;
                    e.preventDefault();
                    inputRef.current?.focus({ preventScroll: true });
                }}
                onClick={(e) => e.stopPropagation()}
            >
                <FormTextBox
                    inputRef={inputRef} className="tn-menu-filter-input"
                    data-level={filter.level + 1} currentValue={filter.text}
                    autoComplete="off" spellcheck={false}
                    placeholder={t("menu.filter_placeholder")} aria-label={t("menu.filter")}
                    onChange={(text) => menu.setFilter(text
                        ? { rowId: filter.rowId, level: filter.level, text }
                        : undefined)}
                />
                {filter.text
                    ? <ActionButton
                        className="tn-menu-filter-clear" icon="bx bx-x" text={t("menu.clear_filter")}
                        onClick={() => menu.setFilter(undefined)}
                    />
                    : <span className="bx bx-search" aria-hidden="true" />}
            </div>
        </div>
    );
}

/** The id of a row's title, which names the submenu it opens. */
function titleId(rowId: string) {
    return `${rowId}-title`;
}

/**
 * A row holding a control of its own, such as the color picker. The keys stand on it when its
 * content marks a way in with `tabindex="0"`, and a click on something in it that acts closes the
 * menu it stands in.
 */
export function FormListCustomItem({ children }: { children: ComponentChildren }) {
    // Outside a `Menu`, as in a dropdown's plain list, there is none to join.
    const menu = useContext(MenuContext);
    const level = useContext(MenuLevelContext);
    const id = useUniqueName("menu-row");

    return (
        <li
            className="dropdown-custom-item"
            // Its content carries the roles of what it acts with.
            role="none"
            ref={(element) => {
                menu?.registerRow(id, element
                    ? { level, element, custom: true, disabled: false, hasSubmenu: false, select: () => {} }
                    : undefined);
            }}
            // Only a click on what the row acts with closes the menu: one in the space around it,
            // such as between the color picker's cells, picks nothing.
            onClick={(e) => {
                if (menu && actsOnClick(e.target, e.currentTarget)) menu.close();
            }}
        >
            {children}
        </li>
    );
}

/** What a custom row's content acts with: the elements a click on does something. */
const ACTING_ELEMENTS = "button, a[href], input, select, textarea, [tabindex], "
    + "[role='button'], [role='option'], [role='menuitem'], [role='checkbox'], [role='radio'], [role='switch']";

/** Whether a click on `target` inside `row` landed on an enabled element that acts. */
function actsOnClick(target: EventTarget | null, row: HTMLElement) {
    const acting = target instanceof Element ? target.closest(ACTING_ELEMENTS) : null;
    return !!acting && row.contains(acting) && acting !== row
        && acting.getAttribute("aria-disabled") !== "true" && !acting.matches(":disabled");
}

/**
 * Cancels a middle press on a row with `onMiddleClick`. The press starts autoscrolling, and pastes
 * on Linux.
 */
function preventMiddlePress(e: MouseEvent, onMiddleClick: ((e: MouseEvent) => void) | undefined) {
    if (e.button === 1 && onMiddleClick) e.preventDefault();
}

/** An `auxclick` handler running `onMiddleClick`, which browsers fire for the right button too. */
function middleClickHandler(
    onMiddleClick: ((e: MouseEvent) => void) | undefined,
    disabled?: boolean
) {
    if (!onMiddleClick) return undefined;
    return (e: MouseEvent) => {
        if (e.button === 1 && !disabled) onMiddleClick(e);
    };
}

/**
 * The shortcuts of the row's `keyboardShortcut` action as the user configured them, or else its
 * literal `shortcut`. Read synchronously, so the menu is placed at its final width.
 */
function FormListShortcut({ keyboardShortcut, shortcut }: Pick<FormListItemOpts, "keyboardShortcut" | "shortcut">) {
    // A phone has no keyboard to press them on.
    if (isMobile()) return null;
    if (keyboardShortcut) {
        const shortcuts = getActionSync(keyboardShortcut)?.effectiveShortcuts;
        if (!shortcuts?.length) return null;
        return (
            <span className="keyboard-shortcut">
                {joinElements(shortcuts.map(shortcut => renderShortcutKbds(shortcut)), ",")}
            </span>
        );
    }

    return shortcut ? <kbd>{shortcut}</kbd> : null;
}
