import {
    _WIDGET_TYPE_AROUND_SELECTION_ATTRIBUTE as TYPE_AROUND_ATTRIBUTE,
    type Editor,
    type Model,
    type ModelElement,
    type ModelPosition,
    type ModelRange,
    Plugin,
    Rect,
    scrollViewportToShowTarget
} from "ckeditor5";

import TriliumMentionUI from "../mention/trilium_mention_ui.js";
import { addEditingKeydownCapture, isFromEditable } from "../move_block_updown.js";
import {
    getCaption, getContentEmbedAt, getContentEmbedDom, isContentEmbed
} from "./content_embed.js";

/** An end of the content of an embed, where the caret enters or leaves it. */
export type EmbedEdge = "start" | "end";

/**
 * Moves the caret between the text and the editors in embeds with the arrow keys.
 *
 * When an arrow key reaches an embed, the host focuses the editor of the embed at its near edge,
 * through `contentEmbed.enter()`. In the editor of an embed, `focusAt()` and `getEdgeLeftBy()`
 * do the same for its own content, and `leaveEmbed()` of the editor around it takes the caret back.
 */
export default class ContentEmbedCaret extends Plugin {
    static get pluginName() {
        return "ContentEmbedCaret" as const;
    }

    init() {
        // The capture phase runs before the arrow keys of `Widget` and `WidgetTypeAround`.
        addEditingKeydownCapture(this, (event) => {
            const move = getArrowMove(event, this.isRtl());
            if (!move || this.editor.isReadOnly) {
                return;
            }

            const embed = this.getEmbedAhead(move);
            if (embed && this.enterEmbed(embed, move.isForward ? "start" : "end")) {
                event.preventDefault();
                event.stopImmediatePropagation();
            }
        });
    }

    /**
     * Focuses this editor with the caret beside the embed that contains `domElement`, past its
     * `edge`. Returns `false` when `domElement` is not in an embed of this editor.
     */
    leaveEmbed(domElement: Element, edge: EmbedEdge): boolean {
        const editor = this.editor;
        const embed = getContentEmbedAt(editor, domElement);
        if (!embed) {
            return false;
        }

        const model = editor.model;
        const isForward = edge === "end";
        editor.editing.view.focus();
        model.change((writer) => {
            const caption = isForward ? getCaption(embed) : null;
            const outside = isForward
                ? writer.createPositionAfter(embed)
                : writer.createPositionBefore(embed);
            const direction = isForward ? "forward" : "backward";
            const range = caption
                ? writer.createRange(writer.createPositionAt(caption, 0))
                : model.schema.getNearestSelectionRange(outside, direction);

            if (range?.isCollapsed) {
                writer.setSelection(range);
                return;
            }
            // Without text beside the embed, the fake caret of `WidgetTypeAround` shows there.
            writer.setSelection(embed, "on");
            writer.setSelectionAttribute(TYPE_AROUND_ATTRIBUTE, isForward ? "after" : "before");
        });
        scrollToTheCaret(editor);
        return true;
    }

    /** Focuses this editor with the caret at `edge` of its content. */
    focusAt(edge: EmbedEdge) {
        const editor = this.editor;
        const model = editor.model;
        const root = model.document.getRoot();
        const isStart = edge === "start";
        const range = root && model.schema.getNearestSelectionRange(
            model.createPositionAt(root, isStart ? 0 : "end"),
            isStart ? "forward" : "backward"
        );

        if (range) {
            model.change((writer) => {
                writer.setSelection(range);
                // An object at the edge gets the fake caret on its outer side.
                if (!range.isCollapsed) {
                    const side = isStart ? "before" : "after";
                    writer.setSelectionAttribute(TYPE_AROUND_ATTRIBUTE, side);
                }
            });
        }
        editor.editing.view.focus();
        scrollToTheCaret(editor);
    }

