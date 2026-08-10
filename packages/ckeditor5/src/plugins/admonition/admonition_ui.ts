/**
 * Written for Trilium Notes, and not a derivative of `BlockQuoteUI` beyond the handful of lines
 * every CKEditor UI plugin shares: register a component in the factory, bind it to the command's
 * `value`/`isEnabled`, and focus the editing view after executing.
 *
 * Upstream offers a single toggle `ButtonView` (plus a menu-bar variant); this is a `SplitButtonView`
 * in a dropdown, where the button re-applies the previously chosen type and the list offers all five.
 * The type definitions, titles and per-item bindings below have no upstream counterpart.
 */

import { addListToDropdown, Collection, createDropdown, ListDropdownItemDefinition, Plugin, SplitButtonView, ViewModel } from "ckeditor5";

import admonitionIcon from "../../icons/admonition.svg?raw";
import { ADMONITION_TYPE_NAMES, AdmonitionType } from "./admonition_command.js";

/**
 * The admonition UI plugin.
 *
 * It introduces the `'admonition'` split button: clicking the button applies the previously chosen
 * type, while the dropdown offers every type.
 */
export default class AdmonitionUI extends Plugin {

    /**
     * @inheritDoc
     */
    public static get pluginName() {
        return "AdmonitionUI" as const;
    }

    /**
     * @inheritDoc
     */
    public init(): void {
        const editor = this.editor;

        editor.ui.componentFactory.add("admonition", () => this._createButton());
    }

    /**
     * Creates a button for the admonition command to use either in toolbar or in menu bar.
     */
    private _createButton() {
        const editor = this.editor;
        const locale = editor.locale;
        const command = editor.commands.get("admonition");
        const dropdownView = createDropdown(locale, SplitButtonView);
        const splitButtonView = dropdownView.buttonView;
        const t = locale.t;

        addListToDropdown(dropdownView, this._getDropdownItems());

        // Button configuration.
        splitButtonView.set({
            label: t("Admonition"),
            icon: admonitionIcon,
            isToggleable: true,
            tooltip: true
        });
        splitButtonView.on("execute", () => {
            editor.execute("admonition", { usePreviousChoice: true });
            editor.editing.view.focus();
        });

        if (command) {
            splitButtonView.bind("isOn").to(command, "value", (value) => !!value);
            dropdownView.bind("isEnabled").to(command, "isEnabled");
        }

        dropdownView.on("execute", (evt) => {
            const commandParam = (evt.source as { commandParam?: AdmonitionType }).commandParam;
            editor.execute("admonition", { forceValue: commandParam });
            editor.editing.view.focus();
        });

        return dropdownView;
    }

    private _getDropdownItems() {
        const itemDefinitions = new Collection<ListDropdownItemDefinition>();
        const command = this.editor.commands.get("admonition");
        if (!command) {
            return itemDefinitions;
        }

        for (const type of ADMONITION_TYPE_NAMES) {
            const definition: ListDropdownItemDefinition = {
                type: "button",
                model: new ViewModel({
                    commandParam: type,
                    label: getAdmonitionTitle(this.editor.t, type),
                    class: `ck-tn-admonition-option ck-tn-admonition-${type}`,
                    role: "menuitemradio",
                    withText: true
                })
            };

            definition.model.bind("isOn").to(command, "value", (currentType) => currentType === type);
            itemDefinitions.add(definition);
        }

        return itemDefinitions;
    }

}

/**
 * The user-facing title of an admonition type, as shown by the toolbar dropdown, the type dropdown
 * and the slash commands.
 *
 * A switch rather than a table of titles, so that each title is written as a literal argument of a
 * `t()` call: that is how the messages this package owns are discovered (see `messages.ts`) and a
 * title tucked away in a table would be invisible to translators.
 *
 * @param t the editor's translation function (`editor.t`).
 * @param type the admonition type; an unrecognized one has no title and is returned as-is.
 */
export function getAdmonitionTitle(t: (message: string) => string, type: AdmonitionType): string {
    switch (type) {
        case "note":
            return t("Note");
        case "tip":
            return t("Tip");
        case "important":
            return t("Important");
        case "caution":
            return t("Caution");
        case "warning":
            return t("Warning");
        default:
            return type;
    }
}
