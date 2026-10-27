import {
    BalloonToolbar, BlockToolbar, ButtonView, DropdownView, type Editor, type FocusTracker,
    ListItemGroupView, ListItemView, ListSeparatorView, ListView, Plugin, SearchTextView, SplitButtonView, SwitchButtonView,
    type ToolbarConfig, type ToolbarConfigItem, ToolbarSeparatorView, type ToolbarView, type View
} from "ckeditor5";

import ContextToolbar from "./context_toolbar.js";
import TextFormattingToolbar from "./text_formatting_toolbar.js";

declare module "ckeditor5" {
    interface EditorConfig {
        toolbarGroupMenu?: {
            /** Creates the menu the toolbar groups marked `asMenu` open, once per editor. */
            host(editor: Editor): ToolbarGroupMenuHost;
        };
    }
}

/** Draws the menu of a toolbar group marked `asMenu`. See {@link ToolbarGroupMenu}. */
export interface ToolbarGroupMenuHost {
    show(request: ToolbarGroupMenuRequest): void;
    hide(): void;
    destroy(): void;
    /**
     * Whether the shown menu takes the place of the on-screen keyboard. Its button then gives that
     * place back as it closes the menu, focusing the text in the same press, as a mobile browser
     * raises the keyboard only for a focus a press makes.
     */
    isInPlaceOfKeyboard?(): boolean;
}

/** What a {@link ToolbarGroupMenuHost} shows a menu for. */
export interface ToolbarGroupMenuRequest {
    /** The group's button, which the menu opens under. */
    anchor: HTMLElement;
    items: ToolbarGroupMenuItem[];
    /**
     * `tiles` draws the entries as tiles, each its icon over its label, for a list of choices that
     * a phone shows better side by side. Left out for rows.
     */
    layout?: "tiles";
    /**
     * Receives the menu's element once it is in the page, and `null` as it leaves. The editor
     * counts focus and presses inside that element as its own, so the toolbar holding the group
     * stays open.
     */
    setElement(element: HTMLElement | null): void;
    /**
     * Called as the menu closes without running an entry. `returnFocus` puts focus back on the
     * group's button, for a menu closed with Escape rather than a press elsewhere.
     */
    onClose(returnFocus: boolean): void;
}

export type ToolbarGroupMenuItem = { kind: "separator" } | { kind: "heading"; label: string } | ToolbarGroupMenuEntry;

export interface ToolbarGroupMenuEntry {
    kind: "entry";
    label: string;
    /** The SVG of the icon of the toolbar item. */
    icon?: string;
    /** An icon-pack glyph as a class list, such as `bx bx-cog`, for an entry with no SVG. */
    iconClass?: string;
    isEnabled: boolean;
    /**
     * Whether the item is on, for a button that is on or off, as `bold` is or a row of the
     * `heading` list. Left out for any other.
     */
    isOn?: boolean;
    /** Whether the item is a switch, as the "Header row" row of `tableRow` is, for the host to draw as one. */
    isSwitch?: boolean;
    /** The classes CKEditor gives the item, such as `ck-fontsize-option text-tiny`, for the host to style. */
    className?: string;
    /** Runs the toolbar item. An entry with `children` and no action only opens them. */
    run?(): void;
    children?: ToolbarGroupMenuItem[];
}

/** How a dropdown handed to {@link openListAsMenu} is shown. */
export interface ListMenuOptions {
    /** See {@link ToolbarGroupMenuRequest.layout}. */
    layout?: "tiles";
    /**
     * Describes the menu's entries on each open, for a dropdown whose content its views do not
     * hold. `run` wraps an entry's action, so the menu hides before it runs.
     */
    describe?(run: (action: () => void) => () => void): ToolbarGroupMenuItem[];
}

/** The dropdowns handed to {@link openListAsMenu}, with their options. */
const listMenuDropdowns = new WeakMap<DropdownView, ListMenuOptions>();

/**
 * Has {@link ToolbarGroupMenu} open the list of `dropdown` as a menu of its rows, as it does a
 * group marked `asMenu`, or the buttons of its toolbar for a dropdown that holds one, as
 * `alignment` does. Without the plugin or a host, the dropdown opens its own panel.
 */
export function openListAsMenu(dropdown: DropdownView, options: ListMenuOptions = {}) {
    listMenuDropdowns.set(dropdown, options);
}

/** Whether `dropdown` was handed to {@link openListAsMenu}. */
export function isListMenu(dropdown: DropdownView) {
    return listMenuDropdowns.has(dropdown);
}

