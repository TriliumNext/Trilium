import {
    addMenuToDropdown, BalloonToolbar, BlockToolbar, type Button, ButtonView,
    type DropdownMenuDefinition, DropdownMenuListItemButtonView, DropdownMenuListItemView,
    type DropdownMenuNestedMenuView, type DropdownMenuRootListView, DropdownView, ListItemView,
    ListSeparatorView, Plugin,
    SplitButtonView, type ToolbarConfig, type ToolbarConfigItem,
    ToolbarSeparatorView, type ToolbarView, type View
} from "ckeditor5";
import "../theme/toolbar_group_menu.css";

/**
 * Opens a toolbar group as a dropdown menu — a row of icon and label per entry, and a submenu
 * for an entry that carries a list of its own — rather than as a strip of icons.
 *
 * A group opts in with `asMenu: true` beside its `label` in the toolbar configuration.
 * `ToolbarView#_createNestedToolbarDropdown()` builds those dropdowns and keeps no reference to the
 * definition each came from, so the labels of the opted-in groups are read from the configuration
 * and matched against the dropdown buttons. The views CKEditor lays out in the group are what the
 * menu is built from: a row mirrors the label, icon and enabled state of one of them, and runs it.
 */
export default class ToolbarGroupMenu extends Plugin {

    private watchedDropdowns = new WeakSet<DropdownView>();
    private plans = new WeakMap<DropdownView, MenuPlan>();
    private sourceToolbars = new Set<ToolbarView>();

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
        if (!labels.size) {
            return;
        }

