import { KeyboardActionNames } from "@triliumnext/commons";
import keyboardActionService, { getActionSync } from "../services/keyboard_actions.js";
import note_tooltip from "../services/note_tooltip.js";
import utils from "../services/utils.js";
import { h, JSX, render } from "preact";

export interface ContextMenuOptions<T> {
    x: number;
    y: number;
    orientation?: "left";
    selectMenuItemHandler: MenuHandler<T>;
    items: MenuItem<T>[];
    /** On mobile, if set to `true` then the context menu is shown near the element. If `false` (default), then the context menu is shown at the bottom of the screen. */
    forcePositionOnMobile?: boolean;
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
    /**
     * The icon to display in the menu item.
     *
     * If not set, no icon is displayed and the item will appear shifted slightly to the left if there are other items with icons. To avoid this, use `bx bx-empty`.
     */
    uiIcon?: string;
    badges?: MenuItemBadge[];
    templateNoteId?: string;
    enabled?: boolean;
    handler?: MenuHandler<T>;
    items?: MenuItem<T>[] | null;
    shortcut?: string;
    keyboardShortcut?: KeyboardActionNames;
    spellingSuggestion?: string;
    checked?: boolean;
    columns?: number;
}

export type MenuItem<T> = MenuCommandItem<T> | CustomMenuItem | MenuSeparatorItem | MenuHeader;
export type MenuHandler<T> = (item: MenuCommandItem<T>, e: JQuery.MouseDownEvent<HTMLElement, undefined, HTMLElement, HTMLElement>) => void;
export type ContextMenuEvent = PointerEvent | MouseEvent | JQuery.ContextMenuEvent;

class ContextMenu {
    private $widget: JQuery<HTMLElement>;
    private $cover: JQuery<HTMLElement>;
    private options?: ContextMenuOptions<any>;
    private isMobile: boolean;

    constructor() {
        this.$widget = $("#context-menu-container");
        this.$cover = $("#context-menu-cover");
        this.$widget.addClass("dropend");
        this.isMobile = utils.isMobile();

        if (this.isMobile) {
            this.$cover.on("click", () => this.hide());
        } else {
            $(document).on("click", (e) => this.hide());
        }
    }

    async show<T>(options: ContextMenuOptions<T>) {
        this.options = options;

        note_tooltip.dismissAllTooltips();

        if (this.$widget.hasClass("show")) {
            // The menu is already visible. Hide the menu then open it again
            // at the new location to re-trigger the opening animation.
            await this.hide();
        }

        this.$widget.toggleClass("mobile-bottom-menu", !this.options.forcePositionOnMobile);
        this.$cover.addClass("show");
        $("body").addClass("context-menu-shown");

        this.$widget.empty();

        this.addItems(this.$widget, options.items);

        keyboardActionService.updateDisplayedShortcuts(this.$widget);

        this.positionMenu();
    }

    positionMenu() {
        if (!this.options) {
            return;
        }

        // the code below tries to detect when dropdown would overflow from page
        // in such case we'll position it above click coordinates, so it will fit into the client

        const CONTEXT_MENU_PADDING = 5; // How many pixels to pad the context menu from edge of screen
        const CONTEXT_MENU_OFFSET = 0; // How many pixels to offset the context menu by relative to cursor, see #3157

        const clientHeight = document.documentElement.clientHeight;
        const clientWidth = document.documentElement.clientWidth;
        const contextMenuHeight = this.$widget.outerHeight();
        const contextMenuWidth = this.$widget.outerWidth();
        let top, left;

        if (contextMenuHeight && this.options.y + contextMenuHeight - CONTEXT_MENU_OFFSET > clientHeight - CONTEXT_MENU_PADDING) {
            // Overflow: bottom
            top = clientHeight - contextMenuHeight - CONTEXT_MENU_PADDING;
        } else if (this.options.y - CONTEXT_MENU_OFFSET < CONTEXT_MENU_PADDING) {
            // Overflow: top
            top = CONTEXT_MENU_PADDING;
        } else {
            top = this.options.y - CONTEXT_MENU_OFFSET;
        }

        if (this.options.orientation === "left" && contextMenuWidth) {
            if (this.options.x + CONTEXT_MENU_OFFSET > clientWidth - CONTEXT_MENU_PADDING) {
                // Overflow: right
                left = clientWidth - contextMenuWidth - CONTEXT_MENU_OFFSET;
            } else if (this.options.x - contextMenuWidth + CONTEXT_MENU_OFFSET < CONTEXT_MENU_PADDING) {
                // Overflow: left
                left = CONTEXT_MENU_PADDING;
            } else {
                left = this.options.x - contextMenuWidth + CONTEXT_MENU_OFFSET;
            }
        } else {
            if (contextMenuWidth && this.options.x + contextMenuWidth - CONTEXT_MENU_OFFSET > clientWidth - CONTEXT_MENU_PADDING) {
                // Overflow: right
                left = clientWidth - contextMenuWidth - CONTEXT_MENU_PADDING;
            } else if (this.options.x - CONTEXT_MENU_OFFSET < CONTEXT_MENU_PADDING) {
                // Overflow: left
                left = CONTEXT_MENU_PADDING;
            } else {
                left = this.options.x - CONTEXT_MENU_OFFSET;
            }
        }

        this.$widget
            .css({
                display: "block",
                top,
                left
            })
            .addClass("show");
    }

