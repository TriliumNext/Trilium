import {
    BalloonPanelView,
    ButtonView,
    ContextualBalloon,
    DomEventObserver,
    Plugin,
    ToolbarSeparatorView,
    ToolbarView,
    View,
    clickOutsideHandler,
    type ModelElement,
    type ViewElement
} from "ckeditor5";
import { getActiveTaskStates, getConfiguredTaskStates, TASK_STATE_ATTRIBUTE } from "./todo_list_multistate_editing.js";
import TodoListMultistateUI from "./todo_list_multistate_ui.js";

class TodoCheckboxContextMenuObserver extends DomEventObserver<"contextmenu"> {
    get domEventType() {
        return "contextmenu" as const;
    }
    onDomEvent(domEvent: MouseEvent) {
        this.fire("contextmenu", domEvent);
    }
}

export default class TodoListMultistateToolbar extends Plugin {

    static get requires() {
        return [ContextualBalloon, TodoListMultistateUI] as const;
    }

    private _balloon!: ContextualBalloon;
    private _toolbarView!: ToolbarView;
    private _targetItemId: string | null = null;
    private _unknownStateItems: View[] = [];

    init() {
        const editor = this.editor;
        this._balloon = editor.plugins.get(ContextualBalloon);
        editor.editing.view.addObserver(TodoCheckboxContextMenuObserver);
        this._toolbarView = this._createToolbarView();

        this.listenTo(editor.editing.view.document, "contextmenu", (_evt, data) => {
            const target = (data as {target?: unknown}).target;
            if (!isTodoCheckbox(target)) {
                return;
            }
            (data as {domEvent: MouseEvent}).domEvent.preventDefault();
            this._show(target);
        });

        clickOutsideHandler({
            emitter: this._toolbarView,
            contextElements: () => (this._balloon.view.element ? [this._balloon.view.element] : []),
            callback: () => this._hide(),
            activator: () => this._isVisible()
        });

        this.listenTo(editor.model.document.selection, "change:range", () => {
            if (!this._isVisible()) {
                return;
            }
            const block = editor.model.document.selection.getFirstPosition()?.parent;
            const currentId = block && (block as ModelElement).is?.("element") ? (block as ModelElement).getAttribute("listItemId") : null;
            if (currentId !== this._targetItemId) {
                this._hide();
            }
        });
    }

    override destroy() {
        this._toolbarView?.destroy();
        super.destroy();
    }

    private _createToolbarView(): ToolbarView {
        const editor = this.editor;
        const toolbar = new ToolbarView(editor.locale);
        toolbar.class = "task-state-toolbar";
        for (const state of getActiveTaskStates(editor)) {
            toolbar.items.add(editor.ui.componentFactory.create(`taskState:${state.name}`));
        }
        toolbar.items.add(new ToolbarSeparatorView(editor.locale));
        toolbar.items.add(this._createEditButton());
        return toolbar;
    }

    private _translate(key: string): string {
        const translate = this.editor.config.get("translate") as ((key: string) => string) | undefined;
        return translate ? translate(key) : key;
    }

    private _createEditButton(): ButtonView {
        const editor = this.editor;
        const button = new ButtonView(editor.locale);

        button.set({
            label: this._translate("text-editor.edit-states-tooltip"),
            withText: false,
            tooltip: true,
            class: "ck-task-state-edit bx bx-pencil"
        });
        button.on("execute", () => {
            this._hide();
            const editTaskStates = editor.config.get("editTaskStates") as (() => void) | undefined;
            editTaskStates?.();
        });
        return button;
    }

    private _show(checkbox: ViewElement) {
        const editor = this.editor;
        const wrapper = checkbox.parent;
        if (!wrapper || !wrapper.is("element")) {
            return;
        }
        const anchorDom = editor.editing.view.domConverter.viewToDom(wrapper) as HTMLElement | null;
        if (!anchorDom) {
            return;
        }

        const block = this._findTodoBlock(checkbox);
        if (!block) {
            return;
        }
        this._targetItemId = (block.getAttribute("listItemId") as string | undefined) ?? null;
        editor.model.change((writer) => {
            writer.setSelection(writer.createPositionAt(block, 0));
        });

        const knownStateNames = new Set(getConfiguredTaskStates(editor).map((state) => state.name));
        const taskState = block.getAttribute(TASK_STATE_ATTRIBUTE);
        this._updateUnknownStateLabel(
            typeof taskState === "string" && taskState !== "" && !knownStateNames.has(taskState)
                ? taskState
                : null
        );

        const position = {
            target: anchorDom,
            positions: [
                BalloonPanelView.defaultPositions.northArrowSouth,
                BalloonPanelView.defaultPositions.southArrowNorth
            ]
        };

        if (this._isVisible()) {
            this._balloon.updatePosition(position);
        } else {
            this._balloon.add({
                view: this._toolbarView,
                position,
                balloonClassName: "ck-toolbar-container task-state-toolbar"
            });
        }
    }

    private _findTodoBlock(checkbox: ViewElement): ModelElement | null {
        const editor = this.editor;
        const li = checkbox.findAncestor("li");
        if (!li) {
            return null;
        }
        const domLi = editor.editing.view.domConverter.viewToDom(li) as HTMLElement | null;
        const itemId = domLi?.getAttribute("data-list-item-id");
        if (!itemId) {
            return null;
        }
        const root = editor.model.document.getRoot();
        if (!root) {
            return null;
        }
        for (const item of editor.model.createRangeIn(root).getItems()) {
            if (item.is("element")
                && item.getAttribute("listItemId") === itemId
                && item.getAttribute("listType") === "todo") {
                return item as ModelElement;
            }
        }
        return null;
    }

    /**
     * Appends (or clears) a "Unknown state: …" label at the end of the toolbar
     * when the current todo item carries a state that is not configured.
     */
    private _updateUnknownStateLabel(stateName: string | null) {
        for (const item of this._unknownStateItems) {
            if (this._toolbarView.items.has(item)) {
                this._toolbarView.items.remove(item);
            }
            item.destroy();
        }
        this._unknownStateItems = [];

        if (!stateName) {
            return;
        }

        const locale = this.editor.locale;
        const separator = new ToolbarSeparatorView(locale);
        const label = new View(locale);
        label.setTemplate({
            tag: "span",
            attributes: {
                class: "ck tn-task-state-unknown"
            },
            children: [
                { text: `${this._translate("text-editor.unknown-task-state")}: ` },
                {
                    tag: "span",
                    attributes: {
                        class: "tn-task-state-unknown-name ck-reset_all-excluded"
                    },
                    children: [
                        { text: stateName }
                    ]
                }
            ]
        });

        this._toolbarView.items.add(separator);
        this._toolbarView.items.add(label);
        this._unknownStateItems = [separator, label];
    }

    private _hide() {
        if (this._isVisible()) {
            this._balloon.remove(this._toolbarView);
        }
        this._targetItemId = null;
    }

    private _isVisible(): boolean {
        return this._balloon.hasView(this._toolbarView);
    }

}

function isTodoCheckbox(el: unknown): el is ViewElement {
    if (!el || typeof (el as ViewElement).is !== "function") {
        return false;
    }
    const v = el as ViewElement;
    if (!v.is("element", "input")) {
        return false;
    }
    if (v.getAttribute("type") !== "checkbox") {
        return false;
    }
    return !!v.findAncestor({classes: "todo-list__label"});
}