/**
 * Opens a toolbar group as a menu drawn by the host application (`toolbarGroupMenu.host`), with a
 * row of icon and label per entry, and a submenu for an entry that carries a list of its own.
 *
 * A group opts in with `asMenu: true` beside its `label` in the toolbar configuration, or with the
 * {@link ListMenuOptions} of its menu, such as `asMenu: { layout: "tiles" }`.
 * `ToolbarView#_createNestedToolbarDropdown()` builds those dropdowns and keeps no reference to the
 * definition each came from, so the labels of the opted-in groups are read from the configuration
 * and matched against the dropdown buttons. The dropdown never opens its own panel: the views
 * CKEditor lays out in it are described to the host each time it would, and a row runs its view.
 * A group holds buttons and dropdowns that list rows. A dropdown handed to {@link openListAsMenu}
 * opens as a menu of its own list's rows.
 */
export default class ToolbarGroupMenu extends Plugin {

    private watchedDropdowns = new WeakSet<DropdownView>();
    private host: ToolbarGroupMenuHost | null = null;
    /** The menu the host shows, with the dropdown it stands for, or `null`. */
    private shown: { dropdown: DropdownView; request: ToolbarGroupMenuRequest } | null = null;
    /** Set while the plugin opens a dropdown itself, to have CKEditor build its views. */
    private building = false;

    static get pluginName() {
        return "ToolbarGroupMenu" as const;
    }

    afterInit() {
        const editor = this.editor;
        const groups = collectMenuGroups(
            editor.config.get("toolbar"),
            editor.config.get("balloonToolbar"),
            editor.config.get("blockToolbar"),
            editor.config.get("textFormattingToolbar")
        );
        const menuConfig = editor.config.get("toolbarGroupMenu");
        if (!menuConfig) {
            return;
        }
        const createHost = () => menuConfig.host(editor);

        for (const toolbar of this.getToolbarViews()) {
            for (const item of toolbar.items) {
                this.watchGroupDropdown(toolbar, item, groups, createHost);
            }

            this.listenTo(toolbar.items, "add", (evt, item: View) => {
                this.watchGroupDropdown(toolbar, item, groups, createHost);
            });
        }
    }

    destroy() {
        super.destroy();
        this.host?.destroy();
    }

    /**
     * The toolbars an editor can hold: the fixed bar of a `DecoupledEditor`, the selection balloon
     * of a `BalloonEditor`, the block toolbar either of them can carry, the `TextFormattingToolbar`
     * and the `ContextToolbar`.
     */
    private getToolbarViews() {
        const editor = this.editor;
        const toolbars: ToolbarView[] = [];
        const { toolbar } = editor.ui.view as { toolbar?: ToolbarView };

        if (toolbar) {
            toolbars.push(toolbar);
        }
        if (editor.plugins.has(BalloonToolbar)) {
            toolbars.push(editor.plugins.get(BalloonToolbar).toolbarView);
        }
        if (editor.plugins.has(BlockToolbar)) {
            toolbars.push(editor.plugins.get(BlockToolbar).toolbarView);
        }
        if (editor.plugins.has(TextFormattingToolbar)) {
            toolbars.push(editor.plugins.get(TextFormattingToolbar).toolbarView);
        }
        if (editor.plugins.has(ContextToolbar)) {
            toolbars.push(editor.plugins.get(ContextToolbar).toolbarView);
        }

        return toolbars;
    }

    private watchGroupDropdown(
        toolbar: ToolbarView, item: View, groups: Map<string, ListMenuOptions>,
        createHost: () => ToolbarGroupMenuHost
    ) {
        if (!(item instanceof DropdownView) || this.watchedDropdowns.has(item)) {
            return;
        }

        const label = item.buttonView.label;
        const options = listMenuDropdowns.get(item) ?? (label ? groups.get(label) : undefined);
        if (!options) {
            return;
        }

        this.watchedDropdowns.add(item);

        // Every way of opening the dropdown sets `isOpen`, its button and the ▼ key alike, so the
        // value is turned back here and the host's menu toggles instead.
        this.listenTo<DropdownSetIsOpenEvent>(item, "set:isOpen", (evt, name, isOpen) => {
            if (!isOpen || this.building) {
                return;
            }

            evt.return = false;
            if (this.shown?.dropdown === item) {
                const toKeyboard = this.host?.isInPlaceOfKeyboard?.() ?? false;
                this.hideMenu();
                if (toKeyboard) {
                    this.editor.editing.view.focus();
                }
            } else {
                this.showMenu(toolbar, item, options, createHost);
            }
        }, { priority: "high" });
    }

