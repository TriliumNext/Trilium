import {
    BlockButtonView, ClipboardObserver, createElement, DomEmitterMixin, DragDrop, env,
    findClosestScrollableAncestor, IconDragIndicator, type Model, type ModelElement,
    ModelLiveRange, type ModelRange, type ModelSchema, Plugin, Rect, type ViewElement
} from "ckeditor5";

import "../theme/block_drag_handle.css";

/** The class of the blocks that a drag from the hovered handle moves. */
const TARGET_CLASS = "block-drag-handle-target";

/**
 * The drag handle of `BlockToolbar` without the toolbar, for the fixed-toolbar editor: a grip
 * beside the block at the selection that drags the selected blocks to another place in the note.
 * The drag follows `DragDropBlockToolbar`, which only works with `BlockToolbar` itself.
 *
 * The handle sits in a container right after the editable, inside whatever scrolls the blocks,
 * so a scroll moves it along with them and needs no work here.
 */
export default class BlockDragHandle extends Plugin {

    buttonView?: BlockButtonView;
    private container?: HTMLElement;
    /** The editable that `container` follows, observed for changes of its size. */
    private domEditable?: HTMLElement;
    /** The element that `container` is positioned against, as of the last placement. */
    private containingBlock: Element | null = null;
    private resizeObserver?: ResizeObserver;
    private isDragging = false;
    private isHovered = false;
    private isUpdateScheduled = false;
    private targets: ViewElement[] = [];
    private readonly domEmitter = new (DomEmitterMixin())();

    static get pluginName() {
        return "BlockDragHandle" as const;
    }

    static get requires() {
        return [ DragDrop ] as const;
    }

    init() {
        // `DragDrop` is disabled on Android.
        if (env.isAndroid) {
            return;
        }

        const editor = this.editor;
        const buttonView = new BlockButtonView(editor.locale);
        buttonView.set({
            label: editor.t("Drag to move"),
            icon: IconDragIndicator,
            tooltip: true,
            isToggleable: false
        });
        buttonView.extendTemplate({
            attributes: { class: "block-drag-handle", draggable: "true" },
            on: {
                dragstart: buttonView.bindTemplate.to((domEvent) => {
                    this.startDrag(domEvent as DragEvent);
                }),
                mouseenter: buttonView.bindTemplate.to(() => {
                    this.isHovered = true;
                    this.updateTargets();
                }),
                mouseleave: buttonView.bindTemplate.to(() => {
                    this.isHovered = false;
                    this.updateTargets();
                })
            }
        });
        buttonView.on("execute", () => editor.editing.view.focus());
        buttonView.render();
        this.buttonView = buttonView;

        this.listenTo(editor.ui, "update", () => this.update());
        this.listenTo(editor, "change:isReadOnly", () => this.update(), { priority: "low" });
        this.listenTo(editor.ui.focusTracker, "change:isFocused", () => this.update());

        this.domEmitter.listenTo(window, "resize", () => this.scheduleUpdate());
        this.domEmitter.listenTo(document, "scroll", (_evt, domEvent: Event) => {
            if (this.isMovedApartBy(domEvent.target)) {
                this.scheduleUpdate();
            }
        }, { useCapture: true, usePassive: true });

        this.domEmitter.listenTo(document, "dragover", (_evt, domEvent: DragEvent) => {
            this.forwardDrag(domEvent);
        });
        this.domEmitter.listenTo(document, "drop", (_evt, domEvent: DragEvent) => {
            this.forwardDrag(domEvent);
        });
        this.domEmitter.listenTo(document, "dragend", (_evt, domEvent: DragEvent) => {
            this.endDrag(domEvent);
        }, { useCapture: true });
    }

    override destroy() {
        this.domEmitter.stopListening();
        this.resizeObserver?.disconnect();
        this.container?.remove();
        this.buttonView?.destroy();
        super.destroy();
    }

    /**
     * Whether a scroll of `scrolled` moves the blocks but not the placed handle: it holds the
     * editable, but not the element that the handle is positioned against.
     */
    private isMovedApartBy(scrolled: EventTarget | null) {
        const { domEditable, containingBlock } = this;
        return scrolled instanceof Node && !!domEditable && !!containingBlock
            && scrolled.contains(domEditable) && !scrolled.contains(containingBlock);
    }

