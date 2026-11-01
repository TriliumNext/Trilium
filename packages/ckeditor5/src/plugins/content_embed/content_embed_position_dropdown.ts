import {
    type Command, IconObjectCenter, IconObjectInlineLeft, IconObjectInlineRight, IconObjectLeft,
    IconObjectRight, Plugin
} from "ckeditor5";

import { createPositionDropdown } from "../position_dropdown.js";
import ContentEmbed, { isToolbarItemHidden, POSITION_COMMAND_NAME } from "./content_embed.js";

export const CONTENT_EMBED_POSITION_DROPDOWN = "contentEmbedPositionDropdown";

/**
 * The toolbar dropdown that sets where an embed is placed in the text, with the rows and icons of
 * the image position dropdown. Shown for content that has positions and does not hide it.
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
        const t = editor.t;
        const command = editor.commands.get(POSITION_COMMAND_NAME) as Command;
        const contentEmbed = editor.plugins.get(ContentEmbed);

        editor.ui.componentFactory.add(CONTENT_EMBED_POSITION_DROPDOWN, (locale) => {
            const dropdown = createPositionDropdown(editor, locale, {
                commandName: POSITION_COMMAND_NAME,
                label: t("Box position"),
                groups: [
                    {
                        label: t("Break text"),
                        rows: [
                            { value: "left", label: t("Align left"), icon: IconObjectLeft },
                            { value: "center", label: t("Align center"), icon: IconObjectCenter },
                            { value: "right", label: t("Align right"), icon: IconObjectRight }
                        ]
                    },
                    {
                        label: t("Wrap text"),
                        rows: [
                            {
                                value: "wrap-left", label: t("Align left"),
                                icon: IconObjectInlineLeft
                            },
                            {
                                value: "wrap-right", label: t("Align right"),
                                icon: IconObjectInlineRight
                            }
                        ]
                    }
                ]
            });
            dropdown.bind("class").to(
                command, "isEnabled", contentEmbed, "selectedEmbedTools",
                (isEnabled, tools) => {
                    const isShown = isEnabled
                        && !isToolbarItemHidden(tools, CONTENT_EMBED_POSITION_DROPDOWN);
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
