import {
    BalloonPanelView, isWidget, Plugin, type PositioningFunction, type ViewDocumentSelection,
    type ViewElement, WidgetToolbarRepository
} from "ckeditor5";

import type { ResizeAnchor } from "../resizable_widgets/resizable_widgets.js";
import ContentEmbed, {
    CONVERT_EMBED_TO_LINK_COMMAND,
    CONTENT_EMBED_MENU,
    CONTENT_EMBED_DISPLAY_MODE_SEPARATOR,
    DISPLAY_MODE_BUTTONS,
    DISPLAY_MODES,
    getEmbedAnchor,
    TOGGLE_CAPTION_COMMAND_NAME,
    TOGGLE_EDITABLE_COMMAND_NAME,
    TOGGLE_TITLE_COMMAND_NAME
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
            ContentEmbedPositionDropdown, ContentEmbedTools, ExtendedCodeBlock
        ] as const;
    }

    afterInit() {
        const editor = this.editor;
        const widgetToolbarRepository = editor.plugins.get(WidgetToolbarRepository);
        const getAnchor = () => {
            const embed = findRelatedEmbed(editor.editing.view.document.selection);
            const modelEmbed = embed && editor.editing.mapper.toModelElement(embed);
            return modelEmbed ? getEmbedAnchor(modelEmbed) : "center";
        };

        widgetToolbarRepository.register("contentEmbed", {
            items: [
                TOGGLE_EDITABLE_COMMAND_NAME,
                CONTENT_EMBED_DISPLAY_MODE_SEPARATOR,
                ...DISPLAY_MODES.map((mode) => DISPLAY_MODE_BUTTONS[mode]),
                CONTENT_EMBED_TOOLS,
                EXTENDED_CODE_BLOCK_COPY_BUTTON,
                CONTENT_EMBED_BOX_SIZE_DROPDOWN,
                CONTENT_EMBED_POSITION_DROPDOWN,
                TOGGLE_TITLE_COMMAND_NAME,
                TOGGLE_CAPTION_COMMAND_NAME,
                CONVERT_EMBED_TO_LINK_COMMAND,
                CONTENT_EMBED_MENU
            ],
            balloonClassName: "ck-toolbar-container include-note-toolbar",
            positions: getToolbarPositions(getAnchor),
            getRelatedElement: findRelatedEmbed
        });
    }

}

/** The embed that the toolbar shows for: the selected one, or the one whose caption is edited. */
function findRelatedEmbed(selection: ViewDocumentSelection) {
    const selectedElement = selection.getSelectedElement();

    if (selectedElement && isContentEmbedWidget(selectedElement)) {
        return selectedElement;
    }

    for (const ancestor of selection.getFirstPosition()?.getAncestors() ?? []) {
        if (ancestor.is("element") && isContentEmbedWidget(ancestor)) {
            return ancestor;
        }
    }

    return null;
}

function isContentEmbedWidget(element: ViewElement): boolean {
    return isWidget(element) && element.hasClass("include-note");
}

/**
 * The positions of the toolbar: level with the edge of the embed that `getAnchor()` returns, then,
 * or where those do not fit, the positions that `WidgetToolbarRepository` gives a widget toolbar.
 */
function getToolbarPositions(getAnchor: () => ResizeAnchor): PositioningFunction[] {
    const {
        northArrowSouth, northArrowSouthWest, northArrowSouthEast, southArrowNorth,
        southArrowNorthWest, southArrowNorthEast, viewportStickyNorth
    } = BalloonPanelView.defaultPositions;

    return [
        alignToAnchor(northArrowSouth, { left: "arrow_sw", right: "arrow_se" }, getAnchor),
        alignToAnchor(southArrowNorth, { left: "arrow_nw", right: "arrow_ne" }, getAnchor),
        alignToAnchor(viewportStickyNorth, { left: "arrowless", right: "arrowless" }, getAnchor),
        northArrowSouth, northArrowSouthWest, northArrowSouthEast,
        southArrowNorth, southArrowNorthWest, southArrowNorthEast, viewportStickyNorth
    ];
}

/** The arrow names of a toolbar level with the left and with the right edge of its target. */
type EdgeArrows = Record<"left" | "right", string>;

/**
 * `position` moved level with the edge of the target that `getAnchor()` returns, with the arrow
 * that `arrows` names for that edge. A centered target gets no position.
 */
function alignToAnchor(
    position: PositioningFunction,
    arrows: EdgeArrows,
    getAnchor: () => ResizeAnchor
): PositioningFunction {
    return (targetRect, balloonRect, viewportRect, limiterRect) => {
        const anchor = getAnchor();
        if (anchor !== "left" && anchor !== "right") {
            return null;
        }

        const result = position(targetRect, balloonRect, viewportRect, limiterRect);
        return result && {
            ...result,
            left: anchor === "left" ? targetRect.left : targetRect.right - balloonRect.width,
            name: arrows[anchor]
        };
    };
}
