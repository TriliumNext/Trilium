import { KeyboardActionNames } from "@triliumnext/commons";
import { Tooltip } from "bootstrap";
import { h, JSX, render } from "preact";

import note_tooltip from "../services/note_tooltip.js";
import utils from "../services/utils.js";
import { suspendModalFocusTraps } from "../widgets/react/modal_focustrap";

export interface ContextMenuOptions<T> {
    x: number;
    y: number;
    orientation?: "left";
    selectMenuItemHandler: MenuHandler<T>;
    items: MenuItem<T>[];
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
}

export interface MenuItemBadge {
    title: string;
    className?: string;
}

export interface MenuCommandItem<T> {
    title: string;
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
     * Classes tinting {@link uiIcon} with the colour of whatever the item stands for, as
     * `cssClassManager.createClassForColor()` and `FNote#getColorClass()` return them. Only the
     * icon is tinted, the label staying readable against the highlight.
     */
    iconColorClass?: string;
    badges?: MenuItemBadge[];
    templateNoteId?: string;
    enabled?: boolean;
    handler?: MenuHandler<T>;
    items?: MenuItem<T>[] | null;
    shortcut?: string;
    keyboardShortcut?: KeyboardActionNames;
    spellingSuggestion?: string;
    checked?: boolean;
    /** Classes put on the item itself, for a menu styling one of its entries differently. */
    className?: string;
    /**
     * An icon shown at the trailing edge of the item, where a shortcut would go.
     *
     * Unlike {@link checked}, which takes the place of {@link uiIcon}, this leaves the item's own
     * icon standing — for a list where that icon is what tells one entry from another.
     */
    trailingIcon?: string;
    columns?: number;
}

export type MenuItem<T> = MenuCommandItem<T> | CustomMenuItem | MenuSeparatorItem | MenuHeader;
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
        // A mobile menu is a sheet or placed at the press depending on the layout, decided here,
        // so it closes when a tablet turns past that width.
        if (utils.isMobile() && !options.forcePositionOnMobile) {
            this.stopFollowingLayout = utils.onNarrowLayoutChange(() => void this.hide());
        }

        render(h(Menu<T>, {
            // The id and classes the stylesheets, themes and `floating_layers` know this menu by.
            id: "context-menu-container",
            className: "dropdown-menu-sm dropend",
            anchor: { x: options.x, y: options.y },
            placement: options.orientation === "left" ? "left-start" : "right-start",
            // Already where the screen shows it: see the host above.
            container: this.host,
            bottomSheet: utils.isMobile() && utils.isNarrowLayout()
                && !options.forcePositionOnMobile,
            // As a native menu opened from the keyboard, it starts at its first row.
            startAt: this.lastInputWasKey ? "first" : undefined,
            items: options.items,
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
