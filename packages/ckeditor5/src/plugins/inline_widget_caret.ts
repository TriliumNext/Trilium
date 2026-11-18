import {
    type DowncastInsertEvent, type Editor, isWidget, type ModelElement, type ModelNode,
    type ModelPosition, Plugin, type ViewElement, type ViewNode, WIDGET_CLASS_NAME
} from "ckeditor5";

import { addEditingKeydownCapture } from "./move_block_updown.js";

/**
 * Lets Up and Down put the caret on lines that hold inline widgets but no text, such as link
 * previews in paragraphs of their own. A browser puts the caret only on editable text or a line
 * break: Firefox skips such a line, Chromium goes to the start or the end of the note, and WebKit
 * puts the caret into the widget.
 */
export default class InlineWidgetCaret extends Plugin {

    /** Whether the last key pressed in the editor was Up or Down. */
    private isVerticalMove = false;

    /** Whether the renderer is deciding if the caret needs an inline filler. */
    private isCheckingInlineFiller = false;

    static get pluginName() {
        return "InlineWidgetCaret" as const;
    }

    init() {
        const editor = this.editor;

        // The browser puts the caret before a block filler, so a widget that ends a text block
        // gets one after it.
        this.listenTo<DowncastInsertEvent>(editor.editing.downcastDispatcher, "insert",
            (_evt, { item }, { mapper, schema }) => {
                const viewElement = item.is("element") && schema.checkChild(item, "$text")
                    ? mapper.toViewElement(item)
                    : undefined;
                if (viewElement) {
                    addFillerAfterWidget(viewElement, () => !this.isCheckingInlineFiller);
                }
            }, { priority: "lowest" });

        // The renderer adds no inline filler at a block filler, but the caret after the widget
        // needs one: Firefox can take a caret before the block filler to be on the first line of
        // the widget.
        //@ts-expect-error: We are accessing a private field.
        const renderer: InlineFillerRenderer = editor.editing.view._renderer;
        const needsInlineFiller = renderer._needsInlineFillerAtSelection.bind(renderer);
        renderer._needsInlineFillerAtSelection = () => {
            this.isCheckingInlineFiller = true;
            const isNeeded = needsInlineFiller();
            this.isCheckingInlineFiller = false;
            return isNeeded;
        };

        addEditingKeydownCapture(this, (event) => this.onKeydown(event));
        editor.editing.view.once("render", () => this.watchDomSelection());
    }

    private onKeydown(event: KeyboardEvent) {
        this.isVerticalMove = (event.key === "ArrowUp" || event.key === "ArrowDown")
            && !event.altKey && !event.ctrlKey && !event.metaKey && !event.isComposing
            && !event.defaultPrevented;
        if (this.isVerticalMove) {
            this.moveOverWidgetLine(event, event.key === "ArrowUp");
        }
    }

    /**
     * Moves the caret over the next lines of its block that hold widgets but no text. The caret
     * goes to the edge of a widget on the last of those lines, and the browser moves it on from
     * there. When that line has no widget edge, the caret goes past the widget.
     */
    private moveOverWidgetLine(event: KeyboardEvent, isUp: boolean) {
        const editor = this.editor;
        const model = editor.model;
        const selection = model.document.selection;
        const focus = selection.focus as ModelPosition;
        const block = focus.parent as ModelElement;
        if (selection.getSelectedElement() || (!selection.isCollapsed && !event.shiftKey)
            || ![ ...block.getChildren() ].some((child) => getWidgetDom(editor, child))) {
            return;
        }

        const lines = getLines(editor, block);
        const caret = getCaretBox(editor, focus, lines);
        if (!caret) {
            return;
        }

        // The lines past the middle of the caret, nearest first.
        const middle = (caret.top + caret.bottom) / 2;
        const ahead = lines
            .filter((line) => isUp ? line.bottom <= middle : line.top >= middle)
            .sort((a, b) => isUp ? b.top - a.top : a.top - b.top);
        // The browser reaches a line with text, and leaves the block from its edge line.
        if (!ahead.length || ahead[0].hasText) {
            return;
        }

        const textIndex = ahead.findIndex((line) => line.hasText);
        const lastLine = ahead[(textIndex === -1 ? ahead.length : textIndex) - 1];
        const edge = pickEdge(lastLine.edges, isUp);
        const widget = lastLine.widgets[0];
        const target = edge ?? (isUp
            ? model.createPositionBefore(widget)
            : model.createPositionAfter(widget));
        model.change((writer) => {
            if (event.shiftKey) {
                writer.setSelectionFocus(target);
            } else {
                writer.setSelection(target);
            }
        });

        if (!edge || event.shiftKey) {
            event.preventDefault();
            event.stopImmediatePropagation();
            editor.editing.view.scrollToTheSelection();
        }
    }

