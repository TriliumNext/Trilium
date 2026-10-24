import "./Menu.css";
import "./slide_animations.css";

import type { Placement } from "@floating-ui/dom";
import clsx from "clsx";
import type { ComponentChildren } from "preact";
import { flushSync } from "preact/compat";
import { useCallback, useContext, useLayoutEffect, useRef, useState } from "preact/hooks";

import type { MenuCommandItem, MenuItem } from "../../menus/context_menu";
import { t } from "../../services/i18n";
import { isMobile } from "../../services/utils";
import { FormDropdownDivider, FormDropdownSubmenu, FormListCustomItem, FormListHeader, FormListItem, MenuList } from "./FormList";
import { useStaticTooltipWithKeyboardShortcut, useUniqueName } from "./hooks";
import { SvgIcon } from "./Icon";
import { type ActiveRow, isRightToLeft, MenuContext, type MenuContextValue, type MenuFilter, MenuFilterContext, MenuLevelContext, type OpenSubmenu, pointerMoved, type RowEntry, shouldDropStart } from "./menu_context";
import Popup, { type PopupProps } from "./Popup";

/**
 * A menu of commands, drawn with the markup Bootstrap's dropdowns use (`.dropdown-menu`,
 * `.dropdown-item`, `.dropdown-divider`), so the stylesheets and themes that style those style
 * this too. It stands in a `Popup`, which places it; the menu is what is inside: its rows, the
 * layers of their submenus, and the keys.
 *
 * The rows come as data in {@link items}, or as components in {@link children}: `FormListItem`,
 * `FormDropdownSubmenu`, `FormDropdownDivider`, `FormListHeader` and `FormListCustomItem`.
 */
export interface MenuProps<T> extends Pick<PopupProps, "anchor" | "offset" | "container" | "portalClassName"
        | "backdropClassName" | "style" | "onClick" | "elementRef" | "aria-labelledby" | "placedByStylesheet"
        | "keepOpenSelector"> {
    id?: string;
    className?: string;
    /** The side of its anchor it prefers: beside a point towards the right, or below an element. */
    placement?: PopupProps["placement"];
    /**
     * Shows the menu as a sheet along the bottom of a phone's screen instead of beside its anchor.
     * The `.mobile-bottom-menu` rules place and cap it.
     */
    bottomSheet?: boolean;
    /**
     * Stands in the flow of the element given as `container`, as a list does, rather than beside
     * its anchor: a menu that is part of a dialog.
     */
    inline?: boolean;
    /** Makes the first or the last row the active one as the menu takes focus, for a menu a key opened. */
    startAt?: "first" | "last";
    /** Called on a press outside the menu and its anchor. It answers Escape itself, with {@link onClose}. */
    onDismiss?(): void;
    /**
     * Whether its owner still wants it, asked as it is first placed, which can come after the owner
     * closed it: a menu no longer wanted leaves focus where it is.
     */
    isWanted?(): boolean;
    items?: MenuItem<T>[];
    /**
     * For a menu of {@link items}, or of components whose rows `MenuItemRows` draws: offers an
     * input at its top that filters every item, at any depth, as `MenuCommandItem.filterable` does
     * for a submenu. Placed above its anchor, the menu is drawn bottom-up: the input at the bottom,
     * and the first row lowest and active as it opens.
     */
    filterable?: boolean;
    /**
     * For a {@link filterable} menu placed above its anchor: keeps the input at the bottom, but
     * draws the rows in their own order, the first one at the top, as in the note tree.
     */
    keepOrder?: boolean;
    /** Called when one of {@link items} is pressed with the primary button, or run from the keyboard. */
    onSelect?(item: MenuCommandItem<T>, e: MouseEvent | KeyboardEvent): void;
    children?: ComponentChildren;
    /** Called when a row that closes the menu runs, on a click inside a custom row, and on Escape. */
    onClose(): void;
}


/**
 * The keys the menu keeps while focus is inside a custom row: those that leave it, unless the
 * focused element lists the key in `data-menu-keys`. See `handlesOwnKey()`.
 */
const KEYS_LEAVING_CUSTOM_ROW = new Set([ "ArrowUp", "ArrowDown", "Escape", "Tab" ]);
/** The keys the menu always keeps while focus is in a submenu's filter input. See `isFilterKey()`. */
const KEYS_OF_FILTER = new Set([ "ArrowUp", "ArrowDown", "Enter", "Escape", "Tab" ]);
const FILTER_INPUT = "input.tn-menu-filter-input";
/** The filter of a menu's own top level, which no row opened. */
const TOP_LEVEL = { rowId: "", level: -1 };

const ACTION_TOOLTIP = { placement: "top", animation: false } as const;

/** How long typed letters keep adding to the text a row is looked up by. */
const TYPEAHEAD_TIMEOUT = 500;

