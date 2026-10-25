import { KeyboardActionNames } from "@triliumnext/commons";
import { Tooltip } from "bootstrap";
import { h, JSX, render } from "preact";

import note_tooltip from "../services/note_tooltip.js";
import type { NotePresetId } from "../services/note_presets.js";
import { onSystemBack } from "../services/system_back.js";
import utils from "../services/utils.js";
import { suspendModalFocusTraps } from "../widgets/react/modal_focustrap";

/**
 * Where the menu opens: beside a point, towards the right unless `orientation` says otherwise, or
 * below an element, and above it where there is no room below. Along the element, it lines up with
 * the element's start unless `centered` is set.
 */
export type ContextMenuOptions<T> = ContextMenuBaseOptions<T> & (
    | { x: number; y: number; orientation?: "left"; anchor?: undefined; centered?: undefined }
    | {
        anchor: HTMLElement; centered?: boolean;
        x?: undefined; y?: undefined; orientation?: undefined;
    }
);

interface ContextMenuBaseOptions<T> {
    selectMenuItemHandler: MenuHandler<T>;
    items: MenuItem<T>[];
    /** Offers an input at the top of the menu that filters its items. */
    filterable?: boolean;
    /** On mobile, if set to `true` then the context menu is shown near the element. If `false` (default), then the context menu is shown at the bottom of the screen. */
    forcePositionOnMobile?: boolean;
    /** Called with the element the menu renders into, before the menu takes the focus. */
    onShow?: (container: HTMLElement) => void;
    onHide?: () => void;
}

export interface CustomMenuItem {
    kind: "custom",
    componentFn: () => JSX.Element | null;
}

export interface MenuSeparatorItem {
    kind: "separator";
}

export interface MenuHeader {
    title: string;
    kind: "header";
    /** Icon buttons at the end of the heading, for secondary actions such as help or options. */
    actions?: MenuHeaderActions;
}

/** The actions of a {@link MenuHeader}: at most three. */
export type MenuHeaderActions = [] | [MenuHeaderAction] | [MenuHeaderAction, MenuHeaderAction]
    | [MenuHeaderAction, MenuHeaderAction, MenuHeaderAction];

export interface MenuHeaderAction {
    /** The classes of the icon, such as `bx bx-help-circle`. */
    icon: string;
    /** The name of the action, shown as the button's tooltip. */
    caption: string;
    /** Called after the menu closes. */
    callback: (e: MouseEvent) => void;
}

/** A row of items side by side, each drawn as its icon over its title. */
export interface MenuActionRow<T> {
    kind: "actions";
    items: MenuCommandItem<T>[];
    /** Classes added to the row, for a menu that styles its own. */
    className?: string;
}

export interface MenuItemBadge {
    title: string;
    className?: string;
}

