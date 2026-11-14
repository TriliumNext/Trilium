import { MEDIA_EMBED_CLASS } from "@triliumnext/commons";
import {
    isWidget, Plugin, type ViewDocumentSelection, type ViewElement, WidgetToolbarRepository
} from "ckeditor5";

import {
    LinkEmbedCopyUrlButton, LinkEmbedDisplayDropdown
} from "../link_embed/link_embed_toolbar.js";
import PositionedWidgets, { getAnchoredToolbarPositions } from "../positioned_widgets.js";
import ContentEmbed, {
    CONTENT_EMBED_MENU,
    CONTENT_EMBED_DISPLAY_MODE_SEPARATOR,
    DISPLAY_MODE_BUTTONS,
    DISPLAY_MODES,
    TOGGLE_CAPTION_COMMAND_NAME,
    TOGGLE_EDITABLE_COMMAND_NAME
} from "./content_embed.js";
import ContentEmbedBoxSizeDropdown, {
    CONTENT_EMBED_BOX_SIZE_DROPDOWN
} from "./content_embed_box_size_dropdown.js";
import ContentEmbedPositionDropdown, {
    CONTENT_EMBED_POSITION_DROPDOWN
} from "./content_embed_position_dropdown.js";
import ContentEmbedTools, { CONTENT_EMBED_TOOLS } from "./content_embed_tools.js";
import ExtendedCodeBlock, { EXTENDED_CODE_BLOCK_COPY_BUTTON } from "./extended_code_block.js";

export default class ContentEmbedToolbar extends Plugin {

    static get requires() {
        return [
            WidgetToolbarRepository, ContentEmbed, ContentEmbedBoxSizeDropdown,
            ContentEmbedPositionDropdown, ContentEmbedTools, ExtendedCodeBlock,
            LinkEmbedCopyUrlButton, LinkEmbedDisplayDropdown
        ] as const;
    }

    afterInit() {
        const editor = this.editor;
        const widgetToolbarRepository = editor.plugins.get(WidgetToolbarRepository);
        const positionedWidgets = editor.plugins.get(PositionedWidgets);
        const getAnchor = () => {
            const selection = editor.editing.view.document.selection;
            const embed = findRelatedEmbed(selection) ?? findRelatedMedia(selection);
            const modelEmbed = embed && editor.editing.mapper.toModelElement(embed);
            return modelEmbed ? positionedWidgets.getAnchor(modelEmbed) : "center";
        };

        // Media has the copy and display items of a link preview, and the menu of an embed.
        widgetToolbarRepository.register("mediaEmbed", {
            items: [ "linkEmbedCopyUrl", "|", "linkEmbedDisplayDropdown", CONTENT_EMBED_MENU ],
            balloonClassName: "ck-toolbar-container include-note-toolbar",
            positions: getAnchoredToolbarPositions(getAnchor),
            getRelatedElement: findRelatedMedia
        });

        widgetToolbarRepository.register("contentEmbed", {
            items: [
                TOGGLE_EDITABLE_COMMAND_NAME,
                CONTENT_EMBED_DISPLAY_MODE_SEPARATOR,
                ...DISPLAY_MODES.map((mode) => DISPLAY_MODE_BUTTONS[mode]),
                CONTENT_EMBED_TOOLS,
                EXTENDED_CODE_BLOCK_COPY_BUTTON,
                TOGGLE_CAPTION_COMMAND_NAME,
                CONTENT_EMBED_BOX_SIZE_DROPDOWN,
                CONTENT_EMBED_POSITION_DROPDOWN,
                CONTENT_EMBED_MENU
            ],
            balloonClassName: "ck-toolbar-container include-note-toolbar",
            positions: getAnchoredToolbarPositions(getAnchor),
            getRelatedElement: findRelatedEmbed
        });
    }

}

/** The embed that the toolbar shows for: the selected one, or the one whose caption is edited. */
function findRelatedEmbed(selection: ViewDocumentSelection) {
    return findRelatedWidget(selection, isContentEmbedWidget);
}

/** The media embed that the selection is on or in the caption of, with a toolbar of its own. */
function findRelatedMedia(selection: ViewDocumentSelection) {
    return findRelatedWidget(selection, isMediaEmbedWidget);
}

/** The widget that `matches()` and that `selection` is on or inside, or `null`. */
function findRelatedWidget(
    selection: ViewDocumentSelection, matches: (element: ViewElement) => boolean
) {
    const selectedElement = selection.getSelectedElement();

    if (selectedElement && matches(selectedElement)) {
        return selectedElement;
    }

    for (const ancestor of selection.getFirstPosition()?.getAncestors() ?? []) {
        if (ancestor.is("element") && matches(ancestor)) {
            return ancestor;
        }
    }

    return null;
}

function isContentEmbedWidget(element: ViewElement): boolean {
    return isWidget(element) && element.hasClass("include-note")
        && !element.hasClass(MEDIA_EMBED_CLASS);
}

function isMediaEmbedWidget(element: ViewElement): boolean {
    return isWidget(element) && element.hasClass(MEDIA_EMBED_CLASS);
}
