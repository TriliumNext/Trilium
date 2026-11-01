import {
    ButtonView, ContextualBalloon, DropdownView, IconBulletedList, IconCodeBlock, IconImage, IconLink,
    IconNumberedList, IconPreviousArrow, IconTable, IconTodoList,
    IconThreeVerticalDots, IconView, LinkUI, Plugin, ToolbarSeparatorView, ToolbarView, View, WidgetToolbarRepository
} from "ckeditor5";
import type {
    Editor, LinkCommand, Locale, ToolbarConfig, ToolbarConfigItem, ViewDocumentFragment, ViewDocumentSelection,
    ViewElement, ViewNode
} from "ckeditor5";

import admonitionIcon from "../icons/admonition.svg?raw";
import TodoListMultistateUI, { getTaskStateToolbarItems } from "./todo_list_multistate/todo_list_multistate_ui.js";
import { isListMenu, openListAsMenu } from "./toolbar_group_menu.js";

/** The icons of the `contextToolbar` button, by the id a widget toolbar is registered under. */
const TOOLBAR_ICONS: Record<string, string> = {
    table: IconTable,
    tableContent: IconTable,
    image: IconImage,
    codeblock: IconCodeBlock,
    admonition: admonitionIcon,
    link: IconLink,
    linkEmbed: IconLink,
    bulletedList: IconBulletedList,
    numberedList: IconNumberedList,
    todoList: IconTodoList
};

/** What `WidgetToolbarRepository` keeps of a registered toolbar. */
interface WidgetToolbarDefinition {
    view: ToolbarView;
    getRelatedElement(selection: ViewDocumentSelection): ViewElement | null;
    itemsConfig: ToolbarConfigItem[];
}

/** A toolbar the `contextToolbar` button can bring up: a widget's, or the one of `LinkUI`. */
interface ContextToolbarDefinition {
    ariaLabel?: string;
    getRelatedElement(selection: ViewDocumentSelection): ViewElement | null;
    itemsConfig: ToolbarConfigItem[];
}

/** The widget toolbar for the selection, as the `contextToolbar` button shows it. */
interface ContextToolbarSource {
    id: string;
    definition: ContextToolbarDefinition;
    /** The widget the toolbar is for. */
    element: ViewElement;
    /** Whether the selection holds the widget whole, as it does an image, rather than a caret inside it. */
    isSelected: boolean;
}

/**
 * Moves the toolbars of `WidgetToolbarRepository` (table, image, code block, …) and the link
 * toolbar of `LinkUI` out of their balloons into a toolbar the host application places, as
 * {@link TextFormattingToolbar} does for text formatting. Applies only to an editor whose toolbar
 * holds the `contextToolbar` button.
 *
 * The button shows while the selection is in a widget that has a toolbar. It swaps in
 * {@link toolbarView}: a back button, then a title naming the widget ahead of the items of the
 * toolbar the balloon would show, which is the one of the innermost widget. The toolbar swaps in on
 * its own as a widget is selected whole, since there is no text to format then, as a link is
 * tapped, and as a list command starts a list; it swaps out as the selection leaves the widget,
 * link or list. Its dropdowns open as menus of
 * `ToolbarGroupMenu`, like the rest of a phone's toolbar.
 */
export default class ContextToolbar extends Plugin {

    /** Whether the toolbar is the one to show. */
    declare isActive: boolean;

    /** The widget toolbar for the selection, or `null` outside any widget that has one. */
    declare source: ContextToolbarSource | null;

    // Built before `afterInit()`, so `ToolbarGroupMenu` can watch it whichever plugin starts first.
    readonly toolbarView: ToolbarView;

    private readonly backView: ButtonView;
    private readonly titleView: ContextToolbarTitleView;
    /** The source whose items {@link toolbarView} holds. */
    private shownSource: ContextToolbarSource | null = null;
    /** Whether a list command ran since the last update, so a list toolbar found then swaps in. */
    private hasStartedList = false;

    static get requires() {
        return [WidgetToolbarRepository] as const;
    }

    static get pluginName() {
        return "ContextToolbar" as const;
    }

