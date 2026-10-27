import "../../theme/content_embed_tools.css";

import {
    addListToDropdown, ButtonView, Collection, createDropdown, DropdownButtonView, DropdownView,
    getEnvKeystrokeText, type ListDropdownItemDefinition, ListItemView, type Locale, Plugin,
    ToolbarSeparatorView, View, type ViewCollection, ViewModel
} from "ckeditor5";

import ContentEmbed from "./content_embed.js";

/** The toolbar item with the buttons that the content of the selected embed adds. */
export const CONTENT_EMBED_TOOLS = "contentEmbedTools";

/**
 * Shows the buttons that the content of the selected embed adds to the embed's toolbar, such as
 * the tools of a canvas drawing. The host supplies them through `contentEmbed.getTools()`.
 */
export default class ContentEmbedTools extends Plugin {

    static get requires() {
        return [ ContentEmbed ] as const;
    }

    static get pluginName() {
        return "ContentEmbedTools" as const;
    }

    init() {
        const editor = this.editor;
        const contentEmbed = editor.plugins.get(ContentEmbed);

        editor.ui.componentFactory.add(CONTENT_EMBED_TOOLS, locale => {
            const view = new ContentEmbedToolsView(locale);

            // The tools can follow the embed, which the editor updates. Runs before
            // `WidgetToolbarRepository` positions the toolbar from its width.
            this.listenTo(editor.ui, "update", () => {
                view.setProvider(contentEmbed.selectedEmbedTools);
            }, { priority: "high" });
            this.listenTo<ContentEmbedToolsResizeEvent>(view, "resize", () => editor.ui.update());

            return view;
        });
    }

}

/** Fired when the buttons are created again, which changes the width of the toolbar. */
type ContentEmbedToolsResizeEvent = {
    name: "resize";
    args: [];
};

/** The view of a tool, and the way it shows a new state of the tool and of its children. */
interface ToolView {
    view: ButtonView | DropdownView;
    /** The element that wraps `view` in the toolbar, if any. */
    wrapper?: View;
    update(tool: ContentEmbedTool, children: ContentEmbedTool[]): void;
}

/** The buttons of a `ContentEmbedToolProvider`, updated when the provider changes. */
export class ContentEmbedToolsView extends View {

    declare public isVisible: boolean;
    /** The view of each tool: a button, or a dropdown for a tool with children. */
    public views: Array<ButtonView | DropdownView> = [];
    /** The views and the separators between their groups. */
    private readonly items: ViewCollection;
    private updaters: Array<ToolView["update"]> = [];
    private provider: ContentEmbedToolProvider | null = null;
    private unsubscribe: (() => void) | undefined;
    /** What identifies each tool and its children, to create the views again for another set. */
    private toolKeys: string[] = [];

    constructor(locale?: Locale) {
        super(locale);
        this.set("isVisible", false);
        this.items = this.createCollection();

        const bind = this.bindTemplate;
        this.setTemplate({
            tag: "div",
            attributes: {
                class: [
                    "ck",
                    "ck-content-embed-tools",
                    bind.if("isVisible", "ck-hidden", isVisible => !isVisible)
                ]
            },
            children: this.items
        });
    }

    /** Shows the buttons of `provider`, and updates them when it changes. */
    setProvider(provider: ContentEmbedToolProvider | null) {
        if (provider !== this.provider) {
            this.unsubscribe?.();
            this.provider = provider;
            this.unsubscribe = provider?.subscribe(() => {
                if (this.showTools()) {
                    this.fire<ContentEmbedToolsResizeEvent>("resize");
                }
            });
        }
        this.showTools();
    }

    focus() {
        this.views[0]?.focus();
    }

    override destroy() {
        this.unsubscribe?.();
        super.destroy();
    }

    /** Shows the tools of the provider. Returns whether the views were created again. */
    private showTools() {
        const tools = this.provider?.getTools() ?? [];
        // The Editable toggle and the display modes come before the tools.
        const isAfterItems = !!(this.provider?.hasEditableFlag || this.provider?.hasDisplayModes);
        const keys = tools.map(tool => JSON.stringify([
            tool.group,
            tool.id,
            tool.opensMenu,
            tool.children?.map(child => [ child.group, child.id, child.keystroke ])
        ]));
        keys.push(String(isAfterItems));
        const isNewSet = keys.length !== this.toolKeys.length
            || keys.some((key, index) => key !== this.toolKeys[index]);

        if (isNewSet) {
            this.toolKeys = keys;
            this.createViews(tools, isAfterItems);
        }

        for (const [ index, tool ] of tools.entries()) {
            this.updaters[index]?.(tool, tool.children ?? []);
        }
        this.isVisible = tools.length > 0;

        return isNewSet;
    }

    /**
     * Creates a view for each tool, with a separator between groups, and before the first one
     * when `isAfterItems`.
     */
    private createViews(tools: ContentEmbedTool[], isAfterItems: boolean) {
        this.items.clear();
        this.views = [];
        this.updaters = [];
        if (isAfterItems && tools.length) {
            this.items.add(new ToolbarSeparatorView(this.locale));
        }

        let group: string | undefined;
        for (const tool of tools) {
            if (this.views.length && tool.group !== group) {
                this.items.add(new ToolbarSeparatorView(this.locale));
            }
            group = tool.group;

            const { view, wrapper, update } = this.createToolView(tool);
            this.views.push(view);
            this.updaters.push(update);
            this.items.add(wrapper ?? view);
        }
    }

