import {
    Plugin,
    WidgetToolbarRepository,
    isWidget,
    type ViewElement,
    Collection,
    ViewModel,
    createDropdown,
    addListToDropdown,
    DropdownButtonView,
    type ListDropdownButtonDefinition,
    type Command
} from "ckeditor5";
import LinkEmbed, {
    CHANGE_LINK_DISPLAY_COMMAND,
    LINK_DISPLAY_MODES,
    type LinkDisplayMode
} from "./linkembed.js";

export default class LinkEmbedToolbar extends Plugin {

    static get requires() {
        return [WidgetToolbarRepository, LinkEmbed, LinkEmbedDisplayDropdown] as const;
    }

    afterInit() {
        const widgetToolbarRepository = this.editor.plugins.get(WidgetToolbarRepository);

        widgetToolbarRepository.register("linkEmbed", {
            items: ["linkEmbedDisplayDropdown"],
            balloonClassName: "ck-toolbar-container link-embed-toolbar",
            getRelatedElement(selection) {
                const selectedElement = selection.getSelectedElement();
                if (selectedElement && isLinkEmbedWidget(selectedElement)) {
                    return selectedElement;
                }
                return null;
            }
        });
    }
}

function isLinkEmbedWidget(element: ViewElement): boolean {
    if (!isWidget(element)) {
        return false;
    }

    // Match both linkEmbed (<section.link-embed>) and linkMention (<span.link-mention>)
    if (element.is("element", "section")) {
        const classes = element.getAttribute("class") || "";
        return typeof classes === "string" && classes.includes("link-embed");
    }
    if (element.is("element", "span")) {
        const classes = element.getAttribute("class") || "";
        return typeof classes === "string" && classes.includes("link-mention");
    }
    return false;
}

class LinkEmbedDisplayDropdown extends Plugin {

    static get requires() {
        return [LinkEmbed] as const;
    }

    public init() {
        const editor = this.editor;
        const componentFactory = editor.ui.componentFactory;
        const command = editor.commands.get(CHANGE_LINK_DISPLAY_COMMAND) as Command & { value: LinkDisplayMode | null; embedAvailable: boolean };

        componentFactory.add("linkEmbedDisplayDropdown", _locale => {
            const dropdownView = createDropdown(editor.locale, DropdownButtonView);

            dropdownView.buttonView.set({
                withText: true,
                tooltip: true,
                label: "Display"
            });

            dropdownView.bind("isEnabled").to(command, "isEnabled");

            dropdownView.buttonView.bind("label").to(command, "value", (value) => {
                if (!value) return "Display";
                const mode = LINK_DISPLAY_MODES.find(m => m.value === value);
                return mode?.label ?? value;
            });

            dropdownView.on("execute", evt => {
                const source = evt.source as any;
                editor.execute(CHANGE_LINK_DISPLAY_COMMAND, {
                    value: source._displayMode
                });
                editor.editing.view.focus();
            });

            addListToDropdown(dropdownView, this._getItemDefinitions(command));
            return dropdownView;
        });
    }

    private _getItemDefinitions(command: Command & { value: LinkDisplayMode | null; embedAvailable: boolean }): Collection<ListDropdownButtonDefinition> {
        const items = new Collection<ListDropdownButtonDefinition>();

        for (const modeDef of LINK_DISPLAY_MODES) {
            const definition: ListDropdownButtonDefinition = {
                type: "button",
                model: new ViewModel({
                    _displayMode: modeDef.value,
                    label: modeDef.label,
                    role: "menuitemradio",
                    withText: true
                })
            };

            definition.model.bind("isOn").to(command, "value", value => {
                return value === modeDef.value;
            });

            // Hide "Embed" when the URL doesn't support it.
            if (modeDef.value === "embed") {
                definition.model.bind("isVisible").to(command, "embedAvailable");
            }

            items.add(definition);
        }

        return items;
    }
}