    private watchDomSelection() {
        const domRoot = this.editor.editing.view.getDomRoot() as HTMLElement;
        const domDocument = domRoot.ownerDocument;
        const onPointerDown = () => {
            this.isVerticalMove = false;
        };
        const onSelectionChange = () => {
            this.leaveWidget(domRoot, domDocument.getSelection() as Selection);
        };
        domRoot.addEventListener("pointerdown", onPointerDown, { capture: true });
        domDocument.addEventListener("selectionchange", onSelectionChange);
        this.listenTo(this.editor, "destroy", () => {
            domRoot.removeEventListener("pointerdown", onPointerDown, { capture: true });
            domDocument.removeEventListener("selectionchange", onSelectionChange);
        });
    }

    /**
     * Moves a caret that Up or Down put into an inline widget, as WebKit does, beside the widget:
     * before it from a line above the last line of the widget, after it otherwise.
     */
    private leaveWidget(domRoot: HTMLElement, domSelection: Selection) {
        const node = domSelection.focusNode;
        if (!this.isVerticalMove || !domSelection.isCollapsed || !domRoot.contains(node)) {
            return;
        }

        const editor = this.editor;
        const element = (node instanceof Element ? node : (node as Node).parentElement) as Element;
        const domWidget = element.closest<HTMLElement>(`.${WIDGET_CLASS_NAME}`);
        if (!domWidget) {
            return;
        }
        const widget = editor.editing.mapper.toModelElement(
            editor.editing.view.domConverter.mapDomToView(domWidget) as ViewElement);
        if (!widget || !editor.model.schema.isInline(widget)) {
            return;
        }

        this.isVerticalMove = false;
        const fragments = domWidget.getClientRects();
        const caret = domSelection.getRangeAt(0).getBoundingClientRect();
        const isBefore = (caret.top + caret.bottom) / 2 < fragments[fragments.length - 1].top;
        editor.model.change((writer) => {
            writer.setSelection(widget, isBefore ? "before" : "after");
        });
    }
}

/** A line of a text block on the screen. */
interface Line {
    top: number;
    bottom: number;
    /** Whether the line holds text or a line break, where the browser can put the caret. */
    hasText: boolean;
    /** The widgets with a part on the line. */
    widgets: ModelElement[];
    /** The positions before the widgets that start on the line and after those that end on it. */
    edges: ModelPosition[];
}

/** The box of some text, of a part of a widget, or of a widget edge. */
interface LinePart {
    rect: DOMRect;
    widget?: ModelElement;
    edge?: ModelPosition;
}

interface DomPosition {
    parent: Node;
    offset: number;
}

/** The private method of the editing view's `Renderer` that this plugin wraps. */
interface InlineFillerRenderer {
    _needsInlineFillerAtSelection(): boolean;
}

/**
 * Wraps `getFillerOffset()` of the view element of a text block, so that the block also gets a
 * block filler when its content ends with a widget, while `isEnabled()` returns `true`.
 */
function addFillerAfterWidget(element: ViewElement, isEnabled: () => boolean) {
    const getFillerOffset = element.getFillerOffset as () => number | null;
    element.getFillerOffset = function (this: ViewElement) {
        return getFillerOffset.call(this)
            ?? (isEnabled() && endsWithWidget(this) ? this.childCount : null);
    };
}