    /**
     * The edge of the content that the arrow key of `event`, pressed in this editor, moves the
     * caret past, or `null` while the caret stays in the content or the mention list takes the key.
     */
    getEdgeLeftBy(event: KeyboardEvent): EmbedEdge | null {
        const editor = this.editor;
        const move = getArrowMove(event, this.isRtl());
        const mentions = editor.plugins.has(TriliumMentionUI)
            ? editor.plugins.get(TriliumMentionUI)
            : null;
        if (!move || !isFromEditable(editor, event) || mentions?.isListShown) {
            return null;
        }

        const model = editor.model;
        const selection = model.document.selection;
        const { isForward } = move;
        const edge = isForward ? "end" : "start";
        const selected = selection.getSelectedElement();
        if (selected) {
            // An object at the edge, unless the fake caret shows on its inner side.
            const outside = isForward
                ? model.createPositionAfter(selected)
                : model.createPositionBefore(selected);
            const isInnerSide = selection.getAttribute(TYPE_AROUND_ATTRIBUTE)
                === (isForward ? "before" : "after");
            return !isInnerSide && isAtRootEdge(model, outside, isForward) ? edge : null;
        }

        const focus = selection.focus;
        if (!selection.isCollapsed || !focus) {
            return null;
        }
        if (isAtRootEdge(model, focus, isForward)) {
            return edge;
        }
        return move.isVertical && this.isOnEdgeLine(focus, isForward) ? edge : null;
    }

    /** The embed that `move` takes the caret into from the selection, or `null`. */
    private getEmbedAhead({ isForward, isVertical }: ArrowMove): ModelElement | null {
        const editor = this.editor;
        const model = editor.model;
        const selection = model.document.selection;

        // From the fake caret beside the embed, or forward from the selected embed. Going back,
        // the caption comes first.
        const selected = selection.getSelectedElement();
        if (selected) {
            const side = selection.getAttribute(TYPE_AROUND_ATTRIBUTE);
            const isEntered = isForward
                ? side !== "after"
                : side === "after" && !getCaption(selected);
            return isContentEmbed(selected) && isEntered ? selected : null;
        }

        const focus = selection.focus;
        if (!selection.isCollapsed || !focus) {
            return null;
        }

        // From the start of the caption below the content.
        const block = focus.parent;
        if (block.is("element", "caption") && isContentEmbed(block.parent)) {
            const line = model.createRange(model.createPositionAt(block, 0), focus);
            const isAtStart = isVertical ? isSingleLineRange(editor, line) : focus.isAtStart;
            return !isForward && isAtStart ? block.parent : null;
        }

        const embed = isVertical
            ? getEmbedBelowLine(editor, focus, isForward)
            : getEmbedNextTo(model, isForward);
        return embed && (isForward || !getCaption(embed)) ? embed : null;
    }

    /** Has the host focus the editor in `embed` at `edge`. Returns whether it did. */
    private enterEmbed(embed: ModelElement, edge: EmbedEdge) {
        const editor = this.editor;
        const domElement = getContentEmbedDom(editor, embed);
        return !!domElement && !!editor.config.get("contentEmbed")?.enter?.(domElement, edge);
    }

    /**
     * Whether `position` is on the first line of the content, or on the last one when going
     * forward.
     */
    private isOnEdgeLine(position: ModelPosition, isForward: boolean) {
        const model = this.editor.model;
        const topBlock = position.getAncestors()[1];
        if (!topBlock?.is("element")
            || (isForward ? topBlock.nextSibling : topBlock.previousSibling)) {
            return false;
        }

        const edgeRange = model.schema.getNearestSelectionRange(
            model.createPositionAt(topBlock, isForward ? "end" : 0),
            isForward ? "backward" : "forward"
        );
        if (!edgeRange?.isCollapsed) {
            return false;
        }
        const range = isForward
            ? model.createRange(position, edgeRange.start)
            : model.createRange(edgeRange.start, position);
        return isSingleLineRange(this.editor, range);
    }

    private isRtl() {
        return this.editor.locale.contentLanguageDirection === "rtl";
    }
}

interface ArrowMove {
    isForward: boolean;
    isVertical: boolean;
}

/**
 * The move of an arrow key pressed without modifiers, or `null`. Left and Right follow the
 * screen, so in right-to-left content Left moves forward.
 */
function getArrowMove(event: KeyboardEvent, isRtl: boolean): ArrowMove | null {
    if (event.shiftKey || event.ctrlKey || event.altKey || event.metaKey || event.isComposing) {
        return null;
    }

    switch (event.key) {
        case "ArrowUp":
            return { isForward: false, isVertical: true };
        case "ArrowDown":
            return { isForward: true, isVertical: true };
        case "ArrowLeft":
            return { isForward: isRtl, isVertical: false };
        case "ArrowRight":
            return { isForward: !isRtl, isVertical: false };
        default:
            return null;
    }
}

