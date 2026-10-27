import type { RefObject } from "preact";
import { useEffect, useMemo } from "preact/hooks";

import type { CommandNames } from "../../../components/app_context";
import contextMenu, { type ContextMenuOptions, type MenuItem } from "../../../menus/context_menu";
import linkContextMenu from "../../../menus/link_context_menu";
import {
    type ContentEmbedTool, type ContentEmbedToolProvider, registerContentEmbedTools
} from "./content_embed_tools";
import { findTextEditorAround } from "./editable_embed";

/** A menu that a button of the embed toolbar opens below it. */
export interface ContentEmbedMenu {
    id: string;
    /** The name of the menu, shown as the tooltip of its button. */
    title: string;
    /** The text of the button, such as the current setting. */
    text: string;
    items: MenuItem<unknown>[];
    /** Offers an input at the top of the menu that filters its items. */
    filterable?: boolean;
}

/** What `ContentEmbedMenus` adds to the embed toolbar besides its buttons. */
export interface ContentEmbedMenusOptions {
    /** Whether the toolbar and the menu of the embed offer the Editable toggle. On by default. */
    hasEditableFlag?: boolean;
    /** An SVG icon that the box size dropdown shows in place of the name of the box size. */
    boxSizeIcon?: string;
}

/**
 * Adds a button for each of `menus` to the toolbar of the embed around `rootRef`, besides the
 * Editable toggle unless `hasEditableFlag` is off, and `menuItems` to the menu of the embed. Both
 * follow their arguments as they change.
 */
export function useContentEmbedMenus(
    rootRef: RefObject<HTMLElement | null>,
    menus: ContentEmbedMenu[],
    menuItems: MenuItem<CommandNames>[] = [],
    { hasEditableFlag = true, boxSizeIcon }: ContentEmbedMenusOptions = {}
) {
    // The toolbar reads the options when the provider of the selected embed changes.
    const provider = useMemo(
        () => new ContentEmbedMenus(rootRef, { hasEditableFlag, boxSizeIcon }),
        [ rootRef, hasEditableFlag, boxSizeIcon ]
    );

    useEffect(() => provider.setMenus(menus, menuItems));

    useEffect(() => {
        const root = rootRef.current;
        if (!root) return;

        return registerContentEmbedTools(root, provider);
    }, [ rootRef, provider ]);
}

/** The buttons of the embed toolbar that open menus with `contextMenu`. */
export class ContentEmbedMenus implements ContentEmbedToolProvider {
    readonly hasEditableFlag: boolean;
    readonly boxSizeIcon: string | undefined;
    private menus: ContentEmbedMenu[] = [];
    private menuItems: MenuItem<CommandNames>[] = [];
    /** The menu that is open, whose button shows as on. */
    private openMenuId: string | null = null;
    /** The menu that closed last. */
    private closedMenuId: string | null = null;
    private listeners = new Set<() => void>();
    /** The tools as last notified, to notify the listeners only when they change. */
    private shownTools = "";

    constructor(
        private readonly rootRef: RefObject<HTMLElement | null>,
        { hasEditableFlag = true, boxSizeIcon }: ContentEmbedMenusOptions = {}
    ) {
        this.hasEditableFlag = hasEditableFlag;
        this.boxSizeIcon = boxSizeIcon;
    }

    /** Sets the menus of the buttons, and the items of the menu of the embed. */
    setMenus(menus: ContentEmbedMenu[], menuItems: MenuItem<CommandNames>[] = []) {
        this.menus = menus;
        this.menuItems = menuItems;
        this.update();
    }

    getMenuItems() {
        return this.menuItems;
    }

    getTools(): ContentEmbedTool[] {
        return this.menus.map(({ id, title, text }) => ({
            id,
            label: title,
            text,
            opensMenu: true,
            isOn: id === this.openMenuId,
            group: "menus"
        }));
    }

    /** Every button opens a menu, with `openMenu()`. */
    execute() {}

    openMenu(id: string, anchor: HTMLElement) {
        const menu = this.menus.find((candidate) => candidate.id === id);
        // A press on the button of the open menu only closes the menu.
        if (!menu || (contextMenu.dismissedByLastPress && this.closedMenuId === id)) return;

        const editor = findTextEditorAround(this.rootRef.current);
        const editorFocus: Pick<ContextMenuOptions<unknown>, "onShow" | "onHide"> = editor
            ? linkContextMenu.keepEditorFocused(editor)
            : {};
        const { pageX, pageY } = linkContextMenu.getOriginBelow(anchor);
        void contextMenu.show({
            x: pageX,
            y: pageY,
            items: menu.items,
            filterable: menu.filterable,
            selectMenuItemHandler: () => {},
            onShow: (container) => {
                editorFocus.onShow?.(container);
                this.setOpenMenu(id);
            },
            onHide: () => {
                editorFocus.onHide?.();
                this.closedMenuId = id;
                this.setOpenMenu(null);
            }
        });
    }

    subscribe(callback: () => void) {
        this.listeners.add(callback);
        return () => {
            this.listeners.delete(callback);
        };
    }

    private setOpenMenu(id: string | null) {
        this.openMenuId = id;
        this.update();
    }

    private update() {
        const shownTools = JSON.stringify(this.getTools());
        if (shownTools !== this.shownTools) {
            this.shownTools = shownTools;
            for (const listener of this.listeners) {
                listener();
            }
        }
    }
}