    private scheduleUpdate() {
        if (this.isUpdateScheduled) {
            return;
        }

        this.isUpdateScheduled = true;
        requestAnimationFrame(() => {
            this.isUpdateScheduled = false;
            this.update();
        });
    }

    /** Shows the handle beside the first selected block, or hides it. */
    private update() {
        const buttonView = this.buttonView;
        if (!buttonView?.element || this.isDragging) {
            return;
        }

        const target = this.getTarget();
        if (!target) {
            buttonView.isVisible = false;
            this.updateTargets();
            return;
        }

        const container = this.mount(buttonView.element, target.domEditable);
        // The button must be visible before it can be measured.
        buttonView.isVisible = true;
        const buttonRect = this.placeButton(buttonView, buttonView.element, container, target);

        // A handle that scrolls with its block is clipped with it. Any other one hides when its
        // block scrolls out of the visible part of the editable.
        if (!this.scrollsWith(target.domBlock)) {
            const visibleRect = new Rect(target.domEditable).getVisible();
            const buttonCenter = buttonRect.top + buttonRect.height / 2;
            buttonView.isVisible = !!visibleRect
                && buttonCenter >= visibleRect.top
                && buttonCenter <= visibleRect.bottom;
        }
        this.updateTargets();
    }

    /**
     * Puts the handle's container right after `domEditable`, inside whatever scrolls the blocks,
     * and places the handle again whenever the size of the editable changes, as when an embed
     * renders. Returns the container.
     */
    private mount(buttonElement: HTMLElement, domEditable: HTMLElement) {
        if (!this.container) {
            // The classes of the body collection, which the styles of the editor's UI expect.
            this.container = createElement(document, "div", {
                class: "ck ck-reset_all ck-rounded-corners block-drag-handle-container",
                dir: this.editor.locale.uiLanguageDirection
            }, [ buttonElement ]);
            // A press focuses the handle, and the editor must stay focused for the drag to start.
            this.editor.ui.focusTracker.add(this.container);
        }
        const container = this.container;
        if (container.previousElementSibling === domEditable) {
            return container;
        }

        domEditable.after(container);
        this.domEditable = domEditable;
        this.resizeObserver?.disconnect();
        this.resizeObserver = new ResizeObserver(() => this.scheduleUpdate());
        this.resizeObserver.observe(domEditable);
        return container;
    }

    /** Whether the handle scrolls along with `domBlock`, within its closest scrolling ancestor. */
    private scrollsWith(domBlock: HTMLElement) {
        const scrollable = findClosestScrollableAncestor(domBlock);
        return !!scrollable && !!this.containingBlock && scrollable.contains(this.containingBlock);
    }

    /** Tints the blocks that a drag moves while the pointer is over the visible handle. */
    private updateTargets() {
        const view = this.editor.editing.view;
        // `view.change()` throws during rendering, and the `layoutChanged` after it updates again.
        if (view.isRenderingInProgress) {
            return;
        }

        const isShown = this.isHovered && !this.isDragging && !!this.buttonView?.isVisible;
        const range = isShown ? getDraggedRange(this.editor.model) : null;
        const targets = range ? this.toViewElements(range) : [];
        const previous = this.targets;
        if (targets.length === previous.length
            && targets.every((target, index) => target === previous[index])) {
            return;
        }

        // Set before the change, whose rendering calls `update()` again.
        this.targets = targets;
        view.change((writer) => {
            for (const target of previous) {
                writer.removeClass(TARGET_CLASS, target);
            }
            for (const target of targets) {
                writer.addClass(TARGET_CLASS, target);
            }
        });
    }

    /** The editing view elements of the outermost nodes in `range`. */
    private toViewElements(range: ModelRange) {
        const mapper = this.editor.editing.mapper;
        return Array.from(range.getItems({ shallow: true }))
            .filter((item) => item.is("element"))
            .map((element) => mapper.toViewElement(element))
            .filter((element) => element !== undefined);
    }

