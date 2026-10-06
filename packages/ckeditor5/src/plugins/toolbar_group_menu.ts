import {
    BalloonToolbar, BlockToolbar, ButtonView, DropdownView, type Editor, type FocusTracker,
    ListItemView, ListSeparatorView, Plugin, SplitButtonView, type ToolbarConfig,
    type ToolbarConfigItem, ToolbarSeparatorView, type ToolbarView, type View
} from "ckeditor5";

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
}

/** What a {@link ToolbarGroupMenuHost} shows a menu for. */
export interface ToolbarGroupMenuRequest {
    /** The group's button, which the menu opens under. */
    anchor: HTMLElement;
    items: ToolbarGroupMenuItem[];
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

export type ToolbarGroupMenuItem = { kind: "separator" } | ToolbarGroupMenuEntry;

export interface ToolbarGroupMenuEntry {
    kind: "entry";
    label: string;
    /** The SVG of the icon of the toolbar item. */
    icon?: string;
    isEnabled: boolean;
    /** Runs the toolbar item. An entry with `children` and no action only opens them. */
    run?(): void;
    children?: ToolbarGroupMenuItem[];
}

/**
 * Opens a toolbar group as a menu drawn by the host application (`toolbarGroupMenu.host`), with a
 * row of icon and label per entry, and a submenu for an entry that carries a list of its own.
 *
 * A group opts in with `asMenu: true` beside its `label` in the toolbar configuration.
 * `ToolbarView#_createNestedToolbarDropdown()` builds those dropdowns and keeps no reference to the
 * definition each came from, so the labels of the opted-in groups are read from the configuration
 * and matched against the dropdown buttons. The dropdown never opens its own panel: the views
 * CKEditor lays out in it are described to the host each time it would, and a row runs its view.
 * A group holds buttons and dropdowns that list rows.
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
        const labels = collectMenuGroupLabels(
            editor.config.get("toolbar"),
            editor.config.get("balloonToolbar"),
            editor.config.get("blockToolbar")
        );
        const menuConfig = editor.config.get("toolbarGroupMenu");
        if (!labels.size || !menuConfig) {
            return;
        }
        const createHost = () => menuConfig.host(editor);

        for (const toolbar of this.getToolbarViews()) {
            for (const item of toolbar.items) {
                this.watchGroupDropdown(toolbar, item, labels, createHost);
            }

            this.listenTo(toolbar.items, "add", (evt, item: View) => {
                this.watchGroupDropdown(toolbar, item, labels, createHost);
            });
        }
    }

    destroy() {
        super.destroy();
        this.host?.destroy();
    }

    /**
     * The toolbars an editor can hold: the fixed bar of a `DecoupledEditor`, the selection balloon
     * of a `BalloonEditor`, and the block toolbar either of them can carry.
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

        return toolbars;
    }

    private watchGroupDropdown(
        toolbar: ToolbarView, item: View, labels: Set<string>, createHost: () => ToolbarGroupMenuHost
    ) {
        if (!(item instanceof DropdownView) || this.watchedDropdowns.has(item)) {
            return;
        }

        const label = item.buttonView.label;
        if (!label || !labels.has(label)) {
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
                this.hideMenu();
            } else {
                this.showMenu(toolbar, item, createHost);
            }
        }, { priority: "high" });
    }

    private showMenu(
        toolbar: ToolbarView, dropdown: DropdownView, createHost: () => ToolbarGroupMenuHost
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

        const run = (view: View) => () => {
            this.hideMenu();
            for (const child of enclosing) {
                child.isOpen = false;
            }
            editor.editing.view.focus();
            view.fire("execute");
        };

        let element: HTMLElement | null = null;
        const request: ToolbarGroupMenuRequest = {
            anchor,
            items: describeItems(this.sourceItems(dropdown), run),
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

function collectMenuGroupLabels(...configs: (ToolbarConfig | undefined)[]) {
    const labels = new Set<string>();

    for (const config of configs) {
        collectFromItems(Array.isArray(config) ? config : config?.items, labels);
    }

    return labels;
}

function collectFromItems(items: ToolbarConfigItem[] | undefined, labels: Set<string>) {
    for (const item of items ?? []) {
        if (typeof item === "string") {
            continue;
        }

        if ((item as { asMenu?: boolean }).asMenu) {
            labels.add(item.label);
        }

        collectFromItems(item.items, labels);
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
            const children: ToolbarGroupMenuItem[] = [];
            for (const entry of listEntriesOf(item)) {
                if (entry instanceof ListSeparatorView) {
                    addRule(children);
                } else {
                    children.push(describeButton(entry, run(entry)));
                }
            }
            trimRule(children);
            if (!children.length) {
                continue;
            }

            const opener = item.buttonView;
            described.push({
                kind: "entry",
                label: opener.label ?? "",
                icon: opener.icon,
                isEnabled: item.isEnabled,
                run: opener instanceof SplitButtonView ? run(opener) : undefined,
                children
            });
        }
    }

    trimRule(described);
    return described;
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
    return {
        kind: "entry", label: view.label ?? "", icon: view.icon, isEnabled: view.isEnabled, run
    };
}

/** The rows a dropdown's own list holds, which it builds the first time it is opened. */
function listEntriesOf(dropdown: DropdownView) {
    const wasOpen = dropdown.isOpen;
    dropdown.isOpen = true;
    dropdown.isOpen = wasOpen;

    const entries: Array<ButtonView | ListSeparatorView> = [];
    for (const item of dropdown.listView?.items ?? []) {
        if (item instanceof ListSeparatorView) {
            entries.push(item);
        } else if (item instanceof ListItemView && item.children.first instanceof ButtonView) {
            entries.push(item.children.first);
        }
    }

    return entries;
}