export default function Menu<T>({ id, className, anchor, placement, bottomSheet, inline, startAt, items, filterable, keepOrder, onSelect, children, onClose, onDismiss, isWanted, elementRef, ...popupProps }: MenuProps<T>) {
    const menuRef = useRef<HTMLDivElement | null>(null);
    // The submenus' layers render into the menu element, which rows reach through the context.
    const [ layerHost, setLayerHost ] = useState<HTMLElement | null>(null);
    const setMenuElement = useCallback((element: HTMLDivElement | null) => {
        menuRef.current = element;
        setLayerHost(element);
        if (typeof elementRef === "function") elementRef(element);
        else if (elementRef) elementRef.current = element;
    }, [ elementRef ]);
    const [ open, setOpen ] = useState<OpenSubmenu[]>([]);
    /** The submenus whose layer waited out the stylesheet's opening delay. */
    const shownSubmenus = useRef(new WeakSet<OpenSubmenu>()).current;

    const openSubmenu = useCallback((level: number, rowId?: string, anchor?: HTMLElement, chosen = false) => {
        setOpen((current) => {
            if (rowId ? current[level]?.id === rowId : current.length <= level) return current;
            const kept = current.slice(0, level);
            const replaced = current[level];
            const immediate = chosen
                || (!!replaced && (replaced.immediate || shownSubmenus.has(replaced)));
            return rowId && anchor ? [ ...kept, { id: rowId, anchor, immediate } ] : kept;
        });
    }, [ shownSubmenus ]);
    const submenuShown = useCallback((submenu: OpenSubmenu) => {
        shownSubmenus.add(submenu);
    }, [ shownSubmenus ]);
    const [ dropStart, setDropStartLevels ] = useState<boolean[]>([]);
    const setDropStart = useCallback((level: number, value: boolean) => {
        setDropStartLevels((current) => {
            if (current[level] === value) return current;
            const next = [ ...current ];
            next[level] = value;
            return next;
        });
    }, []);
    const [ active, setActiveRow ] = useState<ActiveRow>();
    const rows = useRef(new Map<string, RowEntry>()).current;
    /** The level whose first row becomes active once it has rendered, for a submenu a key opened. */
    const pendingFirstRow = useRef<number | undefined>(undefined);
    const typeahead = useRef({ text: "", timeout: 0 });
    const [ filter, setFilterState ] = useState<MenuFilter>();
    /** The filter as the keys last left it, ahead of the render that shows it: keys come faster. */
    const filterRef = useRef<MenuFilter | undefined>(undefined);
    const setFilter = useCallback((next: MenuFilter | undefined) => {
        const previous = filterRef.current;
        if (previous && previous.level !== next?.level) holdWidth(menuRef.current, previous.level, false);
        if (next) holdWidth(menuRef.current, next.level, true);
        filterRef.current = next;
        setFilterState(next);
    }, []);
    /** Whether the keys moved the menu since the pointer last did. See `Menu.css`. */
    const [ keyboardDriven, setKeyboardDriven ] = useState(false);
    /** The placement above its anchor of a filterable menu, which is then drawn bottom-up. */
    const [ upwardPlacement, setUpwardPlacement ] = useState<Placement>();
    const bottomUp = !!upwardPlacement;
    /** Whether the top level's rows are drawn in reverse, the first row lowest. */
    const isReversed = bottomUp && !keepOrder;
    /** Whether the menu has asked to close, which it does once. */
    const closed = useRef(false);
    const close = useCallback(() => {
        closed.current = true;
        onClose();
    }, [ onClose ]);

    const setActive = useCallback((level: number, rowId: string) => {
        setActiveRow({ level, id: rowId });
        const element = rows.get(rowId)?.element;
        // The first row of a scrolling list brings what stands above it back into view, such as a
        // header, which scrolling only as far as the row would leave hidden.
        const list = element?.parentElement;
        if (list?.classList.contains("tn-menu-scroll") && !hasRowBefore(element)) list.scrollTo?.({ top: 0 });
        else element?.scrollIntoView?.({ block: "nearest" });
    }, [ rows ]);
    const registerRow = useCallback((rowId: string, row: RowEntry | undefined) => {
        if (!row) {
            rows.delete(rowId);
            return;
        }
        rows.set(rowId, row);
        // A portaled submenu can commit after this component's effects, so the level a key opened
        // looks for its first row once the rows that register with it have all done so.
        if (pendingFirstRow.current !== row.level) return;
        queueMicrotask(() => {
            if (pendingFirstRow.current !== row.level) return;
            pendingFirstRow.current = undefined;
            activateFirstRowRef.current(row.level);
        });
    }, [ rows ]);
    const context: MenuContextValue = {
        open, openSubmenu, submenuShown, active, setActive, rows, registerRow, keyboardDriven,
        isReversed, dropStart, setDropStart, close, filter, setFilter, layerHost
    };

    /** The ids of the rows the keys can stand on at `level`, in the order they stand in. */
    function navigableRows(level: number) {
        const found: [ string, RowEntry ][] = [];
        for (const [ rowId, row ] of rows) {
            if (row.level !== level) continue;
            if (row.custom ? focusTarget(row.element) : !row.disabled) found.push([ rowId, row ]);
        }
        found.sort(([ , a ], [ , b ]) => (a.element.compareDocumentPosition(b.element) & Node.DOCUMENT_POSITION_FOLLOWING ? -1 : 1));
        return found.map(([ rowId ]) => rowId);
    }

    /**
     * Makes the first row at `level` that runs something the active one, if the level has rendered.
     * The first row of a reversed menu is the lowest one.
     */
    function activateFirstRow(level: number) {
        const runnable = navigableRows(level).filter((rowId) => !rows.get(rowId)?.custom);
        const first = level === 0 && isReversed ? runnable.at(-1) : runnable[0];
        if (first) setActive(level, first);
        return !!first;
    }

    const activateFirstRowRef = useRef(activateFirstRow);
    activateFirstRowRef.current = activateFirstRow;

    // After the commit: a submenu's rows register their elements only as they mount. A filter
    // input with focus names the row too, as the keys pick it from there.
    useLayoutEffect(() => {
        const row = active && rows.get(active.id);
        const rowId = row && !row.custom ? row.element.id : undefined;
        for (const element of [ menuRef.current, filterInputIn(menuRef.current) ]) {
            if (!element) continue;
            if (rowId) element.setAttribute("aria-activedescendant", rowId);
            else element.removeAttribute("aria-activedescendant");
        }
    }, [ active, open, rows, filter ]);

    // A filter ends with the submenu it filters, as the pointer or the keys close it.
    useLayoutEffect(() => {
        const current = filterRef.current;
        if (current && current.level >= 0 && open[current.level]?.id !== current.rowId) setFilter(undefined);
    }, [ open, setFilter ]);

    // The first match, or the first row once the input is emptied, is the one Enter runs. Typing
    // that began in the menu goes on in the input.
    const lastFilter = useRef<MenuFilter | undefined>(undefined);
    useLayoutEffect(() => {
        const level = (filter ?? lastFilter.current)?.level;
        lastFilter.current = filter;
        if (level === undefined) return;
        // Rows that `MenuItemRows` draws in a component of its own render after this effect.
        activateFirstRow(level + 1);
        pendingFirstRow.current = level + 1;
        // Typing into the input moves the active row, as the keys do.
        if (filter) setKeyboardDriven(true);

        const input = filterInputIn(menuRef.current);
        if (filter && input && document.activeElement !== input) {
            input.focus({ preventScroll: true });
            input.setSelectionRange(input.value.length, input.value.length);
        }
    }, [ filter ]); // eslint-disable-line react-hooks/exhaustive-deps

    // A custom row takes focus in itself, for its own keys; any other row hands it back to the menu.
    useLayoutEffect(() => {
        const menu = menuRef.current;
        const row = active && rows.get(active.id);
        if (!menu || !row) return;
        if (row.custom) {
            focusTarget(row.element)?.focus({ preventScroll: true });
        } else if (document.activeElement !== menu && menu.contains(document.activeElement)
                && !document.activeElement?.matches(FILTER_INPUT)) {
            menu.focus({ preventScroll: true });
        }
    }, [ active, rows ]);

    const keyHandler = useRef(onKeyDown);
    keyHandler.current = onKeyDown;
    useLayoutEffect(() => {
        // Captured at the window: Bootstrap captures keys at the document for anything inside a
        // `.dropdown-menu`, and takes them for a dropdown of its own. Inside a custom row or a
        // filter input, only the keys that are the menu's, so the control there keeps its own.
        const listener = (e: KeyboardEvent) => {
            const menu = menuRef.current;
            const takes = e.target instanceof HTMLInputElement && e.target.matches(FILTER_INPUT)
                ? isFilterKey(e.target, e.key)
                : KEYS_LEAVING_CUSTOM_ROW.has(e.key) && !handlesOwnKey(e.target, e.key);
            if (e.target === menu || (menu?.contains(e.target as Node) && takes)) {
                keyHandler.current(e);
            }
        };
        window.addEventListener("keydown", listener, true);
        return () => window.removeEventListener("keydown", listener, true);
    }, []);

    function onKeyDown(e: KeyboardEvent) {
        // From a filter input, the keys act on the rows of the submenu it filters.
        const filterInput = e.target instanceof HTMLInputElement && e.target.matches(FILTER_INPUT) ? e.target : undefined;
        // On a phone, the deepest open submenu is the page on show, even before a row in it is active.
        const level = filterInput ? Number(filterInput.dataset.level) : isMobile() ? open.length : active?.level ?? 0;
        const levelRows = navigableRows(level);
        const activeHere = active?.level === level ? active : undefined;
        const index = activeHere ? levelRows.indexOf(activeHere.id) : -1;
        const count = levelRows.length;
        const activeRow = activeHere && rows.get(activeHere.id);
        // A submenu goes with its row's highlight, as in a native menu, until Right opens it again.
        const moveTo = (rowId: string) => {
            if (open[level]?.id !== rowId) openSubmenu(level);
            setActive(level, rowId);
        };
        const goTo = (position: number) => {
            const rowId = levelRows[((position % count) + count) % count];
            if (rowId) moveTo(rowId);
        };
        const openActive = () => {
            if (!activeHere || !activeRow?.hasSubmenu || activeRow.custom) return;
            openSubmenu(level, activeHere.id, activeRow.element, true);
            // A submenu already open has its rows; one opening now has them once it renders.
            if (!activateFirstRow(level + 1)) pendingFirstRow.current = level + 1;
            // Its rows take the keys, which the filter input would keep at its own level.
            if (filterInput) menuRef.current?.focus({ preventScroll: true });
        };
        const closeLevel = (closing: number) => {
            const parent = open[closing - 1];
            if (!parent) return;
            openSubmenu(closing - 1);
            setActive(closing - 1, parent.id);
        };
        const rtl = isRightToLeft();

        if (filterInput && e.key === "Escape") {
            // Emptied first; empty, it closes the submenu and gives the menu its keys back.
            if (filterInput.value) {
                setFilter(undefined);
            } else if (level === 0) {
                close();
            } else {
                closeLevel(level);
                menuRef.current?.focus({ preventScroll: true });
            }
        } else if (activeRow?.inline && !filterInput && (e.key === "ArrowLeft" || e.key === "ArrowRight")) {
            goTo(e.key === (rtl ? "ArrowLeft" : "ArrowRight") ? index + 1 : index - 1);
        } else if (filterInput || !filterKey(e, level, activeRow)) {
            switch (e.key) {
                case "ArrowDown": goTo(index + 1); break;
                case "ArrowUp": goTo(index < 0 ? -1 : index - 1); break;
                case "Home": goTo(0); break;
                case "End": goTo(-1); break;
                // Into the active row's submenu.
                case rtl ? "ArrowLeft" : "ArrowRight":
                    openActive();
                    break;
                // Out of the submenu.
                case rtl ? "ArrowRight" : "ArrowLeft":
                    if (level > 0) closeLevel(level);
                    if (filterInput) menuRef.current?.focus({ preventScroll: true });
                    break;
                case "Enter":
                case " ":
                    if (!activeRow || activeRow.custom) break;
                    openActive();
                    activeRow.select(e);
                    break;
                case "Escape":
                    // One level at a time, then the menu itself.
                    if (open.length) closeLevel(open.length);
                    else close();
                    break;
                // Focus stays in the menu until it closes.
                case "Tab": break;
                default: {
                    if (e.key.length !== 1 || e.ctrlKey || e.metaKey || e.altKey) return;
                    const typed = typeahead.current;
                    window.clearTimeout(typed.timeout);
                    typed.timeout = window.setTimeout(() => typed.text = "", TYPEAHEAD_TIMEOUT);
                    typed.text += e.key.toLowerCase();
                    // A first letter looks past the active row, so pressing it again moves on.
                    const skip = typed.text.length === 1 ? 1 : 0;
                    for (let step = skip; step < count + skip; step++) {
                        const rowId = levelRows[(index + step + count) % count];
                        if (rowId && rows.get(rowId)?.element.textContent?.trim().toLowerCase().startsWith(typed.text)) {
                            moveTo(rowId);
                            break;
                        }
                    }
                }
            }
        }
        setKeyboardDriven(true);
        e.preventDefault();
        e.stopPropagation();
    }

    /**
     * A letter typed while the menu has focus, into a filterable submenu: the one the active row
     * opened, or the nearest one the keys stand in. It goes into that submenu's filter input, which
     * takes focus for the rest. Returns whether the key went there.
     */
    function filterKey(e: KeyboardEvent, level: number, activeRow: RowEntry | undefined) {
        if (e.key.length !== 1 || e.key === " " || e.ctrlKey || e.metaKey || e.altKey) return false;
        const current = filterRef.current;
        if (current) {
            // Typed before the input took focus, as fast typing can.
            setFilter({ ...current, text: current.text + e.key });
            return true;
        }

        let target: Omit<MenuFilter, "text"> | undefined;
        if (active && activeRow?.filterable && open[level]?.id === active.id) {
            target = { rowId: active.id, level };
        }
        for (let parent = level - 1; !target && parent >= 0; parent--) {
            const rowId = open[parent]?.id;
            if (rowId && rows.get(rowId)?.filterable) target = { rowId, level: parent };
        }
        if (!target && filterable) target = TOP_LEVEL;
        if (!target) return false;
        // The submenus open inside it give way to the list of matches.
        openSubmenu(target.level + 1);
        setFilter({ ...target, text: e.key });
        return true;
    }

    // The keys go to the menu while it is up; `contextMenu` gives focus back once it is hidden. A
    // browser does not focus an element under `visibility: hidden`, so the menu takes focus only
    // once it is shown.
    function takeFocus(isBottomUp: boolean) {
        // A menu already closing, as one whose row ran before it was placed, leaves focus alone.
        if (closed.current || isWanted?.() === false) return;
        menuRef.current?.focus({ preventScroll: true });
        const isLowestFirst = isBottomUp && !keepOrder;
        if (!startAt && !isLowestFirst) return;
        const rowIds = navigableRows(0);
        // A reversed menu starts at its lowest row, however it was opened.
        const first = startAt === "first" && !isLowestFirst ? rowIds[0] : rowIds.at(-1);
        if (first) setActive(0, first);
        // Rows that are still loading get the first row once they render.
        else if (isLowestFirst || startAt === "first") pendingFirstRow.current = 0;
        setKeyboardDriven(true);
    }

    const topLevelFilter = filterable
        ? { ...TOP_LEVEL, text: filter?.level === TOP_LEVEL.level ? filter.text : "" }
        : undefined;
    const defaultPlacement = anchor instanceof HTMLElement ? "bottom-start" : "right-start";

    return (
        <MenuContext.Provider value={context}>
            <Popup
                {...popupProps}
                anchor={anchor}
                // A bottom-up menu keeps its side, so its input stays by the anchor as it shrinks.
                placement={upwardPlacement ?? placement ?? defaultPlacement}
                placedByStylesheet={popupProps.placedByStylesheet || bottomSheet || inline}
                reveal={!inline}
                onPlaced={(placed) => {
                    const isBottomUp = !!topLevelFilter
                        && placed !== "stylesheet" && placed.startsWith("top");
                    // The rows reorder before `takeFocus()` picks the row to start at.
                    if (isBottomUp) flushSync(() => setUpwardPlacement(placed));
                    const menu = menuRef.current;
                    if (menu) {
                        setDropStart(0, shouldDropStart(menu.getBoundingClientRect(),
                            document.documentElement.clientWidth, isRightToLeft(), false));
                    }
                    takeFocus(isBottomUp);
                }}
                onDismiss={onDismiss && (() => onDismiss())}
                escapeDismisses={false}
                elementRef={setMenuElement} id={id} role="menu" tabIndex={-1}
                className={clsx("dropdown-menu show tn-menu", bottomSheet && "mobile-bottom-menu", inline && "tn-menu-inline",
                    keyboardDriven && "tn-menu-keyboard", className)}
                onPointerMove={(e) => {
                    if (pointerMoved(e)) setKeyboardDriven(false);
                }}
                // Fires only when the pointer is off every level, as the submenu layers are children
                // of this element. Unless the keys drive the menu, only the deepest open submenu's
                // row stays active.
                onPointerLeave={() => {
                    if (keyboardDriven) return;
                    const deepest = open.at(-1);
                    setActiveRow(deepest && { level: open.length - 1, id: deepest.id });
                }}
                // Neither the browser's menu nor another of the app's opens over this one. Every level
                // is inside this element, so one handler covers them all.
                onContextMenu={(e) => {
                    e.preventDefault();
                    e.stopPropagation();
                }}
            >
                <MenuList filter={topLevelFilter} bottomUp={bottomUp}>
                    {items
                        ? <MenuItems items={items} bottomUp={isReversed} onSelect={onSelect} />
                        : children}
                </MenuList>
                {/* The submenus' layers follow the scroller in here, portaled by their rows. */}
            </Popup>
        </MenuContext.Provider>
    );
}