    addItems($parent: JQuery<HTMLElement>, items: MenuItem<any>[], multicolumn = false) {
        let $group = $parent; // The current group or parent element to which items are being appended
        let shouldStartNewGroup = false; // If true, the next item will start a new group
        let shouldResetGroup = false; // If true, the next item will be the last one from the group
        let prevItemKind: string = "";

        for (let index = 0; index < items.length; index++) {
            const item = items[index];
            const itemKind = ("kind" in item) ? item.kind : "";

            if (!item) {
                continue;
            }

            // If the current item is a header, start a new group. This group will contain the
            // header and the next item that follows the header.
            if (itemKind === "header") {
                if (multicolumn && !shouldResetGroup) {
                    shouldStartNewGroup = true;
                }
            }

            // If the next item is a separator, start a new group. This group will contain the
            // current item, the separator, and the next item after the separator.
            const nextItem = (index < items.length - 1) ? items[index + 1] : null;
            if (multicolumn && nextItem && "kind" in nextItem && nextItem.kind === "separator") {
                if (!shouldResetGroup) {
                    shouldStartNewGroup = true;
                } else {
                    shouldResetGroup = true; // Continue the current group
                }
            }

            // Create a new group to avoid column breaks before and after the seaparator / header.
            // This is a workaround for Firefox not supporting break-before / break-after: avoid
            // for columns.
            if (shouldStartNewGroup) {
                $group = $("<div class='dropdown-no-break'>");
                $parent.append($group);
                shouldStartNewGroup = false;
            }

            if (itemKind === "separator") {
                if (prevItemKind === "separator") {
                    // Skip consecutive separators
                    continue;
                }
                $group.append($("<div>").addClass("dropdown-divider"));
                shouldResetGroup = true; // End the group after the next item
            } else if (itemKind === "header") {
                $group.append($("<h6>").addClass("dropdown-header").text((item as MenuHeader).title));
                shouldResetGroup = true;
            } else {
                if (itemKind === "custom") {
                    // Custom menu item
                    $group.append(this.createCustomMenuItem(item as CustomMenuItem));
                } else {
                    // Standard menu item
                    $group.append(this.createMenuItem(item as MenuCommandItem<any>));
                }

                // After adding a menu item, if the previous item was a separator or header,
                // reset the group so that the next item will be appended directly to the parent.
                if (shouldResetGroup) {
                    $group = $parent;
                    shouldResetGroup = false;
                };
            }

            prevItemKind = itemKind;

        }
    }

    private createCustomMenuItem(item: CustomMenuItem) {
        const element = document.createElement("li");
        element.classList.add("dropdown-custom-item");
        element.onclick = () => this.hide();
        render(h(item.componentFn, {}), element);
        return element;
    }

    private createMenuItem(item: MenuCommandItem<any>) {
        const $icon = $("<span>");

        if ("uiIcon" in item || "checked" in item) {
            const icon = (item.checked ? "bx bx-check" : item.uiIcon);
            if (icon) {
                $icon.addClass(icon);
            } else {
                $icon.append("&nbsp;");
            }
        }

        const $link = $("<span>")
            .append($icon)
            .append(" &nbsp; ") // some space between icon and text
            .append(item.title);

        if ("badges" in item && item.badges) {
            for (let badge of item.badges) {
                const badgeElement = $(`<span class="badge">`).text(badge.title);

                if (badge.className) {
                    badgeElement.addClass(badge.className);
                }

                $link.append(badgeElement);
            }
        }

        if ("keyboardShortcut" in item && item.keyboardShortcut) {
            const shortcuts = getActionSync(item.keyboardShortcut).effectiveShortcuts;
            if (shortcuts) {
                const allShortcuts: string[] = [];
                for (const effectiveShortcut of shortcuts) {
                    allShortcuts.push(effectiveShortcut.split("+")
                        .map(key => `<kbd>${key}</kbd>`)
                        .join("+"));
                }

                if (allShortcuts.length) {
                    const container = $("<span>").addClass("keyboard-shortcut");
                    container.append($(allShortcuts.join(",")));
                    $link.append(container);
                }
            }
        } else if ("shortcut" in item && item.shortcut) {
            $link.append($("<kbd>").text(item.shortcut));
        }

        const $item = $("<li>")
            .addClass("dropdown-item")
            .append($link)
            .on("contextmenu", (e) => false)
            // important to use mousedown instead of click since the former does not change focus
            // (especially important for focused text for spell check)
            .on("mousedown", (e) => {
                if (e.which !== 1) {
                    // only left click triggers menu items
                    return false;
                }

                if (this.isMobile && "items" in item && item.items) {
                    const $item = $(e.target).closest(".dropdown-item");

                    $item.toggleClass("submenu-open");
                    $item.find("ul.dropdown-menu").toggleClass("show");
                    return false;
                }

                // Prevent submenu from failing to expand on mobile
                if (!("items" in item && item.items)) {
                    this.hide();
                }

                if ("handler" in item && item.handler) {
                    item.handler(item, e);
                }

                this.options?.selectMenuItemHandler(item, e);

                // it's important to stop the propagation especially for sub-menus, otherwise the event
                // might be handled again by top-level menu
                return false;
            });

        if ("enabled" in item && item.enabled !== undefined && !item.enabled) {
            $item.addClass("disabled");
        }

        if ("items" in item && item.items) {
            $item.addClass("dropdown-submenu");
            $link.addClass("dropdown-toggle");

            const $subMenu = $("<ul>").addClass("dropdown-menu");
            const hasColumns = !!item.columns && item.columns > 1;
            if (!this.isMobile && hasColumns) {
                $subMenu.css("column-count", item.columns!);
            }

            this.addItems($subMenu, item.items, hasColumns);

            $item.append($subMenu);
        }
        return $item;
    }

    async hide() {
        this.options?.onHide?.();
        this.$widget.removeClass("show");
        this.$cover.removeClass("show");
        $("body").removeClass("context-menu-shown");
        this.$widget.hide();
    }
}

const contextMenu = new ContextMenu();

export default contextMenu;