    private getTarget(): BlockTarget | null {
        const editor = this.editor;
        const selection = editor.model.document.selection;
        const isEditable = !editor.isReadOnly && editor.model.canEditAt(selection);
        if (!editor.ui.focusTracker.isFocused || !isEditable) {
            return null;
        }

        const block = Array.from(selection.getSelectedBlocks()).at(0);
        const viewBlock = block && editor.editing.mapper.toViewElement(block);
        const domBlock = viewBlock && editor.editing.view.domConverter.mapViewToDom(viewBlock);
        const rootName = selection.getFirstRange()?.root.rootName;
        const domEditable = rootName && editor.ui.getEditableElement(rootName);
        if (!(domBlock instanceof HTMLElement) || !domEditable) {
            return null;
        }

        return { domBlock, domEditable };
    }

    /**
     * Places the handle outside the editable, level with the first line of the block.
     * Same geometry as `BlockToolbar`. Returns the handle's rectangle in the viewport.
     */
    private placeButton(
        buttonView: BlockButtonView,
        buttonElement: HTMLElement,
        container: HTMLElement,
        target: BlockTarget
    ) {
        const { domBlock, domEditable } = target;
        const styles = window.getComputedStyle(domBlock);
        const paddingTop = parseInt(styles.paddingTop, 10);
        const lineHeight = parseInt(styles.lineHeight, 10) || parseInt(styles.fontSize, 10) * 1.2;
        const editableRect = new Rect(domEditable);
        const buttonRect = new Rect(buttonElement);
        const containerRect = new Rect(container);

        const left = this.editor.locale.uiLanguageDirection === "ltr"
            ? editableRect.left - buttonRect.width
            : editableRect.right;
        const top = new Rect(domBlock).top + paddingTop + (lineHeight - buttonRect.height) / 2;
        buttonRect.moveTo(left, top);

        buttonView.top = top - containerRect.top;
        buttonView.left = left - containerRect.left;
        this.containingBlock = container.offsetParent;

        return buttonRect;
    }

    /** Selects the dragged blocks and starts a drag of them in the editing view. */
    private startDrag(domEvent: DragEvent) {
        const editor = this.editor;
        const dragDrop = editor.plugins.get(DragDrop);
        const range = getDraggedRange(editor.model);
        if (!dragDrop.isEnabled || !range) {
            domEvent.preventDefault();
            return;
        }

        // The drag takes the pointer off the handle.
        this.isHovered = false;
        this.updateTargets();
        editor.model.change((writer) => writer.setSelection(range));

        this.isDragging = true;
        editor.editing.view.focus();
        editor.editing.view.getObserver(ClipboardObserver)?.onDomEvent(domEvent);
        setDraggedRange(dragDrop, range);
    }

    /**
     * Passes a `dragover` or `drop` around the blocks to the editing view, 100px into the content
     * from the pointer and within the editable: over an element that holds the editable, or
     * anywhere in its scrolling container, where a drop above or below the blocks lands at their
     * start or end. The editing view takes a drop over the content itself. Anywhere else, the
     * editing view gets a `dragleave`, which removes the drop marker.
     */
    private forwardDrag(domEvent: DragEvent) {
        const domEditable = this.editor.ui.getEditableElement();
        const pointedNode = domEvent.target;
        if (!this.isDragging || !domEditable || !(pointedNode instanceof Node)
            || (pointedNode !== domEditable && domEditable.contains(pointedNode))) {
            return;
        }

        const isLtr = this.editor.locale.contentLanguageDirection === "ltr";
        const editableRect = domEditable.getBoundingClientRect();
        const clientX = clamp(
            domEvent.clientX + (isLtr ? 100 : -100),
            editableRect.left + 1,
            editableRect.right - 1
        );
        // Without a scrolling ancestor, the closest one is the body, which holds the other panes.
        const scrollable = findClosestScrollableAncestor(domEditable);
        const isInScrollable = !!scrollable && scrollable !== document.body
            && scrollable.contains(pointedNode);
        const clientY = isInScrollable
            ? clamp(domEvent.clientY, editableRect.top + 1, editableRect.bottom - 1)
            : domEvent.clientY;
        const target = isInScrollable || pointedNode.contains(domEditable)
            ? document.elementFromPoint(clientX, clientY)
            : null;
        const isBesideBlocks = !!target && domEditable.contains(target);

        const forwardedEvent = {
            type: isBesideBlocks ? domEvent.type : "dragleave",
            dataTransfer: domEvent.dataTransfer,
            target: isBesideBlocks ? target : domEditable,
            clientX,
            clientY,
            preventDefault: () => domEvent.preventDefault(),
            stopPropagation: () => domEvent.stopPropagation()
        } as unknown as DragEvent;
        this.editor.editing.view.getObserver(ClipboardObserver)?.onDomEvent(forwardedEvent);
    }