/** `items` drawn as the rows that stand for them, with a run of separators reduced to one. */
/**
 * {@link items} drawn as the rows a menu of items draws, for a menu of components or a list
 * outside any menu. A row runs its `handler`, then closes the menu it stands in, if any.
 */
export function MenuItemRows<T>({ items }: { items: MenuItem<T>[] }) {
    const menu = useContext(MenuContext);
    const level = useContext(MenuLevelContext);
    return (
        <MenuItems
            items={items} bottomUp={level === 0 && !!menu?.isReversed}
            onSelect={(item, e) => {
                item.handler?.(item, e);
                if (!item.items) menu?.close();
            }}
        />
    );
}

function MenuItems<T>({ items, bottomUp, onSelect }: {
    items: MenuItem<T>[],
    /** Draws the rows from the bottom up, the first row lowest. See {@link bottomUpOrder}. */
    bottomUp?: boolean,
    onSelect: MenuProps<T>["onSelect"]
}) {
    const filter = useContext(MenuFilterContext);
    if (filter?.text) {
        return <FilteredMenuItems
            items={items} text={filter.text} bottomUp={bottomUp} onSelect={onSelect}
        />;
    }
    const rows = menuRows(items);
    // Keyed by their place in `rows`, so a row keeps its element as the order changes.
    const order = bottomUp ? bottomUpOrder(rows) : [ ...rows.keys() ];
    return <>{order.map((index) => (
        <MenuItemRow key={index} row={rows[index]} onSelect={onSelect} />
    ))}</>;
}

