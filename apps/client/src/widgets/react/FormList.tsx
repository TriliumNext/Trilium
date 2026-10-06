import "./FormList.css";

import { autoUpdate } from "@floating-ui/dom";
import type { KeyboardActionNames } from "@triliumnext/commons";
import type { Tooltip } from "bootstrap";
import clsx from "clsx";
import { ComponentChildren, createPortal, type CSSProperties, RefObject } from "preact";
import { useContext, useLayoutEffect, useMemo, useRef } from "preact/hooks";

import { getActionSync } from "../../services/keyboard_actions";
import { handleRightToLeftPlacement, isMobile, openInAppHelpFromUrl } from "../../services/utils";
import FormToggle from "./FormToggle";
import HelpTooltipButton from "./HelpTooltipButton";
import { useStaticTooltip, useSyncedRef, useUniqueName } from "./hooks";
import Icon from "./Icon";
import { isRightToLeft, MenuContext, type MenuContextValue, MenuLevelContext, type OpenSubmenu, pointerMoved, shouldDropStart, useMenu } from "./menu_context";
import { placeFloating } from "./Popup";
import { joinElements } from "./react_utils";
import { renderShortcutKbds } from "./shortcut_kbd";

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
    /** Extra class for the icon itself, e.g. to hang a marker off its corner. */
    iconClassName?: string;
    value?: string;
    title?: string;
    active?: boolean;
    badges?: FormListBadge[];
    disabled?: boolean;
    /** Will indicate the reason why the item is disabled via an icon, when hovered over it. */
    disabledTooltip?: string;
    checked?: boolean | null;
    selected?: boolean;
    container?: boolean;
    onClick?: (e: MouseEvent) => void;
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
    /**
     * An icon at the end of the row, where a shortcut would go. Unlike {@link checked}, which takes
     * the place of {@link icon}, this leaves the row's own icon standing, for a list where that icon
     * is what tells one row from another.
     */
    trailingIcon?: string;
}

/** What in a row takes focus from a press: the controls that are typed into. */
const TEXT_ENTRY = "input:not([type='checkbox'], [type='radio']), textarea, select, [contenteditable='true']";

const TOOLTIP_CONFIG: Partial<Tooltip.Options> = {
    placement: handleRightToLeftPlacement("right"),
    fallbackPlacements: [ handleRightToLeftPlacement("right") ],
    animation: false
};

export function FormListItem({ className, icon, iconClassName, value, title, active, disabled, checked, checkable, container, onClick, selected, rtl, description, itemRef: externalItemRef, keyboardShortcut, shortcut, trailingIcon, closeOnSelect, ...contentProps }: FormListItemOpts) {
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

    function onPointed(e: { currentTarget: HTMLLIElement }) {
        if (!menu || isMobile()) return;
        // The keyboard goes on from the row the pointer last pointed at.
        if (!disabled) menu.setActive(level, id);
        menu.openSubmenu(level, undefined, e.currentTarget);
    }

    if (checked) {
        icon = "bx bx-check";
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
            onPointerEnter={menu ? (e) => {
                if (!menu.keyboardDriven) onPointed(e);
            } : undefined}
            // The keys can move the active row from under a pointer at rest, whose `:hover` would
            // then mark a second row. The next move of the pointer makes its row the active one.
            onPointerMove={menu ? (e) => {
                if (!isActive && pointerMoved(e)) onPointed(e);
            } : undefined}
            // A press keeps focus where it was, as in a native menu: a text editor keeps the
            // selection a command such as a spelling fix acts on, and a field beside a dropdown
            // stays in focus. A field inside the row takes focus as it would anywhere.
            onMouseDown={(e) => {
                if (e.button === 0 && !(e.target instanceof Element && e.target.closest(TEXT_ENTRY))) e.preventDefault();
            }}
            // The row runs on the release, so a press can still be taken back by moving off.
            onClick={(e) => {
                if (!disabled) run(e);
            }}
            dir={rtl ? "rtl" : undefined}
        >
            {/* One classless span holds the row, as the rows of a menu are laid out. */}
            <span>
                {icon === null ? <span /> : <Icon icon={icon} className={iconClassName} />}
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
                {trailingIcon && <span className={clsx(trailingIcon, "tn-icon", "menu-trailing-icon")} />}
            </span>
        </li>
    );
}