        for (const toolbar of this.getToolbarViews()) {
            for (const item of toolbar.items) {
                this.watchGroupDropdown(item, labels);
            }

            this.listenTo(toolbar.items, "add", (evt, item: View) => {
                this.watchGroupDropdown(item, labels);
            });
        }
    }

    destroy() {
        super.destroy();

        for (const toolbar of this.sourceToolbars) {
            toolbar.destroy();
        }
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

    private watchGroupDropdown(item: View, labels: Set<string>) {
        if (!(item instanceof DropdownView) || this.watchedDropdowns.has(item)) {
            return;
        }

        const label = item.buttonView.label;
        if (!label || !labels.has(label)) {
            return;
        }

        this.watchedDropdowns.add(item);

        // The menu is drawn afresh on every open: an entry such as `dateTime` fills its own list
        // with the time it is opened at, so rows drawn once would show the time they were drawn at.
        // `addToolbarToDropdown()` builds the group's views on the first open, from a listener it
        // registers at `highest` priority, so `high` runs once those views are in place.
        this.listenTo(item, "change:isOpen", () => {
            if (item.isOpen && item.toolbarView) {
                this.drawMenu(item, item.toolbarView);
            }
        }, { priority: "high" });

        // Every row reaches this, submenu entries included: the root list delegates `menu:execute`
        // to the dropdown, and delegation keeps the button that was pressed as the event's source.
        this.listenTo(item, "execute", (evt) => {
            const id = (evt.source as DropdownMenuListItemButtonView).id;
            this.plans.get(item)?.rows.get(id)?.run();
        });
    }

    private drawMenu(dropdown: DropdownView, toolbar: ToolbarView) {
        if (this.sourceToolbars.has(toolbar)) {
            discardMenu(dropdown, this.plans.get(dropdown));
        } else {
            // The group's views go on serving the menu, so only the strip they were laid out in
            // leaves the panel. It is destroyed with the plugin, since nothing else holds it now.
            dropdown.panelView.children.remove(toolbar);
            dropdown.focusTracker.remove(toolbar);
            this.sourceToolbars.add(toolbar);
        }

        const locale = this.editor.locale;
        const plan = planGroupMenu([...toolbar.items]);
        addMenuToDropdown(dropdown, this.editor.ui.view.body, plan.definition, {
            ariaLabel: dropdown.buttonView.label
        });

        this.plans.set(dropdown, plan);

        const menuView = dropdown.menuView;
        /* v8 ignore next 3 -- `addMenuToDropdown()` has just set the menu this narrows */
        if (!menuView) {
            return;
        }

        // A submenu's panel is appended to the editor's body, outside the dropdown, so it needs the
        // stylesheet's hook of its own.
        menuView.menuPanelClass = "ck-toolbar-group-menu__panel";

        for (const button of menuView.buttons) {
            const row = plan.rows.get(button.id);
            if (row) {
                button.icon = row.view.icon;
                button.bind("isEnabled").to(row.view, "isEnabled");
            }
        }

        for (const [id, source] of plan.mounts) {
            mountControl(menuView, plan, id, source);
        }

        for (const menu of menuView.menus) {
            const opener = plan.openers.get(menu.id);
            /* v8 ignore next 3 -- every submenu the menu holds was described from an opener */
            if (!opener) {
                continue;
            }

            menu.buttonView.icon = opener.view.icon;
            menu.bind("isEnabled").to(opener.view, "isEnabled");
            bindOpenerAction(menu, opener, dropdown);

            // Filled on the way open rather than once: `dateTime` renders its list in the time it
            // is opened at, so rows filled in earlier would show the time of that earlier opening.
            menu.on("change:isOpen", (evt, name, isOpen) => {
                if (isOpen) {
                    this.fillSubmenu(menu, opener, plan);
                }
            });
        }

        for (const index of [...plan.rules].reverse()) {
            menuView.items.add(new ListSeparatorView(locale), index);
        }
    }

    /** Draws a submenu over the rows the entry's own list holds at this moment. */
    private fillSubmenu(menu: DropdownMenuNestedMenuView, opener: MenuOpener, plan: MenuPlan) {
        const locale = this.editor.locale;
        const items = menu.listView.items;

        for (const id of opener.rowIds) {
            plan.rows.delete(id);
        }
        opener.rowIds = [];
        for (const drawn of [...items]) {
            items.remove(drawn);
            drawn.destroy();
        }

        for (const entry of listEntriesOf(opener.source)) {
            if (entry instanceof ListSeparatorView) {
                if (items.length) {
                    items.add(new ListSeparatorView(locale));
                }
                continue;
            }

            const id = `${menu.id}:${opener.rowIds.length}`;
            plan.rows.set(id, { view: entry, run: () => entry.fire("execute") });
            opener.rowIds.push(id);

            const button = new DropdownMenuListItemButtonView(locale, id, labelOf(entry));
            button.icon = entry.icon;
            button.bind("isEnabled").to(entry, "isEnabled");
            items.add(new DropdownMenuListItemView(locale, menu, button));
        }
    }

}

/**
 * Replaces the button in `id`'s row with `source`, so it opens its own panel from the menu.
 */
function mountControl(
    menuView: DropdownMenuRootListView, plan: MenuPlan, id: string, source: DropdownView
) {
    const placeholder = menuView.buttons.find((button) => button.id === id);
    const row = [...menuView.items].find((item): item is DropdownMenuListItemView =>
        item instanceof DropdownMenuListItemView && item.childView === placeholder);
    /* v8 ignore next 3 -- the row was described to the menu under this very id */
    if (!placeholder || !row) {
        return;
    }

    row.children.remove(placeholder);
    placeholder.destroy();
    source.buttonView.withText = true;
    row.children.add(source);
    plan.mounted.push({ row, source });
}

/**
 * Runs the action an opener stands for when its row is pressed, and dismisses the menu — hovering
 * still opens the submenu. An opener with no action of its own only opens, as CKEditor has it.
 */
function bindOpenerAction(
    menu: DropdownMenuNestedMenuView, opener: MenuOpener, dropdown: DropdownView
) {
    const run = opener.run;
    if (!run) {
        return;
    }

    // On the button, which the next draw destroys along with the menu holding it.
    menu.buttonView.on("execute", () => {
        run();
        dropdown.isOpen = false;
    });
}