/**
 * The items of a filtered submenu: every item inside it, at any depth, that matches what was
 * typed, each with the submenus it stands in and the matching part of its title marked.
 */
function FilteredMenuItems<T>({ items, text, bottomUp, onSelect }: {
    items: MenuItem<T>[],
    text: string,
    /** Draws the best match lowest. */
    bottomUp?: boolean,
    onSelect: MenuProps<T>["onSelect"]
}) {
    const matches = [ ...filterMenuItems(items, text).entries() ];
    if (bottomUp) matches.reverse();
    return <>
        {matches.length === 0 && <li className="tn-menu-filter-empty" role="none">{t("menu.no_matches")}</li>}
        {matches.map(([ index, { item, title, isName, path } ]) => (
            <FormListItem
                key={index}
                icon={item.uiIcon ?? "bx bx-empty"} iconClassName={item.iconColorClass}
                badges={item.badges?.map((badge) => ({ className: badge.className, text: badge.title }))}
                closeOnSelect={false} onClick={(e) => onSelect?.(item, e)}
            >
                <span className={clsx("tn-menu-filter-title", isName && "tn-menu-name")}>
                    {highlightMatch(title, text)}
                </span>
                {path.length > 0 && <span className="tn-menu-filter-path">{path.join(" › ")}</span>}
            </FormListItem>
        ))}
    </>;
}