    private showMenu(
        toolbar: ToolbarView, dropdown: DropdownView, options: ListMenuOptions,
        createHost: () => ToolbarGroupMenuHost
    ) {
        const editor = this.editor;
        const anchor = dropdown.buttonView.element;
        /* v8 ignore next 3 -- a dropdown is opened from its rendered button */
        if (!anchor) {
            return;
        }

        this.hideMenu();
        const host = this.host ??= createHost();

        // The toolbar's "Show more items" dropdown closes as focus or a press leaves it, so it
        // counts the menu as its own too, while it holds the group.
        const enclosing = [...toolbar.children].filter((child): child is DropdownView =>
            child instanceof DropdownView && child !== dropdown
            && !!child.element?.contains(anchor));
        const trackers = [editor.ui.focusTracker, ...enclosing.map((child) => child.focusTracker)];

        const runAction = (action: () => void) => () => {
            this.hideMenu();
            for (const child of enclosing) {
                child.isOpen = false;
            }
            editor.editing.view.focus();
            action();
        };
        const run = (view: View) => runAction(() => view.fire("execute"));

        let element: HTMLElement | null = null;
        const { describe, ...menuOptions } = options;
        let items: ToolbarGroupMenuItem[];
        if (describe) {
            items = describe(runAction);
        } else if (listMenuDropdowns.has(dropdown)) {
            items = this.describeList(dropdown, run);
        } else {
            items = describeItems(this.sourceItems(dropdown), run);
        }
        const request: ToolbarGroupMenuRequest = {
            anchor,
            items,
            ...menuOptions,
            setElement: (next) => {
                if (element) {
                    untrackElement(element, trackers);
                }
                element = next;
                if (element) {
                    trackElement(element, trackers);
                }
            },
            onClose: (returnFocus) => {
                if (this.shown?.request !== request) {
                    return;
                }
                this.shown = null;
                if (returnFocus) {
                    dropdown.buttonView.focus();
                }
            }
        };

        this.shown = { dropdown, request };
        host.show(request);
    }

    private hideMenu() {
        if (this.shown) {
            this.shown = null;
            this.host?.hide();
        }
    }

    /** The rows of a dropdown handed to {@link openListAsMenu}. */
    private describeList(dropdown: DropdownView, run: (view: View) => () => void) {
        this.building = true;
        // The dropdown builds its list or its toolbar the first time it opens.
        if (!dropdown.listView && !dropdown.toolbarView) {
            dropdown.isOpen = true;
            dropdown.isOpen = false;
        }
        const rows = dropdown.toolbarView
            ? describeItems([...dropdown.toolbarView.items], run)
            : describeListEntries(dropdown, run) ?? [];
        this.building = false;
        return rows;
    }

    /** The views CKEditor lays out in the group, which it builds the first time it is opened. */
    private sourceItems(dropdown: DropdownView) {
        if (!dropdown.toolbarView) {
            this.building = true;
            dropdown.isOpen = true;
            dropdown.isOpen = false;
            this.building = false;
        }

        /* v8 ignore next -- opening the dropdown builds its `toolbarView` */
        return [...dropdown.toolbarView?.items ?? []];
    }

}

type DropdownSetIsOpenEvent = {
    name: "set:isOpen";
    args: [name: string, value: boolean, oldValue: boolean];
    return: boolean;
};

/** Stops presses in the menu from reaching CKEditor's `clickOutsideHandler()` on the document. */
function stopPress(e: Event) {
    e.stopPropagation();
}

function trackElement(element: HTMLElement, trackers: FocusTracker[]) {
    element.addEventListener("mousedown", stopPress);
    for (const tracker of trackers) {
        tracker.add(element);
    }
}

function untrackElement(element: HTMLElement, trackers: FocusTracker[]) {
    element.removeEventListener("mousedown", stopPress);
    for (const tracker of trackers) {
        tracker.remove(element);
    }
}

/** The labels of the groups marked `asMenu`, with the options of their menus. */
function collectMenuGroups(...configs: (ToolbarConfig | undefined)[]) {
    const groups = new Map<string, ListMenuOptions>();

    for (const config of configs) {
        collectFromItems(Array.isArray(config) ? config : config?.items, groups);
    }

    return groups;
}

