import { BOX_SIZES, type BoxSize } from "@triliumnext/commons";
import {
    addListToDropdown, Collection, type Command, createDropdown, DropdownButtonView,
    type ListDropdownItemDefinition, Plugin, UIModel
} from "ckeditor5";

import ContentEmbed, {
    BOX_SIZE_COMMAND_NAME, DEFAULT_BOX_SIZE_COMMAND_NAME, getBoxSizeLabel, isToolbarItemHidden
} from "./content_embed.js";

export const CONTENT_EMBED_BOX_SIZE_DROPDOWN = "contentEmbedBoxSizeDropdown";

/**
 * The toolbar dropdown that lists the box sizes the selected embed can take, the current one on,
 * and _Default_ last, apart from them, which puts the embed back at the box it started with.
 */
export default class ContentEmbedBoxSizeDropdown extends Plugin {

    static get requires() {
        return [ ContentEmbed ] as const;
    }

    public init() {
        const editor = this.editor;
        const componentFactory = editor.ui.componentFactory;

        const itemDefinitions = this.getItemDefinitions();
        const command = editor.commands.get(BOX_SIZE_COMMAND_NAME) as Command & {
            value: BoxSize | null;
        };
        const contentEmbed = editor.plugins.get(ContentEmbed);

        componentFactory.add(CONTENT_EMBED_BOX_SIZE_DROPDOWN, _locale => {
            const dropdownView = createDropdown(editor.locale, DropdownButtonView);
            const buttonView = dropdownView.buttonView;
            const boxSizeLabel = editor.t("Box size");
            buttonView.set({ tooltip: true });
            dropdownView.bind("isEnabled").to(command, "isEnabled");
            dropdownView.bind("class").to(
                contentEmbed, "selectedEmbedTools", contentEmbed, "isSelectedEmbedEditable",
                (tools, isEditable) => {
                    const isHidden =
                        isToolbarItemHidden(tools, CONTENT_EMBED_BOX_SIZE_DROPDOWN, isEditable);
                    return isHidden ? "ck-hidden" : undefined;
                }
            );
            buttonView.bind("icon").to(contentEmbed, "selectedEmbedTools", (tools) => {
                return tools?.boxSizeIcon;
            });
            buttonView.bind("withText").to(contentEmbed, "selectedEmbedTools", (tools) => {
                return !tools?.boxSizeIcon;
            });
            buttonView.bind("label").to(
                command, "value", contentEmbed, "selectedEmbedTools",
                (value, tools) => {
                    if (!value) return boxSizeLabel;
                    const sizeLabel = getBoxSizeLabel(editor.t, value);
                    return tools?.boxSizeIcon ? editor.t("Box size: %0", sizeLabel) : sizeLabel;
                }
            );
            dropdownView.on("execute", evt => {
                const { boxSizeValue } = evt.source as { boxSizeValue?: BoxSize };
                if (boxSizeValue) {
                    editor.execute(BOX_SIZE_COMMAND_NAME, { value: boxSizeValue });
                } else {
                    editor.execute(DEFAULT_BOX_SIZE_COMMAND_NAME);
                }
                editor.editing.view.focus();
            });
            addListToDropdown(dropdownView, itemDefinitions);
            return dropdownView;
        });
    }

    /** A radio item per box size, shown while the selected embed can take it, then Default. */
    private getItemDefinitions(): Collection<ListDropdownItemDefinition> {
        const editor = this.editor;
        const command = editor.commands.get(BOX_SIZE_COMMAND_NAME) as Command & {
            value: BoxSize | null;
        };
        const defaultCommand = editor.commands.get(DEFAULT_BOX_SIZE_COMMAND_NAME) as Command;
        const contentEmbed = editor.plugins.get(ContentEmbed);
        const itemDefinitions = new Collection<ListDropdownItemDefinition>();

        for (const size of BOX_SIZES) {
            const model = new UIModel({
                boxSizeValue: size,
                label: getBoxSizeLabel(editor.t, size),
                role: "menuitemradio",
                withText: true
            });
            model.bind("isOn").to(command, "value", value => value === size);
            model.bind("isVisible").to(contentEmbed, "selectedEmbedBoxSizes",
                sizes => sizes.includes(size));
            itemDefinitions.add({ type: "button", model });
        }

        itemDefinitions.add({ type: "separator" });
        const defaultModel = new UIModel({
            label: editor.t("Default"),
            role: "menuitem",
            withText: true
        });
        defaultModel.bind("isEnabled").to(defaultCommand, "isEnabled");
        itemDefinitions.add({ type: "button", model: defaultModel });

        return itemDefinitions;
    }

}