function MenuItemRow<T>({ row, onSelect }: { row: MenuItem<T>, onSelect: MenuProps<T>["onSelect"] }) {
    if ("kind" in row) {
        if (row.kind === "separator") return <FormDropdownDivider />;
        // Its title is text, as it can be a name the user wrote.
        if (row.kind === "header") return <FormListHeader text={row.title} actions={row.actions} />;
        if (row.kind === "actions") return <MenuActions items={row.items} className={row.className} onSelect={onSelect} />;
        return <FormListCustomItem><row.componentFn /></FormListCustomItem>;
    }

    const { title, description, tooltip, uiIcon, iconColorClass, checked, enabled, badges, className, keyboardShortcut, shortcut, trailingText, trailingIcon, items } = row;
    // Callers pass HTML: titles escaped with `escapeHtml()` or boxed by `menuName()`.
    const label = <span dangerouslySetInnerHTML={{ __html: title }} />;
    // `onSelect` decides whether the menu closes, as `contextMenu` does.
    const select = (e: MouseEvent) => onSelect?.(row, e);

    if (items) {
        return (
            <FormDropdownSubmenu
                icon={uiIcon ?? "bx bx-empty"} title={label} disabled={enabled === false}
                className={className} onDropdownToggleClicked={select} split={!!(row.command || row.handler)}
                filterable={row.filterable}
            >
                <MenuItems items={items} onSelect={onSelect} />
            </FormDropdownSubmenu>
        );
    }

    return (
        <FormListItem
            // An item with neither keeps no slot for an icon, as an all-text menu such as spelling fixes needs.
            icon={"uiIcon" in row || "checked" in row ? uiIcon : null}
            iconClassName={iconColorClass} checked={checked} checkable={"checked" in row} disabled={enabled === false}
            description={description} title={tooltip} className={className} badges={badges?.map((badge) => ({ className: badge.className, text: badge.title }))}
            keyboardShortcut={keyboardShortcut} shortcut={shortcut} trailingText={trailingText}
            trailingIcon={trailingIcon} closeOnSelect={false}
            onClick={select}
        >
            {label}
        </FormListItem>
    );
}