/**
 * Scrolls to the caret of `editor`, or to the fake caret of `WidgetTypeAround` beside the selected
 * widget. For a widget taller than the window, `scrollToTheSelection()` can show its top only.
 */
function scrollToTheCaret(editor: Editor) {
    const selection = editor.model.document.selection;
    const widget = selection.getAttribute(TYPE_AROUND_ATTRIBUTE)
        ? getContentEmbedDom(editor, selection.getSelectedElement())
        : null;
    const fakeCaret = widget?.querySelector<HTMLElement>(
        ":scope > .ck-widget__type-around > .ck-widget__type-around__fake-caret"
    );

    if (fakeCaret) {
        scrollViewportToShowTarget({ target: fakeCaret, viewportOffset: 20, ancestorOffset: 20 });
    } else {
        editor.editing.view.scrollToTheSelection();
    }
}

/** The embed right beside the collapsed selection, in the direction of the move, or `null`. */
function getEmbedNextTo(model: Model, isForward: boolean) {
    const selection = model.document.selection;
    const probe = model.createSelection(selection);
    model.modifySelection(probe, { direction: isForward ? "forward" : "backward" });
    const node = (isForward ? probe.focus?.nodeBefore : probe.focus?.nodeAfter) ?? null;
    return !probe.isEqual(selection) && isContentEmbed(node) ? node : null;
}

/**
 * The embed that follows the block of `position`, or precedes it going back, while `position`
 * is on the last line of that block, or on its first line. `null` otherwise.
 */
function getEmbedBelowLine(editor: Editor, position: ModelPosition, isForward: boolean) {
    const model = editor.model;
    const schema = model.schema;
    const enteringType = isForward ? "elementStart" : "elementEnd";
    const walker = model.createRangeIn(position.root).getWalker({
        startPosition: position,
        direction: isForward ? "forward" : "backward"
    });

    // The first block or limit element that the walk enters, as `Widget` finds it.
    let embed: ModelElement | null = null;
    for (const { item, type } of walker) {
        if (!item.is("element")) {
            continue;
        }
        if (schema.isLimit(item) && !schema.isInline(item)) {
            embed = type === enteringType && isContentEmbed(item) ? item : null;
            break;
        }
        if (type === enteringType && schema.isBlock(item)) {
            break;
        }
    }

    const block = position.parent;
    const line = isForward
        ? model.createRange(position, model.createPositionAt(block, "end"))
        : model.createRange(model.createPositionAt(block, 0), position);
    return embed && isSingleLineRange(editor, line) ? embed : null;
}

/**
 * Whether no position for the caret, and no object, lies between `position` and the edge of its
 * root, in the direction of the move.
 */
function isAtRootEdge(model: Model, position: ModelPosition, isForward: boolean) {
    const schema = model.schema;
    const rootRange = model.createRangeIn(position.root);
    const range = isForward
        ? model.createRange(position, rootRange.end)
        : model.createRange(rootRange.start, position);
    const enteringType = isForward ? "elementStart" : "elementEnd";

    for (const { item, type, nextPosition } of range.getWalker({
        direction: isForward ? "forward" : "backward"
    })) {
        if (schema.checkChild(nextPosition, "$text")
            || (type === enteringType && schema.isObject(item))) {
            return false;
        }
    }
    return true;
}

/** Whether the rendering of `range` fits on one line, as `Widget` measures it. */
function isSingleLineRange(editor: Editor, range: ModelRange) {
    const viewRange = editor.editing.mapper.toViewRange(range);
    const domRange = editor.editing.view.domConverter.viewRangeToDom(viewRange);

    // A rectangle that starts below the bottom of the ones before it is on a new line. An empty
    // rectangle, as of an empty text node, has no position.
    let bottom: number | null = null;
    for (const rect of Rect.getDomRangeRects(domRange)) {
        if (rect.width === 0 && rect.height === 0) {
            continue;
        }
        if (bottom !== null && Math.round(rect.top) >= bottom) {
            return false;
        }
        bottom = Math.max(bottom ?? 0, Math.round(rect.bottom));
    }
    return true;
}

declare module "ckeditor5" {
    interface PluginsMap {
        [ContentEmbedCaret.pluginName]: ContentEmbedCaret;
    }
}