/** Lets go of the menu the previous draw left behind, which nothing else takes out of the panel. */
function discardMenu(dropdown: DropdownView, plan: MenuPlan | undefined) {
    const previous = dropdown.menuView;
    /* v8 ignore next 3 -- a menu is drawn before this runs, and only a redraw discards one */
    if (!previous) {
        return;
    }

    // The controls mounted into it belong to the group, so they leave before the menu holding them
    // is destroyed; the next draw mounts them again.
    /* v8 ignore next -- only a redraw discards a menu, and it draws from a plan */
    for (const { row, source } of plan?.mounted ?? []) {
        row.children.remove(source);
    }

    for (const menu of previous.menus) {
        dropdown.focusTracker.remove(menu);
    }
    dropdown.focusTracker.remove(previous);
    dropdown.panelView.children.remove(previous);
    previous.destroy();
}

/** The view a row stands for: a split button where the entry also runs an action of its own. */
type SourceButton = View & Button;

interface MenuRow {
    /** The view the row takes its label, icon and enabled state from. */
    view: SourceButton;
    /** Runs what the row stands for. */
    run: () => void;
}

interface MenuOpener {
    /** The view the submenu's opener takes its label, icon and enabled state from. */
    view: SourceButton;
    /** The dropdown of the group the submenu is drawn over, read afresh each time it opens. */
    source: DropdownView;
    /** The ids the rows drawn from that list are registered under. */
    rowIds: string[];
    /** What pressing the opener runs, where the entry carries an action of its own. */
    run?: () => void;
}

interface MenuPlan {
    definition: DropdownMenuDefinition;
    rows: Map<string, MenuRow>;
    /** What a submenu's opener stands for, by the submenu's id. */
    openers: Map<string, MenuOpener>;
    /** Where a rule goes in the root list, as an index into the list the definition builds. */
    rules: number[];
    /** The controls whose row holds the control itself, by the id of the row held for it. */
    mounts: Map<string, DropdownView>;
    /** Where each of those controls ended up, so a redraw can take it out before destroying it. */
    mounted: Array<{ row: DropdownMenuListItemView; source: DropdownView }>;
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

function planGroupMenu(items: View[]) {
    const plan: MenuPlan = {
        definition: [],
        rows: new Map(),
        openers: new Map(),
        rules: [],
        mounts: new Map(),
        mounted: []
    };
    let nextId = 0;
    const takeId = () => `row${nextId++}`;

    for (const item of items) {
        if (item instanceof ToolbarSeparatorView) {
            if (plan.definition.length) {
                plan.rules.push(plan.definition.length);
            }
        } else if (item instanceof ButtonView) {
            plan.definition.push(describeRow(plan, takeId(), item));
        } else if (item instanceof DropdownView) {
            planSubmenu(plan, takeId, item);
        }
    }

    return plan;
}

/** What a row is called: the label of the view it stands for, or nothing where it sets none. */
function labelOf(view: { label?: string }) {
    return view.label ?? "";
}

/** Records a row against the view it stands for, and describes it to the menu. */
function describeRow(plan: MenuPlan, id: string, view: SourceButton) {
    plan.rows.set(id, { view, run: () => view.fire("execute") });
    return { id, label: labelOf(view) };
}

/**
 * Describes `dropdown` as a submenu, which `ToolbarGroupMenu#fillSubmenu()` draws on the way open.
 * A `SplitButtonView` opener also runs its own action, as a note tree context menu row does.
 */
function planSubmenu(plan: MenuPlan, takeId: () => string, dropdown: DropdownView) {
    const opener = dropdown.buttonView;

    // A dropdown offering no rows of its own carries a panel instead, so the row holds the dropdown
    // itself and it opens that panel from the menu.
    if (!listEntriesOf(dropdown).length) {
        const mountId = takeId();
        plan.mounts.set(mountId, dropdown);
        plan.definition.push({ id: mountId, label: labelOf(opener) });
        return;
    }

    const id = takeId();
    plan.openers.set(id, {
        view: opener,
        source: dropdown,
        rowIds: [],
        run: opener instanceof SplitButtonView ? () => opener.fire("execute") : undefined
    });
    plan.definition.push({ id, menu: labelOf(opener), children: [] });
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
