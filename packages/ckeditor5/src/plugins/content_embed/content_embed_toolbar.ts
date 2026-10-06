import { Plugin, WidgetToolbarRepository, isWidget, type ViewElement } from "ckeditor5";
import ContentEmbed, {
    CONVERT_EMBED_TO_LINK_COMMAND,
    CONTENT_EMBED_MENU,
    TOGGLE_CAPTION_COMMAND_NAME,
    TOGGLE_EDITABLE_COMMAND_NAME,
    TOGGLE_TITLE_COMMAND_NAME
} from "./content_embed.js";
import ContentEmbedBoxSizeDropdown, {
    CONTENT_EMBED_BOX_SIZE_DROPDOWN
} from "./content_embed_box_size_dropdown.js";
import ContentEmbedTools, { CONTENT_EMBED_TOOLS } from "./content_embed_tools.js";

export default class ContentEmbedToolbar extends Plugin {

    static get requires() {
        return [
            WidgetToolbarRepository, ContentEmbed, ContentEmbedBoxSizeDropdown, ContentEmbedTools
        ] as const;
    }

    afterInit() {
        const editor = this.editor;
        const widgetToolbarRepository = editor.plugins.get(WidgetToolbarRepository);

        widgetToolbarRepository.register("contentEmbed", {
            items: [
                TOGGLE_EDITABLE_COMMAND_NAME,
                CONTENT_EMBED_TOOLS,
                CONTENT_EMBED_BOX_SIZE_DROPDOWN,
                TOGGLE_TITLE_COMMAND_NAME,
                TOGGLE_CAPTION_COMMAND_NAME,
                CONVERT_EMBED_TO_LINK_COMMAND,
                CONTENT_EMBED_MENU
            ],
            balloonClassName: "ck-toolbar-container include-note-toolbar",
            getRelatedElement(selection) {
                const selectedElement = selection.getSelectedElement();

                if (selectedElement && isContentEmbedWidget(selectedElement)) {
                    return selectedElement;
                }

                // The toolbar stays on the embed while its caption is edited.
                for (const ancestor of selection.getFirstPosition()?.getAncestors() ?? []) {
                    if (ancestor.is("element") && isContentEmbedWidget(ancestor)) {
                        return ancestor;
                    }
                }

                return null;
            }
        });
    }

}

function isContentEmbedWidget(element: ViewElement): boolean {
    return isWidget(element) && element.hasClass("include-note");
}