/** Whether the last content of `element`, inside attribute elements, is a widget. */
function endsWithWidget(element: ViewElement): boolean {
    const last: ViewNode | undefined = [ ...element.getChildren() ]
        .findLast((child) => !child.is("uiElement"));
    return last?.is("attributeElement") ? endsWithWidget(last) : !!last && isWidget(last);
}

/** The DOM element of `node` when the editing view draws it as a widget, `null` otherwise. */
function getWidgetDom(editor: Editor, node: ModelNode) {
    const { mapper, view } = editor.editing;
    const viewElement = node.is("element") ? mapper.toViewElement(node) : undefined;
    return viewElement && isWidget(viewElement)
        ? view.domConverter.mapViewToDom(viewElement) as HTMLElement
        : null;
}

/** The lines of `block`, in no particular order, from the boxes of its text and its widgets. */
function getLines(editor: Editor, block: ModelElement): Line[] {
    const { mapper, view } = editor.editing;
    const model = editor.model;
    const parts: LinePart[] = [];
    for (const child of block.getChildren()) {
        const widgetDom = getWidgetDom(editor, child);
        if (!widgetDom) {
            const viewRange = mapper.toViewRange(model.createRangeOn(child));
            const domRange = view.domConverter.viewRangeToDom(viewRange);
            for (const rect of Array.from(domRange.getClientRects())) {
                parts.push({ rect });
            }
            continue;
        }

        const widget = child as ModelElement;
        const rects = widgetDom.getClientRects();
        for (const [ index, rect ] of Array.from(rects).entries()) {
            parts.push({ rect, widget });
            if (index === 0) {
                parts.push({ rect, edge: model.createPositionBefore(widget) });
            }
            if (index === rects.length - 1) {
                parts.push({ rect, edge: model.createPositionAfter(widget) });
            }
        }
    }

    const domBlock = view.domConverter.mapViewToDom(mapper.toViewElement(block) as ViewElement);
    const filler = (domBlock as HTMLElement).lastChild as ChildNode;
    if (view.domConverter.isBlockFiller(filler)) {
        parts.push({ rect: (filler as HTMLElement).getBoundingClientRect() });
    }
    return groupLines(parts);
}

/** Puts each part on the line of the tallest part whose box holds the middle of the part. */
function groupLines(parts: LinePart[]): Line[] {
    const lines: Line[] = [];
    for (const { rect, widget, edge } of parts.sort((a, b) => b.rect.height - a.rect.height)) {
        const middle = (rect.top + rect.bottom) / 2;
        let line = lines.find((candidate) => candidate.top < middle && middle < candidate.bottom);
        if (!line) {
            line = { top: rect.top, bottom: rect.bottom, hasText: false, widgets: [], edges: [] };
            lines.push(line);
        }
        if (widget) {
            line.widgets.push(widget);
        } else if (edge) {
            line.edges.push(edge);
        } else {
            line.hasText = true;
        }
    }
    return lines;
}

/**
 * The vertical extent of the caret at `position`: the box of the text there, or else the line
 * of the widget edge at `position`. `null` when neither is there.
 */
function getCaretBox(editor: Editor, position: ModelPosition, lines: Line[]) {
    const { mapper, view } = editor.editing;
    const { parent, offset } = view.domConverter
        .viewPositionToDom(mapper.toViewPosition(position)) as DomPosition;
    const range = (parent.ownerDocument as Document).createRange();
    range.setStart(parent, offset);
    return range.getClientRects().item(0)
        ?? lines.find((line) => line.edges.some((edge) => edge.isEqual(position)))
        ?? null;
}

/** The edge nearest to the caret along the text: the last one going up, the first going down. */
function pickEdge(edges: ModelPosition[], isUp: boolean): ModelPosition | undefined {
    const sorted = [ ...edges ].sort((a, b) => a.offset - b.offset);
    return isUp ? sorted[sorted.length - 1] : sorted[0];
}

declare module "ckeditor5" {
    interface PluginsMap {
        [InlineWidgetCaret.pluginName]: InlineWidgetCaret;
    }
}