export interface MenuCommandItem<T> {
    title: string;
    /**
     * The classes of an icon right after the title, such as a protected note's lock. Unlike markup
     * in the title, a filtered menu keeps it.
     */
    titleIcon?: string;
    /** A second line below the title, in smaller text. */
    description?: string;
    command?: T;
    type?: string;
    mime?: string;
    /**
     * The icon to display in the menu item.
     *
     * If not set, no icon is displayed and the item will appear shifted slightly to the left if there are other items with icons. To avoid this, use `bx bx-empty`.
     */
    uiIcon?: string;
    /**
     * A smaller icon set over the bottom corner of {@link uiIcon}, which tells apart items that
     * share one. Drawn in a row of actions only.
     */
    uiIconBadge?: string;
    /**
     * What the row shows as a tooltip on hover, in place of its title: for a short title that
     * needs a word of explanation, whether the row is a menu row or one of a row of actions.
     */
    tooltip?: string;
    /**
     * Classes tinting {@link uiIcon} with the colour of whatever the item stands for, as
     * `cssClassManager.createClassForColor()` and `FNote#getColorClass()` return them. Only the
     * icon is tinted, the label staying readable against the highlight.
     */
    iconColorClass?: string;
    badges?: MenuItemBadge[];
    templateNoteId?: string;
    /** The scripting preset the item creates a note from, adding a label and content to its type. */
    notePreset?: NotePresetId;
    enabled?: boolean;
    handler?: MenuHandler<T>;
    /** Runs on a middle click on the item, which leaves the menu open. */
    middleClickHandler?: (e: MouseEvent) => void;
    /** Runs on a right-click on the item, which a menu ignores otherwise. */
    contextMenuHandler?: (e: MouseEvent) => void;
    items?: MenuItem<T>[] | null;
    shortcut?: string;
    keyboardShortcut?: KeyboardActionNames;
    spellingSuggestion?: string;
    /**
     * Makes the item a checkable one and says whether it is checked. The check shows at the trailing
     * edge when the item has a {@link uiIcon} of its own, and in place of the icon when it has none.
     */
    checked?: boolean;
    /** Classes put on the item itself, for a menu styling one of its entries differently. */
    className?: string;
    /** Plain text at the trailing edge of the item, where a shortcut would go, such as a note's path. */
    trailingText?: string;
    /** An icon shown at the trailing edge of the item, where a shortcut would go. */
    trailingIcon?: string;
    /**
     * For an item with {@link items}: typing while its submenu is open filters every item inside
     * it, at any depth, into one list, which shows what was typed.
     */
    filterable?: boolean;
}

export type MenuItem<T> = MenuCommandItem<T> | CustomMenuItem | MenuSeparatorItem | MenuHeader | MenuActionRow<T>;
export type MenuHandler<T> = (item: MenuCommandItem<T>, e: MouseEvent | KeyboardEvent) => void;
export type ContextMenuEvent = PointerEvent | MouseEvent | JQuery.ContextMenuEvent;

class ContextMenu {
    private readonly cover: HTMLElement | null;
    /** What `Menu` renders into while a menu is up. */
    private host?: HTMLElement;
    private options?: ContextMenuOptions<any>;
    /** See {@link dismissedByLastPress}. */
    private pressDismissed = false;
    /** What had focus before the menu took it, and gets it back once the menu is hidden. */
    private focusBeforeShow: Element | null = null;
    private restoreModalFocusTraps?: () => void;
    /**
     * Whether a key came after the last press. A menu opened then was opened by a key, such as the
     * Menu key or Shift+F10, as callers pass no event to tell by.
     */
    private lastInputWasKey = false;
    /** Counts `show()` calls, so that only the latest one mounts a menu. */
    private lastShowRequest = 0;
    /** Stops closing the menu when the layout changes; see `show()`. */
    private stopFollowingLayout?: () => void;
    /** Stops closing the menu on the system back gesture. */
    private stopAnsweringBack?: () => void;

    constructor() {
        this.cover = utils.isMobile() ? document.getElementById("context-menu-cover") : null;

        // Capture phase, so that a host stopping its own presses, as the note tree does, cannot
        // keep them from here. `pointerdown` covers every button, including a Ctrl+right-click
        // that fires no `click`, and a tap on the mobile cover.
        document.addEventListener("pointerdown", (e) => {
            this.lastInputWasKey = false;
            const outside = this.isShown && !this.host?.contains(e.target as Node);
            this.pressDismissed = outside;
            if (outside) void this.hide();
        }, true);
        // The click a dismissing press makes is handled by then, see `dismissedByLastPress`.
        document.addEventListener("click", () => {
            setTimeout(() => this.pressDismissed = false);
        }, true);
        document.addEventListener("keydown", (e) => {
            this.lastInputWasKey = true;
            // Inside the menu, `Menu` closes one level at a time.
            if (e.key !== "Escape" || !this.isShown || this.host?.contains(e.target as Node)) return;
            // A dialog under the menu stays open.
            e.stopPropagation();
            void this.hide();
        }, true);
    }