/**
 * A row of items side by side, each its icon over its title. Each registers with the menu as a row
 * of its own, so the keys step through them in order.
 */
function MenuActions<T>({ items, className, onSelect }: { items: MenuCommandItem<T>[], className?: string, onSelect: MenuProps<T>["onSelect"] }) {
    return (
        <li className={clsx("tn-menu-actions", className)} role="group">
            {items.map((item, index) => <MenuAction key={index} item={item} onSelect={onSelect} />)}
        </li>
    );
}

function MenuAction<T>({ item, onSelect }: { item: MenuCommandItem<T>, onSelect: MenuProps<T>["onSelect"] }) {
    return (
        <MenuTile
            icon={item.uiIcon} iconBadge={item.uiIconBadge} title={item.title}
            tooltip={item.tooltip ?? textOf(item.title)} keyboardShortcut={item.keyboardShortcut}
            disabled={item.enabled === false} onSelect={(e) => onSelect?.(item, e)}
        />
    );
}

interface MenuTileProps {
    /** The classes of the icon, such as `bx bx-copy`. */
    icon?: string;
    /** An SVG icon, in place of {@link icon}. */
    iconSvg?: string;
    /** The classes of a small icon over the corner of the icon. */
    iconBadge?: string;
    /** The title as HTML, as for a row's. */
    title: string;
    /** The full title, which a narrow tile can cut short. */
    tooltip: string;
    keyboardShortcut?: MenuCommandItem<unknown>["keyboardShortcut"];
    disabled?: boolean;
    /** Makes the tile one that is checked or not, which a menu tells assistive technology. */
    checked?: boolean;
    onSelect(e: MouseEvent | KeyboardEvent): void;
}

