import { Plugin, type ListDropdownButtonDefinition, Collection, ViewModel, createDropdown, addListToDropdown, DropdownButtonView, type Command } from "ckeditor5";
import IncludeNote, { BOX_SIZE_COMMAND_NAME, BOX_SIZES, type BoxSizeValue } from "./includenote.js";

/**
 * Toolbar item which displays the list of box sizes for include notes in a dropdown.
 */
export default class IncludeNoteBoxSizeDropdown extends Plugin {

    static get requires() {
        return [IncludeNote] as const;
    }

    public init() {
        const editor = this.editor;
        const componentFactory = editor.ui.componentFactory;

        const itemDefinitions = this._getBoxSizeListItemDefinitions();
        const command = editor.commands.get(BOX_SIZE_COMMAND_NAME) as Command & { value: BoxSizeValue | null };

        componentFactory.add("includeNoteBoxSizeDropdown", _locale => {
            const dropdownView = createDropdown(editor.locale, DropdownButtonView);
            dropdownView.buttonView.set({
                withText: true,
                tooltip: true,
                label: "Box size"
            });
            dropdownView.bind("isEnabled").to(command, "isEnabled");
            dropdownView.buttonView.bind("label").to(command, "value", (value) => {
                if (!value) return "Box size";
                const sizeDef = BOX_SIZES.find(s => s.value === value);
                return sizeDef?.label ?? value;
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

        for (const sizeDef of BOX_SIZES) {
            const definition: ListDropdownButtonDefinition = {
                type: "button",
                model: new ViewModel({
                    _boxSizeValue: sizeDef.value,
                    label: sizeDef.label,
                    role: "menuitemradio",
                    withText: true
                })
            };

            definition.model.bind("isOn").to(command, "value", value => {
                return value === sizeDef.value;
            });

            itemDefinitions.add(definition);
        }

        return itemDefinitions;
    }

}
