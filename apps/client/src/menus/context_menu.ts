import keyboardActionService from "../services/keyboard_actions.js";
import note_tooltip from "../services/note_tooltip.js";
import utils from "../services/utils.js";

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

interface MenuSeparatorItem {
    title: "----";
}

export interface MenuItemBadge {
    title: string;
    className?: string;
}

export interface MenuCommandItem<T> {
    title: string;
    command?: T;
    type?: string;
    uiIcon?: string;
    badges?: MenuItemBadge[];
    templateNoteId?: string;
    enabled?: boolean;
    handler?: MenuHandler<T>;
    items?: MenuItem<T>[] | null;
    shortcut?: string;
    spellingSuggestion?: string;
    checked?: boolean;
}

export type MenuItem<T> = MenuCommandItem<T> | MenuSeparatorItem;
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
                top: top,
                left: left
            })
            .addClass("show");
    }

    addItems($parent: JQuery<HTMLElement>, items: MenuItem<any>[]) {
        for (const item of items) {
            if (!item) {
                continue;
            }

            if (item.title === "----") {
                $parent.append($("<div>").addClass("dropdown-divider"));
            } else {
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

                if ("shortcut" in item && item.shortcut) {
                    $link.append($("<kbd>").text(item.shortcut));
                }

                const $item = $("<li>")
                    .addClass("dropdown-item")
                    .append($link)
                    .on("contextmenu", (e) => false)
                    // important to use mousedown instead of click since the former does not change focus
                    // (especially important for focused text for spell check)
                    .on("mousedown", (e) => {
                        e.stopPropagation();

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

                        if ("handler" in item && item.handler) {
                            item.handler(item, e);
                        }

                        this.options?.selectMenuItemHandler(item, e);

                        // it's important to stop the propagation especially for sub-menus, otherwise the event
                        // might be handled again by top-level menu
                        return false;
                    });

                $item.on("mouseup", (e) => {
                    // Prevent submenu from failing to expand on mobile
                    if (!this.isMobile || !("items" in item && item.items)) {
                        e.stopPropagation();
                        // Hide the content menu on mouse up to prevent the mouse event from propagating to the elements below.
                        this.hide();
                        return false;
                    }
                });

                if ("enabled" in item && item.enabled !== undefined && !item.enabled) {
                    $item.addClass("disabled");
                }

                if ("items" in item && item.items) {
                    $item.addClass("dropdown-submenu");
                    $link.addClass("dropdown-toggle");

                    const $subMenu = $("<ul>").addClass("dropdown-menu");

                    this.addItems($subMenu, item.items);

                    $item.append($subMenu);
                }

                $parent.append($item);
            }
        }
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