export function FormListToggleableItem({
    title, currentValue, onChange, disabled, helpPage, helpTooltip, ...props
}: Omit<FormListItemOpts, "onClick" | "children"> & {
    title: string;
    currentValue: boolean;
    helpPage?: string;
    /** What the setting does, shown on hover. Unlike {@link helpPage}, it opens nothing. */
    helpTooltip?: string;
    onChange(newValue: boolean): void | Promise<void>;
}) {
    const isWaiting = useRef(false);

    return (
        <FormListItem
            {...props}
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
                    {helpTooltip && <HelpTooltipButton description={helpTooltip} />}
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
    /** Optional element rendered right-aligned in the header (e.g. an edit action). */
    action?: ComponentChildren;
}

export function FormListHeader({ text, action }: FormListHeaderOpts) {
    // Its heading speaks for the row, which a menu does not count among its items.
    return (
        <li role="none">
            <h6 className={clsx("dropdown-header", action && "dropdown-header-with-action")}>
                <span>{text}</span>
                {action}
            </h6>
        </li>
    );
}

/** A line between groups of rows. A click on it closes no menu. */
export function FormDropdownDivider() {
    return <li className="dropdown-divider" role="separator" onClick={(e) => e.stopPropagation()} />;
}

export interface FormDropdownSubmenuProps {
    icon: string;
    title: ComponentChildren;
    children: ComponentChildren;
    /** Called when the row is clicked, or run from the keyboard, on the desktop. */
    onDropdownToggleClicked?: (e: MouseEvent) => void;
    /** Inside a menu, lays the submenu's rows out in this many columns. */
    columns?: number;
    disabled?: boolean;
    className?: string;
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

function MenuSubmenu({ menu, icon, title, children, onDropdownToggleClicked, columns, disabled, className }: FormDropdownSubmenuProps & { menu: MenuContextValue }) {
    const level = useContext(MenuLevelContext);
    const id = useUniqueName("menu-row");
    const openSubmenu = menu.open[level];
    const open = openSubmenu?.id === id;
    const isActive = menu.active?.id === id;

    /** Runs the row's own action for the keys, with the modifiers of the key that ran it. */
    function select(e: MouseEvent | KeyboardEvent) {
        onDropdownToggleClicked?.(new MouseEvent("click", { ctrlKey: e.ctrlKey, shiftKey: e.shiftKey, altKey: e.altKey, metaKey: e.metaKey }));
    }

    function onPointed(e: { currentTarget: HTMLLIElement }) {
        if (isMobile()) return;
        // The keyboard goes on from the row the pointer last pointed at.
        if (!disabled) menu.setActive(level, id);
        menu.openSubmenu(level, disabled ? undefined : id, e.currentTarget);
    }

    return (
        <li
            id={id}
            ref={(element) => {
                menu.registerRow(id, element ? { level, element, custom: false, disabled: !!disabled, hasSubmenu: true, select } : undefined);
            }}
            className={clsx("dropdown-item dropdown-submenu", open && "submenu-open", isActive && "tn-menu-active",
                menu.dropStart[level] && "dropstart", disabled && "disabled", className)}
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
            // As any row: the press keeps focus where it was, and the release acts. An unfolded
            // row holds its submenu's rows, whose presses and clicks reach it too; those are theirs.
            onMouseDown={(e) => {
                if (e.button === 0 && !inUnfoldedRows(e)) e.preventDefault();
            }}
            onClick={(e) => {
                if (inUnfoldedRows(e)) return;
                // The dropdown's `closeOnClickInside` would close the whole menu.
                e.stopPropagation();
                if (disabled) return;
                // Clicked again, an unfolded row folds its submenu back. The keys go on from this
                // row, as a folded or replaced submenu's rows are gone.
                if (isMobile()) {
                    menu.openSubmenu(level, open ? undefined : id, e.currentTarget, true);
                    menu.setActive(level, id);
                    return;
                }
                menu.openSubmenu(level, id, e.currentTarget, true);
                onDropdownToggleClicked?.(e);
            }}
        >
            <span className="dropdown-toggle">
                <Icon icon={icon} />
                <span className="tn-menu-gap" />
                <span id={titleId(id)}>{title}</span>
            </span>
            {isMobile()
                // A phone has no room beside the menu, so an open submenu unfolds under its row.
                ? (
                    <ul className={clsx("dropdown-menu", open && "show")} role="menu" aria-labelledby={titleId(id)}>
                        <MenuLevelContext.Provider value={level + 1}>{open && children}</MenuLevelContext.Provider>
                    </ul>
                )
                : open && openSubmenu && menu.layerHost && createPortal((
                    <SubmenuLayer level={level + 1} submenu={openSubmenu} columns={columns}>{children}</SubmenuLayer>
                ), menu.layerHost)}
        </li>
    );
}

/**
 * A submenu opened on the desktop, placed beside the row it opened from rather than nested in it,
 * so a scrolling menu neither clips it nor scrolls it away.
 */
function SubmenuLayer({ level, submenu, columns, children }: {
    level: number,
    submenu: OpenSubmenu,
    columns?: number,
    children: ComponentChildren
}) {
    const layerRef = useRef<HTMLDivElement>(null);
    const columnCount = (columns ?? 1) > 1 ? columns : undefined;
    const { dropStart: dropStartLevels, setDropStart } = useMenu();
    const dropStart = !!dropStartLevels[level - 1];

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
        return autoUpdate(submenu.anchor, layer, () => void placeFloating(layer, submenu.anchor, options).then((placed) => {
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
                >
                    {/* Like the top level, so the blur on the layer's `::before` stays behind its rows. */}
                    {columnCount
                        // The columns go on an inner list of their full height, so a capped menu
                        // scrolls them rather than growing more columns to the side.
                        ? (
                            <div className="tn-menu-scroll">
                                <menu className="tn-menu-columns" role="none" style={{ columnCount }}>
                                    {children}
                                </menu>
                            </div>
                        )
                        : <menu className="tn-menu-scroll" role="none">{children}</menu>}
                </div>
            </div>
        </MenuLevelContext.Provider>
    );
}

/** Whether an event on a submenu's row came from the rows its submenu unfolds inside it, on a phone. */
function inUnfoldedRows(e: Event & { currentTarget: HTMLElement }) {
    return e.target instanceof Element && e.target.closest(".dropdown-menu") !== e.currentTarget.closest(".dropdown-menu");
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
