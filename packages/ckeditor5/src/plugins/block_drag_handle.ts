import {
    BlockButtonView, ClipboardObserver, DomEmitterMixin, DragDrop, env, IconDragIndicator,
    type Model, type ModelElement, ModelLiveRange, type ModelRange, Plugin, Rect
} from "ckeditor5";

/**
 * The drag handle of `BlockToolbar` without the toolbar, for the fixed-toolbar editor: a grip
 * beside the block at the selection that drags the selected blocks to another place in the note.
 * The drag follows `DragDropBlockToolbar`, which only works with `BlockToolbar` itself.
 */
export default class BlockDragHandle extends Plugin {

    buttonView?: BlockButtonView;
    private isDragging = false;
    private isUpdateScheduled = false;
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
            attributes: { draggable: "true" },
            on: {
                dragstart: buttonView.bindTemplate.to((domEvent) => {
                    this.startDrag(domEvent as DragEvent);
                })
            }
        });
        buttonView.on("execute", () => editor.editing.view.focus());
        editor.ui.view.body.add(buttonView);
        this.buttonView = buttonView;

        this.listenTo(editor.ui, "update", () => this.update());
        this.listenTo(editor, "change:isReadOnly", () => this.update(), { priority: "low" });
        this.listenTo(editor.ui.focusTracker, "change:isFocused", () => this.update());

        this.domEmitter.listenTo(window, "resize", () => this.scheduleUpdate());
        this.domEmitter.listenTo(document, "scroll", () => this.scheduleUpdate(), {
            useCapture: true,
            usePassive: true
        });

        this.domEmitter.listenTo(document, "dragover", (_evt, domEvent: DragEvent) => {
            this.forwardDrag(domEvent);
        });
        this.domEmitter.listenTo(document, "drop", (_evt, domEvent: DragEvent) => {
            this.forwardDrag(domEvent);
        });
        this.domEmitter.listenTo(document, "dragend", () => {
            this.isDragging = false;
            this.update();
        }, { useCapture: true });
    }

    override destroy() {
        this.domEmitter.stopListening();
        this.buttonView?.destroy();
        super.destroy();
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
            return;
        }

        // The button must be visible before it can be measured.
        buttonView.isVisible = true;
        const buttonRect = this.placeButton(buttonView, buttonView.element, target);

        // Hide the handle when its block scrolls out of the visible part of the editable.
        const visibleRect = new Rect(target.domEditable).getVisible();
        const buttonCenter = buttonRect.top + buttonRect.height / 2;
        buttonView.isVisible = !!visibleRect
            && buttonCenter >= visibleRect.top
            && buttonCenter <= visibleRect.bottom;
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
        target: BlockTarget
    ) {
        const { domBlock, domEditable } = target;
        const styles = window.getComputedStyle(domBlock);
        const paddingTop = parseInt(styles.paddingTop, 10);
        const lineHeight = parseInt(styles.lineHeight, 10) || parseInt(styles.fontSize, 10) * 1.2;
        const editableRect = new Rect(domEditable);
        const buttonRect = new Rect(buttonElement);

        const left = this.editor.locale.uiLanguageDirection === "ltr"
            ? editableRect.left - buttonRect.width
            : editableRect.right;
        const top = new Rect(domBlock).top + paddingTop + (lineHeight - buttonRect.height) / 2;
        buttonRect.moveTo(left, top);

        const absoluteRect = buttonRect.toAbsoluteRect();
        buttonView.top = absoluteRect.top;
        buttonView.left = absoluteRect.left;

        return buttonRect;
    }

    /** Selects the whole selected blocks and starts a drag of them in the editing view. */
    private startDrag(domEvent: DragEvent) {
        const editor = this.editor;
        const model = editor.model;
        const dragDrop = editor.plugins.get(DragDrop);
        const blocks = Array.from(model.document.selection.getSelectedBlocks(), getDraggedBlock);
        const firstBlock = blocks.at(0);
        // The outermost block that holds the last one, so that a collapsible moves whole even when
        // the selection ends in its body.
        const lastAncestors = blocks.at(-1)?.getAncestors({ includeSelf: true });
        const lastBlock = blocks.find((block) => lastAncestors?.includes(block));
        if (!dragDrop.isEnabled || !firstBlock || !lastBlock) {
            domEvent.preventDefault();
            return;
        }

        const range = widenToWholeContainers(model, model.createRange(
            model.createPositionBefore(firstBlock),
            model.createPositionAfter(lastBlock)
        ));
        model.change((writer) => writer.setSelection(range));

        this.isDragging = true;
        editor.editing.view.focus();
        editor.editing.view.getObserver(ClipboardObserver)?.onDomEvent(domEvent);
        setDraggedRange(dragDrop, range);
    }

    /**
     * Passes a `dragover` or `drop` in the margin beside the blocks, over an element that holds
     * the editable, to the editing view: 100px into the content from the pointer and within the
     * editable. The editing view takes a drop over the content itself, and another pane its own.
     */
    private forwardDrag(domEvent: DragEvent) {
        const domEditable = this.editor.ui.getEditableElement();
        const pointedNode = domEvent.target;
        if (!this.isDragging || !domEditable || !(pointedNode instanceof Node)
            || !pointedNode.contains(domEditable)) {
            return;
        }

        const isLtr = this.editor.locale.contentLanguageDirection === "ltr";
        const editableRect = domEditable.getBoundingClientRect();
        const clientX = Math.min(
            Math.max(domEvent.clientX + (isLtr ? 100 : -100), editableRect.left + 1),
            editableRect.right - 1
        );
        const clientY = domEvent.clientY;
        const target = document.elementFromPoint(clientX, clientY);
        if (!target || !domEditable.contains(target)) {
            return;
        }

        const forwardedEvent = {
            type: domEvent.type,
            dataTransfer: domEvent.dataTransfer,
            target,
            clientX,
            clientY,
            preventDefault: () => domEvent.preventDefault(),
            stopPropagation: () => domEvent.stopPropagation()
        } as unknown as DragEvent;
        this.editor.editing.view.getObserver(ClipboardObserver)?.onDomEvent(forwardedEvent);
    }
}

interface BlockTarget {
    domBlock: HTMLElement;
    domEditable: HTMLElement;
}

/** The block that the handle drags for `block`: the whole collapsible for its title. */
function getDraggedBlock(block: ModelElement) {
    return block.is("element", "summary") ? block.parent as ModelElement : block;
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