    async show<T>(options: ContextMenuOptions<T>) {
        note_tooltip.dismissAllTooltips();
        hideShownTooltips();

        const request = ++this.lastShowRequest;
        // Loaded here rather than imported: the core services that import this module would
        // otherwise reach the widget tree through the rows `Menu` draws, in a cycle.
        const { default: Menu } = await import("../widgets/react/Menu");
        // A later `show()` made during the import replaces this one.
        if (request !== this.lastShowRequest) return;

        if (this.isShown) {
            // Unmount first so the menu opens fresh at the new location.
            await this.hide();
        }

        this.options = options;
        this.focusBeforeShow = document.activeElement;
        // The menu takes focus, which a modal's focus trap would otherwise pull back into the modal.
        this.restoreModalFocusTraps = suspendModalFocusTraps();
        // A browser showing an element fullscreen paints only that element, so the menu goes
        // inside it.
        this.host = document.createElement("div");
        (document.fullscreenElement ?? document.body).append(this.host);
        options.onShow?.(this.host);
        this.cover?.classList.add("show");
        document.body.classList.add("context-menu-shown");
        this.stopAnsweringBack = onSystemBack(() => {
            void this.hide();
            return true;
        });
        // A mobile menu is a sheet or placed at the press depending on the layout, decided here,
        // so it closes when a tablet turns past that width.
        if (utils.isMobile() && !options.forcePositionOnMobile) {
            this.stopFollowingLayout = utils.onNarrowLayoutChange(() => void this.hide());
        }

        render(h(Menu<T>, {
            // The id and classes the stylesheets, themes and `floating_layers` know this menu by.
            id: "context-menu-container",
            className: "dropdown-menu-sm dropend",
            ...(options.anchor
                ? { anchor: options.anchor, placement: options.centered ? "bottom" : undefined }
                : {
                    anchor: { x: options.x, y: options.y },
                    placement: options.orientation === "left" ? "left-start" : "right-start"
                }),
            // Already where the screen shows it: see the host above.
            container: this.host,
            bottomSheet: utils.isMobile() && utils.isNarrowLayout()
                && !options.forcePositionOnMobile,
            // As a native menu opened from the keyboard, it starts at its first row.
            startAt: this.lastInputWasKey ? "first" : undefined,
            items: options.items,
            filterable: options.filterable,
            onSelect: (item, e) => {
                // A submenu's row stays up to be opened, unless it runs something of its own.
                if (!item.items || item.handler || item.command) void this.hide();
                item.handler?.(item, e);
                options.selectMenuItemHandler(item, e);
            },
            onClose: () => void this.hide()
        }), this.host);
    }

    get isShown() {
        return !!this.options;
    }

    /**
     * Whether the press behind the click being handled put a menu away. A host whose click would
     * otherwise act, such as the calendar opening an event, does nothing for it: one press, one
     * thing.
     */
    get dismissedByLastPress() {
        return this.pressDismissed;
    }

    async hide() {
        const options = this.options;
        this.options = undefined;
        this.stopFollowingLayout?.();
        this.stopFollowingLayout = undefined;
        this.stopAnsweringBack?.();
        this.stopAnsweringBack = undefined;
        this.cover?.classList.remove("show");
        document.body.classList.remove("context-menu-shown");

        const menuHadFocus = !!this.host?.contains(document.activeElement);
        if (this.host) {
            render(null, this.host);
            this.host.remove();
            this.host = undefined;
        }

        // Traps first: re-arming one focuses its modal, which the focus given back then moves on from.
        this.restoreModalFocusTraps?.();
        this.restoreModalFocusTraps = undefined;
        // Only while the menu still held it: a press outside has already moved it where it belongs.
        if (menuHadFocus && this.focusBeforeShow instanceof HTMLElement && this.focusBeforeShow.isConnected) {
            this.focusBeforeShow.focus({ preventScroll: true });
        }
        this.focusBeforeShow = null;
        options?.onHide?.();
    }
}

const contextMenu = new ContextMenu();

export default contextMenu;

// Bootstrap sets `aria-describedby` on a trigger while its tooltip is shown. `hide()` also clears
// the hover and focus triggers that keep the tooltip up.
function hideShownTooltips() {
    for (const trigger of document.querySelectorAll("[aria-describedby]")) {
        Tooltip.getInstance(trigger)?.hide();
    }
}
