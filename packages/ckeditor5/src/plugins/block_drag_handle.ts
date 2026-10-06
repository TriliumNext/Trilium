import {
    BlockButtonView, ClipboardObserver, DomEmitterMixin, DragDrop, env, IconDragIndicator, Plugin,
    Rect
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
        buttonView.on("execute", () => editor.editing.view.focus());
        editor.ui.view.body.add(buttonView);
        this.buttonView = buttonView;

        const element = buttonView.element;
        if (!element) {
            return;
        }
        element.setAttribute("draggable", "true");

        this.listenTo(editor.ui, "update", () => this.update());
        this.listenTo(editor, "change:isReadOnly", () => this.update(), { priority: "low" });
        this.listenTo(editor.ui.focusTracker, "change:isFocused", () => this.update());

        this.domEmitter.listenTo(window, "resize", () => this.scheduleUpdate());
        this.domEmitter.listenTo(document, "scroll", () => this.scheduleUpdate(), {
            useCapture: true,
            usePassive: true
        });

        this.domEmitter.listenTo(element, "dragstart", (_evt, domEvent: DragEvent) => {
            this.startDrag(domEvent);
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
        const blocks = Array.from(model.document.selection.getSelectedBlocks());
        const firstBlock = blocks.at(0);
        const lastBlock = blocks.at(-1);
        if (editor.isReadOnly || !firstBlock || !lastBlock) {
            domEvent.preventDefault();
            return;
        }

        const range = model.createRange(
            model.createPositionBefore(firstBlock),
            model.createPositionAfter(lastBlock)
        );
        model.change((writer) => writer.setSelection(range));

        this.isDragging = true;
        editor.editing.view.focus();
        editor.editing.view.getObserver(ClipboardObserver)?.onDomEvent(domEvent);
    }

    /**
     * Passes a `dragover` or `drop` to the editing view, 100px into the content from the pointer,
     * so the pointer can stay in the margin beside the blocks.
     */
    private forwardDrag(domEvent: DragEvent) {
        if (!this.isDragging) {
            return;
        }

        const isLtr = this.editor.locale.contentLanguageDirection === "ltr";
        const clientX = domEvent.clientX + (isLtr ? 100 : -100);
        const clientY = domEvent.clientY;
        const target = document.elementFromPoint(clientX, clientY);
        const domEditable = this.editor.ui.getEditableElement();
        if (!target || !domEditable?.contains(target)) {
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

declare module "ckeditor5" {
    interface PluginsMap {
        [BlockDragHandle.pluginName]: BlockDragHandle;
    }
}