    /**
     * Passes the `dragend` of a drag from the handle to the editing view, which does not get it
     * because the handle is outside the editable. `DragDrop` ends the drag on it: it removes the
     * drop marker, and deletes the dragged blocks when a drop outside this editor moved them.
     */
    private endDrag(domEvent: DragEvent) {
        if (this.isDragging) {
            this.isDragging = false;
            this.editor.editing.view.getObserver(ClipboardObserver)?.onDomEvent(domEvent);
        }

        this.update();
    }

}

interface BlockTarget {
    domBlock: HTMLElement;
    domEditable: HTMLElement;
}

function clamp(value: number, min: number, max: number) {
    return Math.min(Math.max(value, min), max);
}

/**
 * The range that the handle drags: the selected blocks, widened over the limit elements and the
 * containers that they cover whole.
 */
function getDraggedRange(model: Model) {
    const blocks = Array.from(model.document.selection.getSelectedBlocks(), getDraggedBlock);
    const firstBlock = blocks.at(0);
    // The outermost block that holds the last one, so that a collapsible moves whole even when
    // the selection ends in its body.
    const lastAncestors = blocks.at(-1)?.getAncestors({ includeSelf: true });
    const lastBlock = blocks.find((block) => lastAncestors?.includes(block));
    if (!firstBlock || !lastBlock) {
        return null;
    }

    const range = model.createRange(
        model.createPositionBefore(firstBlock),
        model.createPositionAfter(lastBlock)
    );
    return widenToWholeContainers(model, widenToCommonLimit(model, range));
}

/** The block that the handle drags for `block`: the whole collapsible for its title. */
function getDraggedBlock(block: ModelElement) {
    return block.is("element", "summary") ? block.parent as ModelElement : block;
}

/**
 * Widens each end of `range` that is in a different limit element than the other end, such as
 * another table cell, over its outermost limit element. The selection post-fixer does the same.
 */
function widenToCommonLimit(model: Model, range: ModelRange) {
    const schema = model.schema;
    const startLimit = schema.getLimitElement(range.start);
    const endLimit = schema.getLimitElement(range.end);
    if (startLimit === endLimit) {
        return range;
    }

    return model.createRange(
        startLimit.is("rootElement")
            ? range.start
            : model.createPositionBefore(getOutermostLimit(schema, startLimit)),
        endLimit.is("rootElement")
            ? range.end
            : model.createPositionAfter(getOutermostLimit(schema, endLimit))
    );
}

/** The outermost limit element below the root that contains `element`, such as its table. */
function getOutermostLimit(schema: ModelSchema, element: ModelElement) {
    let outermost = element;
    let parent = element.parent;
    while (parent?.is("element") && !parent.is("rootElement") && schema.isLimit(parent)) {
        outermost = parent;
        parent = parent.parent;
    }

    return outermost;
}

/**
 * Widens `range` over each container whose content it covers whole, such as an admonition or a
 * block quote, so that the drag moves the container instead of leaving it empty. Stops at limit
 * elements, such as table cells and the root.
 */
function widenToWholeContainers(model: Model, range: ModelRange) {
    for (;;) {
        const { start, end } = range;
        const container = [ start.parent, end.parent ].find((parent): parent is ModelElement => (
            parent.is("element")
            && !model.schema.isLimit(parent)
            && range.containsRange(model.createRangeIn(parent), true)
        ));
        if (!container) {
            return range;
        }

        range = model.createRange(
            start.parent === container ? model.createPositionBefore(container) : start,
            end.parent === container ? model.createPositionAfter(container) : end
        );
    }
}

/**
 * Makes the drag that `dragDrop` started move `range`, which can span several containers.
 * `DragDrop` widens the selection only to a parent that holds both of its ends.
 */
function setDraggedRange(dragDrop: DragDrop, range: ModelRange) {
    const state = dragDrop as unknown as { _draggedRange: ModelLiveRange | null };
    state._draggedRange?.detach();
    state._draggedRange = ModelLiveRange.fromRange(range);
}

declare module "ckeditor5" {
    interface PluginsMap {
        [BlockDragHandle.pluginName]: BlockDragHandle;
    }
}
