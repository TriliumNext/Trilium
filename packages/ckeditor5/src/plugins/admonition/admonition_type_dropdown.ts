import { Plugin, type ListDropdownButtonDefinition, Collection, ViewModel, createDropdown, addListToDropdown, DropdownButtonView } from "ckeditor5";
import Admonition from "./admonition.js";
import type AdmonitionCommand from "./admonition_command.js";
import { ADMONITION_TYPE_NAMES, type AdmonitionType } from "./admonition_command.js";
import { getAdmonitionTitle } from "./admonition_ui.js";

/**
 * Toolbar item which displays the list of admonition types in a dropdown.
 * Uses the same styling as the main admonition toolbar button.
 */
export default class AdmonitionTypeDropdown extends Plugin {

    static get requires() {
        return [Admonition] as const;
    }

    public init() {
        const editor = this.editor;
        const componentFactory = editor.ui.componentFactory;

        const itemDefinitions = this._getTypeListItemDefinitions();
        const command = editor.commands.get("admonition") as AdmonitionCommand;

        componentFactory.add("admonitionTypeDropdown", _locale => {
            const dropdownView = createDropdown(editor.locale, DropdownButtonView);
            dropdownView.buttonView.set({
                withText: true
            });
            dropdownView.bind("isEnabled").to(command, "value", value => !!value);
            dropdownView.buttonView.bind("label").to(command, "value", (value) => {
                if (!value) return "";
                return getAdmonitionTitle(editor.t, value as AdmonitionType);
            });
            dropdownView.on("execute", evt => {
                const source = evt.source as any;
                editor.execute("admonition", {
                    forceValue: source.commandParam
                });
                editor.editing.view.focus();
            });
            addListToDropdown(dropdownView, itemDefinitions);
            return dropdownView;
        });
    }

    private _getTypeListItemDefinitions(): Collection<ListDropdownButtonDefinition> {
        const editor = this.editor;
        const command = editor.commands.get("admonition") as AdmonitionCommand;
        const itemDefinitions = new Collection<ListDropdownButtonDefinition>();

        for (const type of ADMONITION_TYPE_NAMES) {
            const definition: ListDropdownButtonDefinition = {
                type: "button",
                model: new ViewModel({
                    commandParam: type,
                    label: getAdmonitionTitle(editor.t, type),
                    class: `ck-tn-admonition-option ck-tn-admonition-${type}`,
                    role: "menuitemradio",
                    withText: true
                })
            };

            definition.model.bind("isOn").to(command, "value", value => {
                return value === type;
            });

            itemDefinitions.add(definition);
        }

        return itemDefinitions;
    }

}
