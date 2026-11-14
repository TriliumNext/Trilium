import { type Command, Plugin } from "ckeditor5";

import { createWidgetPositionDropdown } from "../positioned_widgets.js";
import ContentEmbed, { isToolbarItemHidden, POSITION_COMMAND_NAME } from "./content_embed.js";

export const CONTENT_EMBED_POSITION_DROPDOWN = "contentEmbedPositionDropdown";

/**
 * The toolbar dropdown that sets where an embed is placed in the text, with the rows and icons of
 * the image position dropdown. Shown for content whose tools opt in to positions and do not hide
 * it, with the positions that the box size of the embed can take.
 */
export default class ContentEmbedPositionDropdown extends Plugin {

    static get requires() {
        return [ ContentEmbed ] as const;
    }

    static get pluginName() {
        return "ContentEmbedPositionDropdown" as const;
    }

    init() {
        const editor = this.editor;
        const command = editor.commands.get(POSITION_COMMAND_NAME) as Command;
        const contentEmbed = editor.plugins.get(ContentEmbed);

        editor.ui.componentFactory.add(CONTENT_EMBED_POSITION_DROPDOWN, (locale) => {
            const dropdown = createWidgetPositionDropdown(editor, locale, {
                commandName: POSITION_COMMAND_NAME,
                label: editor.t("Box position")
            });
            dropdown.bind("class").to(
                command, "isEnabled",
                contentEmbed, "selectedEmbedTools",
                contentEmbed, "isSelectedEmbedEditable",
                (isEnabled, tools, isEditable) => {
                    const isShown = isEnabled && !!tools?.hasPositions
                        && !isToolbarItemHidden(tools, CONTENT_EMBED_POSITION_DROPDOWN, isEditable);
                    return isShown ? undefined : "ck-hidden";
                }
            );
            return dropdown;
        });
    }
}

declare module "ckeditor5" {
    interface PluginsMap {
        [ ContentEmbedPositionDropdown.pluginName ]: ContentEmbedPositionDropdown;
    }
}