    private createToolView(tool: ContentEmbedTool): ToolView {
        if (tool.children) {
            return this.createMenu(tool.children);
        }
        return tool.opensMenu ? this.createMenuButton(tool.id) : this.createButton(tool.id);
    }

    private createButton(id: string): ToolView {
        const button = new ButtonView(this.locale);
        keepFocus(button);
        this.listenTo(button, "execute", () => this.provider?.execute(id));

        return {
            view: button,
            update: (tool) => button.set({
                ...getButtonFace(tool),
                class: tool.class,
                isToggleable: tool.isOn !== undefined,
                isOn: tool.isOn ?? false,
                isEnabled: tool.isEnabled ?? true
            })
        };
    }

    /**
     * A button with the arrow of a dropdown, which has the provider open its menu below it. It is
     * wrapped in a `ck-dropdown` element, as CKEditor styles a dropdown button inside one.
     */
    private createMenuButton(id: string): ToolView {
        const button = new DropdownButtonView(this.locale);
        button.extendTemplate({
            attributes: {
                class: [ "ck-dropdown__button", "ck-dropdown__button_label-width_auto" ]
            }
        });
        keepFocus(button);
        this.listenTo(button, "open", () => {
            /* v8 ignore next -- `ViewCollection` renders the button as `createViews()` adds it. */
            if (!button.element) return;
            this.provider?.openMenu?.(id, button.element);
        });

        const wrapper = new View(this.locale);
        wrapper.setTemplate({
            tag: "div",
            attributes: { class: [ "ck", "ck-dropdown" ] },
            children: [ button ]
        });

        return {
            view: button,
            wrapper,
            update: (tool) => button.set({
                ...getButtonFace(tool),
                class: tool.class,
                isOn: tool.isOn ?? false,
                isEnabled: tool.isEnabled ?? true
            })
        };
    }

    /**
     * A dropdown that lists `children`, each run as a tool of its own, with a separator between
     * groups.
     */
    private createMenu(children: ContentEmbedTool[]): ToolView {
        const dropdown = createDropdown(this.locale);
        keepFocus(dropdown.buttonView);
        keepFocus(dropdown.panelView);

        const models = children.map(child => new ViewModel({
            toolId: child.id,
            withText: true,
            withKeystroke: child.keystroke !== undefined,
            role: child.isOn === undefined ? "menuitem" : "menuitemradio"
        }));
        const definitions = new Collection<ListDropdownItemDefinition>();
        for (const [ index, model ] of models.entries()) {
            if (index && children[index]?.group !== children[index - 1]?.group) {
                definitions.add({ type: "separator" });
            }
            definitions.add({ type: "button", model });
        }
        addListToDropdown(dropdown, definitions);
        // Runs after `addListToDropdown()` creates the list, as the dropdown first opens.
        dropdown.once("change:isOpen", () => addKeystrokes(dropdown, children), {
            priority: "high"
        });
        this.listenTo(dropdown, "execute", (evt) => {
            this.provider?.execute((evt.source as { toolId: string }).toolId);
        });

        return {
            view: dropdown,
            update: (tool, children) => {
                // `createDropdown()` binds `isOn` of the button to the dropdown being open.
                const classes = [ tool.class, tool.isOn && "ck-on" ].filter(Boolean);
                dropdown.buttonView.set({
                    ...getButtonFace(tool),
                    class: classes.length ? classes.join(" ") : undefined
                });
                dropdown.isEnabled = tool.isEnabled ?? true;
                for (const [ index, child ] of children.entries()) {
                    models[index]?.set({
                        label: child.label,
                        icon: child.icon,
                        isOn: child.isOn ?? false,
                        isEnabled: child.isEnabled ?? true
                    });
                }
            }
        };
    }

}

/** The label, icon and tooltip of the button of `tool`. */
function getButtonFace(tool: ContentEmbedTool) {
    return {
        label: tool.text ?? tool.label,
        withText: tool.text !== undefined,
        icon: tool.icon,
        tooltip: tool.label,
        ariaLabel: tool.label
    };
}

/**
 * Shows the keystrokes of `children` beside their labels in the list of `dropdown`. The own
 * keystroke of `ButtonView` throws on a key that CKEditor cannot parse, such as `?`.
 */
function addKeystrokes(dropdown: DropdownView, children: ContentEmbedTool[]) {
    /* v8 ignore next -- `addListToDropdown()` creates `listView` before this runs. */
    const buttons = [ ...dropdown.listView?.items ?? [] ]
        .filter(item => item instanceof ListItemView)
        .map(item => item.children.first);
    for (const [ index, button ] of buttons.entries()) {
        const keystroke = children[index]?.keystroke;
        if (button instanceof ButtonView && keystroke !== undefined) {
            button.children.add(createKeystrokeView(button.locale, keystroke));
        }
    }
}

/** A keystroke as `ButtonView` shows it, or a single character as it is. */
function createKeystrokeView(locale: Locale | undefined, keystroke: string) {
    const view = new View(locale);
    view.setTemplate({
        tag: "span",
        attributes: { class: [ "ck", "ck-button__keystroke" ] },
        children: [ keystroke.length === 1 ? keystroke : getEnvKeystrokeText(keystroke) ]
    });
    return view;
}

/** Keeps the focus in the content that the tools act on. */
function keepFocus(view: View) {
    view.extendTemplate({
        on: { mousedown: view.bindTemplate.to(evt => evt.preventDefault()) }
    });
}

declare module "ckeditor5" {
    interface PluginsMap {
        [ ContentEmbedTools.pluginName ]: ContentEmbedTools;
    }
}