    constructor(editor: Editor) {
        super(editor);
        this.set("isActive", false);
        this.set("source", null);
        this.toolbarView = new ToolbarView(editor.locale, { shouldGroupWhenFull: true });

        this.backView = new ButtonView(editor.locale);
        this.backView.set({ label: editor.t("Back"), icon: IconPreviousArrow, tooltip: true });
        this.backView.on("execute", () => this.setActive(false));

        // Names the widget the tools act on. Hidden for a toolbar without a name.
        const title = this.titleView = new ContextToolbarTitleView(editor.locale);
        const name = (source: ContextToolbarSource | null) => getToolbarName(editor, source);
        title.bind("isVisible").to(this, "source", (source) => name(source) !== undefined);
        title.bind("label").to(this, "source", (source) => name(source) ?? "");
        title.bind("icon").to(this, "source", (source) => (source ? TOOLBAR_ICONS[source.id] ?? "" : ""));
    }

    init() {
        const editor = this.editor;

        editor.ui.componentFactory.add("contextToolbar", (locale) => {
            // A chip naming the widget, `Table ›`, which the host styles apart from the tools.
            const button = new ButtonView(locale);
            button.set({ class: "ck-context-toolbar-button" });
            button.bind("isVisible").to(this, "source", (source) => source !== null);
            button.bind("label").to(this, "source", (source) =>
                getToolbarName(editor, source) ?? source?.definition.ariaLabel ?? "");
            button.bind("withText").to(this, "source", (source) => getToolbarName(editor, source) !== undefined);
            button.bind("tooltip").to(this, "source", (source) => source?.definition.ariaLabel ?? true);
            button.bind("icon").to(this, "source", (source) => (source && TOOLBAR_ICONS[source.id]) ?? IconThreeVerticalDots);
            button.on("execute", () => this.setActive(true));
            return button;
        });
    }

    afterInit() {
        const editor = this.editor;
        if (!hasItem(editor.config.get("toolbar"), "contextToolbar")) {
            return;
        }

        editor.plugins.get(WidgetToolbarRepository).forceDisabled(ContextToolbar.pluginName);
        if (editor.plugins.has(LinkUI)) {
            this.keepOutOfBalloon(editor.plugins.get(LinkUI));
            // A tap in a link is about the link, as `LinkUI` takes it to be when it shows its toolbar.
            this.listenTo(editor.editing.view.document, "click", () => {
                this.updateSource();
                if (this.source?.id === "link") {
                    this.setActive(true);
                }
            });
        }

        // The row of a to-do list holds the task states, so a long press of a checkbox opens neither
        // the balloon of `TodoListMultistateToolbar` nor the browser's menu.
        this.listenTo(editor.editing.view.document, "contextmenu", (evt, data: { target: ViewNode; preventDefault(): void }) => {
            const target = data.target;
            if (target.is("element", "input") && target.findAncestor({ classes: "todo-list__label" })) {
                data.preventDefault();
                evt.stop();
            }
        }, { priority: "high" });

        // A list command runs as a list is started from the block type menu or by autoformat. Ahead
        // of the command, whose change renders and so updates the UI before it returns.
        for (const name of LIST_COMMANDS) {
            const command = editor.commands.get(name);
            if (command) {
                this.listenTo(command, "execute", () => {
                    this.hasStartedList = true;
                }, { priority: "highest" });
            }
        }

        // Grouping measures the rendered toolbar as items arrive.
        this.toolbarView.render();
        this.toolbarView.items.addMany([this.backView, new ToolbarSeparatorView(), this.titleView]);
        // Before `ToolbarGroupMenu`, which decides on a dropdown as it is added.
        this.listenTo(this.toolbarView.items, "add", (_evt, item) => {
            if (item instanceof DropdownView && !isListMenu(item)) {
                openListAsMenu(item);
            }
        }, { priority: "highest" });
        editor.ui.addToolbar(this.toolbarView);

        // The event `WidgetToolbarRepository` updates its balloons on.
        this.listenTo(editor.ui, "update", () => this.updateSource());
    }

