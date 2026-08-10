import { addListToDropdown, Collection, createDropdown, type ListDropdownItemDefinition, Plugin, SplitButtonView, ViewModel } from "ckeditor5";

import insertFootnoteIcon from "../../icons/insert-footnote.svg?raw";
import { ATTRIBUTES, COMMANDS, ELEMENTS, TOOLBAR_COMPONENT_NAME } from "./constants.js";
import { modelQueryElement, modelQueryElementsAll } from "./utils.js";

/**
 * Registers the footnote split button: the button inserts a new footnote, while the dropdown also
 * lists the existing footnotes so an inline reference to one of them can be inserted instead.
 */
export default class FootnoteUI extends Plugin {

    public static get pluginName() {
        return "FootnoteUI" as const;
    }

    public init(): void {
        const editor = this.editor;
        const t = editor.t;

        editor.ui.componentFactory.add(TOOLBAR_COMPONENT_NAME, (locale) => {
            const dropdownView = createDropdown(locale, SplitButtonView);
            const splitButtonView = dropdownView.buttonView;

            const command = editor.commands.get(COMMANDS.insertFootnote);
            if (!command) {
                throw new Error("Command not found.");
            }

            splitButtonView.set({
                label: t("Footnote"),
                icon: insertFootnoteIcon,
                tooltip: true,
                isToggleable: true
            });
            splitButtonView.bind("isOn").to(command, "value", (value) => !!value);
            splitButtonView.on("execute", () => {
                editor.execute(COMMANDS.insertFootnote, { footnoteIndex: 0 });
                editor.editing.view.focus();
            });

            dropdownView.class = "ck-tn-dropdown";
            dropdownView.bind("isEnabled").to(command);

            // The list is rebuilt every time the dropdown opens, because which footnotes exist —
            // and therefore which items the list should offer — changes as the document is edited.
            dropdownView.on("change:isOpen", (_evt, _propertyName, isOpen) => {
                dropdownView.listView?.items.clear();

                if (isOpen) {
                    addListToDropdown(dropdownView, this.getDropdownItemsDefinitions());
                    return;
                }

                const listElement = dropdownView.listView?.element;
                listElement?.parentNode?.removeChild(listElement);
            });

            // Execute the command when a dropdown item is clicked (executed).
            this.listenTo(dropdownView, "execute", (evt) => {
                editor.execute(COMMANDS.insertFootnote, {
                    footnoteIndex: (evt.source as { commandParam?: number }).commandParam
                });
                editor.editing.view.focus();
            });

            return dropdownView;
        });
    }

    /**
     * Builds the dropdown contents: "New footnote", followed by one entry per existing footnote.
     */
    public getDropdownItemsDefinitions(): Collection<ListDropdownItemDefinition> {
        const itemDefinitions = new Collection<ListDropdownItemDefinition>();
        const t = this.editor.t;

        itemDefinitions.add({
            type: "button",
            model: new ViewModel({
                commandParam: 0,
                label: t("New footnote"),
                withText: true
            })
        });

        const rootElement = this.editor.model.document.getRoot();
        if (!rootElement) {
            throw new Error("Document has no root element.");
        }

        const footnoteSection = modelQueryElement(this.editor, rootElement, (element) =>
            element.is("element", ELEMENTS.footnoteSection)
        );

        if (footnoteSection) {
            const footnoteItems = modelQueryElementsAll(this.editor, rootElement, (element) =>
                element.is("element", ELEMENTS.footnoteItem)
            );

            for (const footnote of footnoteItems) {
                const index = footnote.getAttribute(ATTRIBUTES.footnoteIndex);

                itemDefinitions.add({
                    type: "button",
                    model: new ViewModel({
                        commandParam: index,
                        label: t("Insert footnote %0", String(index)),
                        withText: true
                    })
                });
            }
        }

        return itemDefinitions;
    }

}