function collectFromItems(items: ToolbarConfigItem[] | undefined, groups: Map<string, ListMenuOptions>) {
    for (const item of items ?? []) {
        if (typeof item === "string") {
            continue;
        }

        const { asMenu } = item as { asMenu?: boolean | ListMenuOptions };
        if (asMenu) {
            groups.set(item.label, asMenu === true ? {} : asMenu);
        }

        collectFromItems(item.items, groups);
    }
}

/**
 * The entries `items` stand for, with a rule wherever the group has a separator between entries.
 * A dropdown's list is read now, as `dateTime` fills its list with the time it is opened at.
 */
function describeItems(items: View[], run: (view: View) => () => void) {
    const described: ToolbarGroupMenuItem[] = [];

    for (const item of items) {
        if (item instanceof ToolbarSeparatorView) {
            addRule(described);
        } else if (item instanceof ButtonView) {
            described.push(describeButton(item, run(item)));
        } else if (item instanceof DropdownView) {
            const children = describeListEntries(item, run);
            if (!children) {
                continue;
            }

            // A list with no rows, such as the templates before there are any, is drawn disabled
            // rather than left out, so the place of the entry does not change.
            const opener = item.buttonView;
            const split = opener instanceof SplitButtonView;
            described.push({
                kind: "entry",
                label: opener.label ?? "",
                icon: opener.icon,
                isEnabled: item.isEnabled && (split || children.length > 0),
                run: split ? run(opener) : undefined,
                children: children.length ? children : undefined
            });
        }
    }

    trimRule(described);
    return described;
}

/**
 * The rows of the list `dropdown` holds, with a rule wherever the list has a separator, or
 * `undefined` for a dropdown that holds no list.
 */
function describeListEntries(dropdown: DropdownView, run: (view: View) => () => void) {
    const entries = listEntriesOf(dropdown);
    if (!entries) {
        return undefined;
    }

    const rows: ToolbarGroupMenuItem[] = [];
    for (const entry of entries) {
        if (entry instanceof ListSeparatorView) {
            addRule(rows);
        } else if (entry instanceof ListItemGroupView) {
            rows.push({ kind: "heading", label: entry.label });
        } else {
            rows.push(describeButton(entry, run(entry)));
        }
    }
    trimRule(rows);
    return rows;
}

/** Adds a rule after the entries `items` holds, unless it would lead or double one. */
function addRule(items: ToolbarGroupMenuItem[]) {
    if (items.length && items.at(-1)?.kind !== "separator") {
        items.push({ kind: "separator" });
    }
}

function trimRule(items: ToolbarGroupMenuItem[]) {
    if (items.at(-1)?.kind === "separator") {
        items.pop();
    }
}

function describeButton(view: ButtonView, run: () => void): ToolbarGroupMenuEntry {
    const entry: ToolbarGroupMenuEntry = {
        kind: "entry", label: view.label ?? "", icon: view.icon, isEnabled: view.isEnabled, run
    };
    if (view instanceof SwitchButtonView) {
        entry.isSwitch = true;
        entry.isOn = view.isOn;
    } else if (view.isToggleable || view.role === "menuitemradio" || view.role === "menuitemcheckbox") {
        entry.isOn = view.isOn;
    }
    if (view.class) {
        entry.className = view.class;
    }
    return entry;
}

/**
 * The rows a dropdown's list holds, which it builds the first time it is opened: its own, or that
 * of a search panel, as `insertTemplate` has.
 */
function listEntriesOf(dropdown: DropdownView) {
    const wasOpen = dropdown.isOpen;
    dropdown.isOpen = true;
    dropdown.isOpen = wasOpen;

    const listView = dropdown.listView ?? searchedListOf(dropdown);
    if (!listView) {
        return undefined;
    }

    return listItemEntries(listView.items);
}

/** The buttons and separators of a list's items, a group's label before its own. */
function listItemEntries(items: Iterable<View>) {
    const entries: Array<ButtonView | ListSeparatorView | ListItemGroupView> = [];
    for (const item of items) {
        if (item instanceof ListSeparatorView) {
            entries.push(item);
        } else if (item instanceof ListItemGroupView) {
            entries.push(item, ...listItemEntries(item.items));
        } else if (item instanceof ListItemView && item.children.first instanceof ButtonView) {
            entries.push(item.children.first);
        }
    }
    return entries;
}

function searchedListOf(dropdown: DropdownView) {
    for (const child of dropdown.panelView.children) {
        if (child instanceof SearchTextView && child.filteredView instanceof ListView) {
            return child.filteredView;
        }
    }
    return undefined;
}