    override destroy() {
        super.destroy();
        if (this.toolbarView.isRendered) {
            this.toolbarView.destroy();
        } else {
            this.backView.destroy();
            this.titleView.destroy();
        }
    }

    /**
     * Takes the toolbar of `LinkUI` out of the balloon as `LinkUI` shows it, as a click in a link
     * does. Its form and its other views stay in the balloon.
     */
    private keepOutOfBalloon(linkUI: LinkUI) {
        const balloon = this.editor.plugins.get(ContextualBalloon);
        this.listenTo(balloon, "change:visibleView", (_evt, _name, view: View | null) => {
            if (!view || view !== linkUI.toolbarView) {
                return;
            }
            // After `ContextualBalloon.add()`, which still positions the view, and before a paint.
            queueMicrotask(() => {
                if (balloon.hasView(view)) {
                    balloon.remove(view);
                }
            });
        });
    }

    private setActive(isActive: boolean) {
        if (isActive) {
            this.fillToolbar();
        }
        this.isActive = isActive;
        this.editor.editing.view.focus();
    }

    /** Fills {@link toolbarView} with the items of the toolbar for the selection, after the title. */
    private fillToolbar() {
        if (this.source === this.shownSource || !this.source) {
            return;
        }

        for (const item of [...this.toolbarView.items].slice(3)) {
            this.toolbarView.items.remove(item);
            item.destroy();
        }
        this.toolbarView.fillFromConfig(this.source.definition.itemsConfig, this.editor.ui.componentFactory);
        this.shownSource = this.source;
    }

    /** Finds the toolbar of the innermost widget at the selection, as `WidgetToolbarRepository` does. */
    private updateSource() {
        const selection = this.editor.editing.view.document.selection;
        let deepest: { source: ContextToolbarSource; depth: number } | null = null;

        for (const [id, definition] of getDefinitions(this.editor)) {
            const element = definition.getRelatedElement(selection);
            const depth = element?.getAncestors().length ?? 0;
            if (element && depth > (deepest?.depth ?? 0)) {
                const isSelected = element === selection.getSelectedElement();
                deepest = { source: { id, definition, element, isSelected }, depth };
            }
        }

        const next = deepest?.source ?? null;
        const hasStartedList = this.hasStartedList;
        this.hasStartedList = false;
        // Unchanged for the same widget, so the back button holds while the selection stays on it.
        if (next?.id === this.source?.id && next?.element === this.source?.element) {
            return;
        }
        // The same widget drawn anew, as a list is when its style or an item's task state changes.
        if (next && this.source && next.id === this.source.id && !this.source.element.root.is("rootElement")) {
            if (this.shownSource === this.source) {
                this.shownSource = next;
            }
            this.source = next;
            return;
        }
        this.source = next;
        if (next?.isSelected || (hasStartedList && next && isListCommand(next.id))) {
            this.fillToolbar();
            this.isActive = true;
        } else if (this.isActive) {
            this.isActive = false;
        }
    }
}

/** The icon and the name of the widget whose tools a {@link ContextToolbar} row holds. Not a button. */
class ContextToolbarTitleView extends View {
    declare label: string;
    declare icon: string;
    declare isVisible: boolean;

    constructor(locale: Locale) {
        super(locale);
        this.set({ label: "", icon: "", isVisible: true });

        const iconView = new IconView();
        iconView.bind("content").to(this, "icon");

        const bind = this.bindTemplate;
        this.setTemplate({
            tag: "span",
            attributes: {
                class: ["ck", "ck-context-toolbar-title", bind.if("isVisible", "ck-hidden", (isVisible) => !isVisible)]
            },
            children: [iconView, { tag: "span", children: [{ text: bind.to("label") }] }]
        });
    }
}

/** The short name of the widget a toolbar is for, or `undefined` for a toolbar without one. */
function getToolbarName(editor: Editor, source: ContextToolbarSource | null) {
    const t = editor.t;
    switch (source?.id) {
        case "table":
        case "tableContent": return t("Table");
        case "image": return t("Image");
        case "codeblock": return t("Code block");
        case "inlineCode": return t("Code");
        case "admonition": return t("Admonition");
        case "tabs": return t("Tabs");
        case "multicolumnLayout": return t("Columns");
        case "contentEmbed": return t("Embed");
        // A link preview, which is a link whatever its shape.
        case "link":
        case "linkEmbed": return t("Link");
        case "bulletedList":
        case "numberedList":
        case "todoList": return t("List");
        default: return undefined;
    }
}

