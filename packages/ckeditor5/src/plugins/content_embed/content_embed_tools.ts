import "../../theme/content_embed_tools.css";

import {
    addListToDropdown, ButtonView, Collection, createDropdown, DropdownView,
    type ListDropdownButtonDefinition, type Locale, Plugin, ToolbarSeparatorView, View,
    type ViewCollection, ViewModel
} from "ckeditor5";

import ContentEmbed from "./content_embed.js";

/** The toolbar item with the buttons that the content of the selected embed adds. */
export const CONTENT_EMBED_TOOLS = "contentEmbedTools";

/**
 * Shows the buttons that the content of the selected embed adds to the embed's toolbar, such as
 * the tools of a canvas drawing. The host supplies them through `getContentEmbedTools()`.
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
    /** The group and the ids of each tool, to create the views again only for another set. */
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
        const keys = tools.map(tool => [
            tool.group ?? "", tool.id, ...tool.children?.map(child => child.id) ?? []
        ].join("/"));
        const isNewSet = keys.length !== this.toolKeys.length
            || keys.some((key, index) => key !== this.toolKeys[index]);

        if (isNewSet) {
            this.toolKeys = keys;
            this.createViews(tools);
        }

        for (const [ index, tool ] of tools.entries()) {
            this.updaters[index]?.(tool, tool.children ?? []);
        }
        this.isVisible = tools.length > 0;

        return isNewSet;
    }

    /** Creates a view for each tool, with a separator between groups. */
    private createViews(tools: ContentEmbedTool[]) {
        this.items.clear();
        this.views = [];
        this.updaters = [];

        let group: string | undefined;
        for (const tool of tools) {
            if (this.views.length && tool.group !== group) {
                this.items.add(new ToolbarSeparatorView(this.locale));
            }
            group = tool.group;

            const { view, update } = tool.children
                ? this.createMenu(tool.children)
                : this.createButton(tool.id);
            this.views.push(view);
            this.updaters.push(update);
            this.items.add(view);
        }
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

    /** A dropdown that lists `children`, each run as a tool of its own. */
    private createMenu(children: ContentEmbedTool[]): ToolView {
        const dropdown = createDropdown(this.locale);
        keepFocus(dropdown.buttonView);
        keepFocus(dropdown.panelView);

        const models = children.map(child => new ViewModel({
            toolId: child.id,
            withText: true,
            role: "menuitemradio"
        }));
        const definitions = new Collection<ListDropdownButtonDefinition>();
        for (const model of models) {
            definitions.add({ type: "button", model });
        }
        addListToDropdown(dropdown, definitions);
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