/**
 * An item drawn as a tile, its icon over its title, as a `MenuActions` strip lays them out. It
 * registers with the menu as a row of its own, so the keys step through the tiles in order.
 */
export function MenuTile({ icon, iconSvg, iconBadge, title, tooltip, keyboardShortcut, disabled = false, checked, onSelect }: MenuTileProps) {
    const menu = useContext(MenuContext);
    const level = useContext(MenuLevelContext);
    const id = useUniqueName("menu-row");
    const buttonRef = useRef<HTMLButtonElement | null>(null);
    // The full title, which a narrow menu can cut short, and the shortcut a row would show. A phone
    // has no pointer to hover with and no keyboard, so it gets neither; an empty title shows none.
    const mobile = isMobile();
    useStaticTooltipWithKeyboardShortcut(buttonRef, mobile ? "" : tooltip,
        mobile ? undefined : keyboardShortcut, ACTION_TOOLTIP);

    return (
        <button
            ref={(element) => {
                buttonRef.current = element;
                menu?.registerRow(id, element
                    ? { level, element, custom: false, disabled, hasSubmenu: false, inline: true, select: onSelect }
                    : undefined);
            }}
            id={menu ? id : undefined} type="button"
            role={checked === undefined ? "menuitem" : "menuitemcheckbox"}
            aria-checked={checked}
            className={clsx("tn-menu-action", menu?.active?.id === id && "tn-menu-active")}
            disabled={disabled} tabIndex={menu ? -1 : undefined}
            // As over a row, the pointer closes the submenu open at this level, and the keyboard
            // goes on from the action it last pointed at.
            onPointerMove={(e) => {
                if (!menu || !pointerMoved(e)) return;
                if (menu.open[level]) menu.openSubmenu(level);
                if (!disabled && menu.active?.id !== id) menu.setActive(level, id);
            }}
            // A press keeps focus where it was, as on a row.
            onMouseDown={(e) => e.preventDefault()}
            onClick={onSelect}
        >
            <span className="tn-menu-action-icon" aria-hidden="true">
                {iconSvg
                    ? <SvgIcon svg={iconSvg} />
                    : <span className={clsx("tn-icon", icon ?? "bx bx-empty", iconBadge && "tn-menu-action-badged")} />}
                {iconBadge && <span className={clsx("tn-menu-action-badge", iconBadge)} />}
            </span>
            <span className="tn-menu-action-title" dangerouslySetInnerHTML={{ __html: title }} />
        </button>
    );
}

interface MenuMatch<T> {
    item: MenuCommandItem<T>;
    /** The title as text. */
    title: string;
    /** Whether the title is a name boxed by `menuName()`, whose width the match caps as well. */
    isName: boolean;
    /** The titles of the submenus the item stands in, outermost first. */
    path: string[];
}

/**
 * The items, at any depth, that run something and match `text`: every word of it is in the
 * item's title or in those of the submenus it stands in. Those whose title starts with the text
 * come first, then those whose title holds it, each group in menu order.
 */
function filterMenuItems<T>(items: MenuItem<T>[], text: string): MenuMatch<T>[] {
    const query = text.trim().toLowerCase();
    const words = query.split(/\s+/).filter(Boolean);
    const found: (MenuMatch<T> & { rank: number })[] = [];

    function collect(level: MenuItem<T>[], path: string[]) {
        for (const item of level) {
            if ("kind" in item) {
                if (item.kind === "actions") collect(item.items, path);
                continue;
            }
            const title = textOf(item.title);
            if (item.items) {
                collect(item.items, [ ...path, title ]);
                continue;
            }
            if (item.enabled === false) continue;
            const lowerTitle = title.toLowerCase();
            const haystack = [ ...path, title ].join(" ").toLowerCase();
            if (!words.every((word) => haystack.includes(word))) continue;
            const rank = lowerTitle.startsWith(query) ? 0 : lowerTitle.includes(query) ? 1 : 2;
            found.push({ item, title, isName: isMenuName(item.title), path, rank });
        }
    }

    collect(items, []);
    return found.sort((a, b) => a.rank - b.rank);
}

/** The text an item's title shows. */
function textOf(html: string) {
    return parseTitle(html).textContent ?? "";
}

/** Whether an item's title is a name boxed by `menuName()`. */
function isMenuName(html: string) {
    return !!parseTitle(html).querySelector(".tn-menu-name");
}