/**
 * The toolbars registered with `WidgetToolbarRepository`, and the link toolbar. The repository
 * keeps its toolbars in a private map: the spec fails if a CKEditor upgrade renames it.
 */
function* getDefinitions(editor: Editor): Generator<[string, ContextToolbarDefinition]> {
    const repository = editor.plugins.get(WidgetToolbarRepository) as unknown as {
        _toolbarDefinitions: Map<string, WidgetToolbarDefinition>;
    };
    for (const [id, { view, getRelatedElement, itemsConfig }] of repository._toolbarDefinitions) {
        yield [id, { ariaLabel: view.ariaLabel, getRelatedElement, itemsConfig }];
    }

    // The toolbar of the innermost list, under the name of its kind, so the chip shows its icon.
    const listItems = editor.config.get("listToolbar") ?? [];
    if (listItems.length) {
        for (const id of LIST_COMMANDS) {
            yield [id, {
                getRelatedElement: (selection) => {
                    const list = getInnermostList(selection);
                    return list && getListKind(list) === id ? list : null;
                },
                itemsConfig: id === "todoList" && editor.plugins.has(TodoListMultistateUI)
                    ? [...listItems, "|", ...getTaskStateToolbarItems(editor)]
                    : listItems
            }];
        }
    }

    const linkItems = getLinkToolbarItems(editor);
    if (linkItems.length) {
        yield ["link", {
            getRelatedElement: (selection) => selection.getFirstPosition()?.getAncestors().find(isLinkElement) ?? null,
            itemsConfig: linkItems
        }];
    }
}

/** The commands that turn blocks into a list of each kind, which name the toolbars of the lists. */
const LIST_COMMANDS = ["bulletedList", "numberedList", "todoList"] as const;

function isListCommand(id: string) {
    return (LIST_COMMANDS as readonly string[]).includes(id);
}

/** The innermost list at the selection, or `null` outside a list. */
function getInnermostList(selection: ViewDocumentSelection) {
    return selection.getFirstPosition()?.getAncestors().reverse()
        .find((node): node is ViewElement => node.is("element", "ul") || node.is("element", "ol")) ?? null;
}

/** The command that makes a list of the kind of `list`. */
function getListKind(list: ViewElement) {
    if (list.hasClass("todo-list")) {
        return "todoList";
    }
    return list.name === "ol" ? "numberedList" : "bulletedList";
}

/** The items of the link toolbar, without the properties a link has none of, as `LinkUI` builds it. */
function getLinkToolbarItems(editor: Editor): ToolbarConfigItem[] {
    if (!editor.plugins.has(LinkUI)) {
        return [];
    }
    // `LinkUI` defines a default.
    const items = editor.config.get("link.toolbar") as ToolbarConfigItem[];
    const command = editor.commands.get("link") as LinkCommand | undefined;
    return command?.manualDecorators.length ? items : items.filter((item) => item !== "linkProperties");
}

/** Whether `node` is the element of a link, as the link plugin's own `isLinkElement()` tells. */
function isLinkElement(node: ViewNode | ViewDocumentFragment): node is ViewElement {
    return node.is("attributeElement") && !!node.getCustomProperty("link");
}

/** Whether a toolbar configuration holds `name`, at its top level or in a group. */
function hasItem(config: ToolbarConfig | undefined, name: string): boolean {
    const items = Array.isArray(config) ? config : config?.items ?? [];
    return items.some((item) => item === name || (typeof item === "object" && hasItem(item.items, name)));
}

declare module "ckeditor5" {
    interface PluginsMap {
        [ContextToolbar.pluginName]: ContextToolbar;
    }

    interface EditorConfig {
        /** The items of the toolbar the `contextToolbar` button brings up in a list. */
        listToolbar?: ToolbarConfigItem[];
    }
}
