import { Plugin, type ListDropdownButtonDefinition, Collection, ViewModel, createDropdown, addListToDropdown, DropdownButtonView, type Command } from "ckeditor5";
import ContentEmbed, {
    BOX_SIZE_COMMAND_NAME, BOX_SIZES, type BoxSizeValue, getBoxSizeLabel, isToolbarItemHidden
} from "./content_embed.js";

export const CONTENT_EMBED_BOX_SIZE_DROPDOWN = "contentEmbedBoxSizeDropdown";

/**
 * Toolbar item which displays the list of box sizes for embeds in a dropdown.
 */
export default class ContentEmbedBoxSizeDropdown extends Plugin {

    static get requires() {
        return [ContentEmbed] as const;
    }

    public init() {
        const editor = this.editor;
        const componentFactory = editor.ui.componentFactory;

        const itemDefinitions = this._getBoxSizeListItemDefinitions();
        const command = editor.commands.get(BOX_SIZE_COMMAND_NAME) as Command & { value: BoxSizeValue | null };
        const contentEmbed = editor.plugins.get(ContentEmbed);

        componentFactory.add(CONTENT_EMBED_BOX_SIZE_DROPDOWN, _locale => {
            const dropdownView = createDropdown(editor.locale, DropdownButtonView);
            const boxSizeLabel = editor.t("Box size");
            dropdownView.buttonView.set({
                withText: true,
                tooltip: true,
                label: boxSizeLabel
            });
            dropdownView.bind("isEnabled").to(command, "isEnabled");
            dropdownView.bind("class").to(contentEmbed, "selectedEmbedTools", (tools) => {
                const isHidden = isToolbarItemHidden(tools, CONTENT_EMBED_BOX_SIZE_DROPDOWN);
                return isHidden ? "ck-hidden" : undefined;
            });
            dropdownView.buttonView.bind("label").to(command, "value", (value) => {
                if (!value) return boxSizeLabel;
                return getBoxSizeLabel(editor.t, value);
            });
            dropdownView.on("execute", evt => {
                const source = evt.source as any;
                editor.execute(BOX_SIZE_COMMAND_NAME, {
                    value: source._boxSizeValue
                });
                editor.editing.view.focus();
            });
            addListToDropdown(dropdownView, itemDefinitions);
            return dropdownView;
        });
    }

    private _getBoxSizeListItemDefinitions(): Collection<ListDropdownButtonDefinition> {
        const editor = this.editor;
        const command = editor.commands.get(BOX_SIZE_COMMAND_NAME) as Command & { value: BoxSizeValue | null };
        const itemDefinitions = new Collection<ListDropdownButtonDefinition>();

        for (const size of BOX_SIZES) {
            const definition: ListDropdownButtonDefinition = {
                type: "button",
                model: new ViewModel({
                    _boxSizeValue: size,
                    label: getBoxSizeLabel(editor.t, size),
                    role: "menuitemradio",
                    withText: true
                })
            };

            definition.model.bind("isOn").to(command, "value", value => {
                return value === size;
            });

            itemDefinitions.add(definition);
        }

        return itemDefinitions;
    }

}