/**
 * An item's title, which is HTML, read through a `<template>`, whose content is inert: an `<img>`
 * in it neither loads nor runs its handlers, as one in a detached `<div>` would.
 */
function parseTitle(html: string) {
    const template = document.createElement("template");
    template.innerHTML = html;
    return template.content;
}

/** `title` with the first place the typed text, or else one of its words, occurs in it marked. */
function highlightMatch(title: string, text: string) {
    const lowerTitle = title.toLowerCase();
    const query = text.trim().toLowerCase();
    for (const candidate of [ query, ...query.split(/\s+/) ].filter(Boolean)) {
        const start = lowerTitle.indexOf(candidate);
        if (start < 0) continue;
        const end = start + candidate.length;
        return <>{title.slice(0, start)}<mark>{title.slice(start, end)}</mark>{title.slice(end)}</>;
    }
    return title;
}

/**
 * Whether a key pressed in a filter input is the menu's: Up, Down, Enter, Escape and Tab always,
 * the arrow into a submenu once the caret has nowhere further to go, and the arrow out of the
 * submenu while the input is empty. The input moves its caret with the arrows otherwise.
 */
function isFilterKey(input: HTMLInputElement, key: string) {
    if (KEYS_OF_FILTER.has(key)) return true;
    const rtl = isRightToLeft();
    if (key === (rtl ? "ArrowLeft" : "ArrowRight")) {
        return input.selectionStart === input.selectionEnd && input.selectionEnd === input.value.length;
    }
    return key === (rtl ? "ArrowRight" : "ArrowLeft") && input.value === "";
}

/** Whether a row, enabled or not, stands before `row` in its list. */
function hasRowBefore(row: Element | undefined) {
    for (let sibling = row?.previousElementSibling; sibling; sibling = sibling.previousElementSibling) {
        if (sibling.classList.contains("dropdown-item")) return true;
    }
    return false;
}

/** The filter input of the submenu open in `menu`, if one is. */
function filterInputIn(menu: HTMLElement | null) {
    return menu?.querySelector<HTMLInputElement>(FILTER_INPUT) ?? null;
}

/**
 * Holds the frame of the level a filter at `level` filters at no less than its current width, so
 * the matches do not resize it as they change, or with `hold` false releases it. Called before the
 * filter renders, while the frame still shows the rows the width is taken from.
 */
function holdWidth(menu: HTMLElement | null, level: number, hold: boolean) {
    const input = menu?.querySelector<HTMLElement>(`${FILTER_INPUT}[data-level="${level + 1}"]`);
    const frame = input?.closest<HTMLElement>(".dropdown-menu");
    if (frame) frame.style.minWidth = hold ? `${frame.offsetWidth}px` : "";
}

/**
 * Whether the element focused in a custom row handles `key` itself, as listed in the
 * space-separated `data-menu-keys` of it or an ancestor, as a date grid keeps Up and Down.
 */
function handlesOwnKey(target: EventTarget | null, key: string) {
    const owner = target instanceof Element ? target.closest<HTMLElement>("[data-menu-keys]") : null;
    return !!owner?.dataset.menuKeys?.split(" ").includes(key);
}

/** Where a custom row takes focus: the element its content marks as its way in with `tabindex="0"`. */
function focusTarget(row: HTMLElement | undefined) {
    return row?.querySelector<HTMLElement>("[tabindex='0']") ?? null;
}

/**
 * The indexes of `rows` in the order a bottom-up menu draws them, top to bottom: reversed, except
 * that each header stays above the rows it introduces. Separators that ended a header's group stay
 * between that group and the one now drawn above it.
 */
export function bottomUpOrder<T>(rows: MenuItem<T>[]): number[] {
    // A group starts at each header, and at the first row.
    const groups: number[][] = [];
    for (const [ index, row ] of rows.entries()) {
        const group = groups.at(-1);
        if (!group || isHeader(row)) groups.push([ index ]);
        else group.push(index);
    }

    const order: number[] = [];
    for (const group of groups.reverse()) {
        const header = isHeader(rows[group[0]]) ? group.shift() : undefined;
        group.reverse();
        const firstRow = group.findIndex((index) => !isSeparator(rows[index]));
        const separators = group.splice(0, firstRow < 0 ? group.length : firstRow);
        order.push(...separators);
        if (header !== undefined) order.push(header);
        order.push(...group);
    }
    return order;
}

/** The items with a run of separators reduced to one. */
function menuRows<T>(items: MenuItem<T>[]) {
    const rows: MenuItem<T>[] = [];
    for (const item of items) {
        const previous = rows.at(-1);
        if (isSeparator(item) && previous && isSeparator(previous)) continue;
        rows.push(item);
    }
    return rows;
}

function isSeparator<T>(item: MenuItem<T>) {
    return "kind" in item && item.kind === "separator";
}

function isHeader<T>(item: MenuItem<T>) {
    return "kind" in item && item.kind === "header";
}
