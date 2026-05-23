import { DEFAULT_TASK_STATES, DONE_STATE_NAME, isAnchorState, NONE_STATE_NAME, type TaskStateDef } from "@triliumnext/commons";
import { Tooltip } from "bootstrap";
import { Command, getEnvKeystrokeText, ListEditing, Plugin, TodoList, type Editor, type ModelElement, type ViewElement } from "ckeditor5";

export const TASK_STATE_ATTRIBUTE = "taskState";
const TODO_LIST_CHECKED_ATTRIBUTE = "todoListChecked";

/**
 * The ordered task states. Includes the built-in `none`/`done` anchors — those
 * are never written as `data-trilium-task-state`; they map to the native checkbox.
 */
export function getConfiguredTaskStates(editor: Editor): TaskStateDef[] {
    const states = editor.config.get("taskStates") as TaskStateDef[] | undefined;
    return states && states.length ? states : DEFAULT_TASK_STATES;
}

/**
 * The states surfaced in the toolbar and keyboard cycle — configured states
 * minus hidden ones. Hidden states still round-trip and keep their CSS.
 */
export function getActiveTaskStates(editor: Editor): TaskStateDef[] {
    return getConfiguredTaskStates(editor).filter((state) => !state.isHidden);
}

export default class TodoListMultistateEditing extends Plugin {

    static get requires() {
        return [TodoList, ListEditing] as const;
    }

    /** Checkboxes that currently have a tooltip attached, so stale ones can be disposed. */
    private readonly _checkboxTooltips = new Set<HTMLInputElement>();

    init() {
        const editor = this.editor;
        const states = getConfiguredTaskStates(editor);
        const stateByName = new Map(states.map((state) => [state.name, state]));
        const translate = (editor.config.get("translate") as ((key: string, params?: Record<string, unknown>) => string) | undefined)
            ?? ((key: string) => key);

        editor.model.schema.extend("$block", {allowAttributes: TASK_STATE_ATTRIBUTE});

        editor.commands.add("setTaskState", new SetTaskStateCommand(editor));

        editor.keystrokes.set("Ctrl+Shift+Enter", (_data, cancel) => {
            const command = editor.commands.get("setTaskState");
            if (!command?.isEnabled) {
                return;
            }
            const cycle = getActiveTaskStates(editor).map((state) => state.name);
            const current = (command.value as string | null) ?? NONE_STATE_NAME;
            const idx = cycle.indexOf(current);
            const next = cycle[(idx + 1) % cycle.length];
            editor.execute("setTaskState", {state: next});
            cancel();
        });

        const listEditing = editor.plugins.get(ListEditing);
        listEditing.registerDowncastStrategy({
            scope: "item",
            attributeName: TASK_STATE_ATTRIBUTE,
            setAttributeOnDowncast(writer, value, element, options) {
                // Customizable states carry `data-trilium-task-state`; none/done are native.
                // Unrecognized states are preserved so they survive a state-config change.
                if (typeof value === "string" && value !== "" && !isAnchorState(value)) {
                    writer.setAttribute("data-trilium-task-state", value, element);
                } else {
                    writer.removeAttribute("data-trilium-task-state", element);
                }

                // Editing-only class for states missing from the current config. Added on
                // the editing pipeline only, so it is never written into the saved content.
                const isUnknown = typeof value === "string" && value !== ""
                    && !isAnchorState(value) && !stateByName.has(value);
                if (isUnknown && !options?.dataPipeline) {
                    writer.addClass("tn-unknown-task-state", element);
                } else {
                    writer.removeClass("tn-unknown-task-state", element);
                }
            }
        });

        editor.conversion.for("upcast").attributeToAttribute({
            view: {key: "data-trilium-task-state"},
            model: {
                key: TASK_STATE_ATTRIBUTE,
                value: (viewElement: ViewElement) => {
                    const value = viewElement.getAttribute("data-trilium-task-state");
                    return typeof value === "string" && value !== "" && !isAnchorState(value)
                        ? value
                        : null;
                }
            }
        });

        this.listenTo(editor.editing.view, "render", () => {
            const domRoot = editor.editing.view.getDomRoot();
            if (!domRoot) {
                return;
            }
            // CKEditor recreates the checkbox element when a todo item reconverts
            // (e.g. on click); dispose tooltips left on the detached old checkboxes.
            for (const input of this._checkboxTooltips) {
                if (!input.isConnected) {
                    Tooltip.getInstance(input)?.dispose();
                    this._checkboxTooltips.delete(input);
                }
            }
            for (const input of domRoot.querySelectorAll<HTMLInputElement>(".todo-list__label input[type=\"checkbox\"]")) {
                if (!Tooltip.getInstance(input)) {
                    const title = translate("text-editor.checkbox-tooltip", {
                        shortcut: getEnvKeystrokeText("Ctrl+Shift+Enter")
                    });
                    new Tooltip(input, {title, customClass: "text-editor-content-tooltip"});
                    this._checkboxTooltips.add(input);
                }
            }
        });

        editor.model.document.registerPostFixer((writer) => {
            const differ = editor.model.document.differ;
            const stateChanged = new Set<ModelElement>();
            const checkedChanged = new Set<ModelElement>();

            for (const entry of differ.getChanges()) {
                if (entry.type !== "attribute") {
                    continue;
                }
                const node = entry.range.start.nodeAfter;
                if (!node || !node.is("element")) {
                    continue;
                }
                if (node.getAttribute("listType") !== "todo") {
                    continue;
                }
                if (entry.attributeKey === TASK_STATE_ATTRIBUTE) {
                    stateChanged.add(node as ModelElement);
                } else if (entry.attributeKey === TODO_LIST_CHECKED_ATTRIBUTE) {
                    checkedChanged.add(node as ModelElement);
                }
            }

            let changed = false;

            // A customizable state forces the checkbox to its `isCompleted`.
            for (const el of stateChanged) {
                const stateName = el.getAttribute(TASK_STATE_ATTRIBUTE);
                const state = typeof stateName === "string" ? stateByName.get(stateName) : undefined;
                if (!state) {
                    // State cleared — the command already set the native checkbox.
                    continue;
                }
                if (!!el.getAttribute(TODO_LIST_CHECKED_ATTRIBUTE) !== state.isCompleted) {
                    writer.setAttribute(TODO_LIST_CHECKED_ATTRIBUTE, state.isCompleted, el);
                    changed = true;
                }
            }

            // Toggling the native checkbox drops any special state (back to native none/done).
            for (const el of checkedChanged) {
                if (stateChanged.has(el)) {
                    continue;
                }
                if (el.getAttribute(TASK_STATE_ATTRIBUTE) !== undefined) {
                    writer.removeAttribute(TASK_STATE_ATTRIBUTE, el);
                    changed = true;
                }
            }

            return changed;
        });
    }

    override destroy() {
        for (const input of this._checkboxTooltips) {
            Tooltip.getInstance(input)?.dispose();
        }
        this._checkboxTooltips.clear();
        super.destroy();
    }

}

class SetTaskStateCommand extends Command {

    declare public value: string | null;

    refresh() {
        const block = this._getTodoBlock();
        this.isEnabled = !!block;
        if (!block) {
            this.value = null;
            return;
        }
        const stored = block.getAttribute(TASK_STATE_ATTRIBUTE);
        if (typeof stored === "string") {
            this.value = stored;
        } else {
            this.value = block.getAttribute(TODO_LIST_CHECKED_ATTRIBUTE) ? DONE_STATE_NAME : NONE_STATE_NAME;
        }
    }

    execute(options: {state: string | null}) {
        const model = this.editor.model;
        const state = options.state ?? NONE_STATE_NAME;
        model.change((writer) => {
            for (const block of model.document.selection.getSelectedBlocks()) {
                if (block.getAttribute("listType") !== "todo") {
                    continue;
                }
                if (state === NONE_STATE_NAME) {
                    writer.removeAttribute(TASK_STATE_ATTRIBUTE, block);
                    writer.setAttribute(TODO_LIST_CHECKED_ATTRIBUTE, false, block);
                } else if (state === DONE_STATE_NAME) {
                    writer.removeAttribute(TASK_STATE_ATTRIBUTE, block);
                    writer.setAttribute(TODO_LIST_CHECKED_ATTRIBUTE, true, block);
                } else {
                    writer.setAttribute(TASK_STATE_ATTRIBUTE, state, block);
                }
            }
        });
    }

    private _getTodoBlock(): ModelElement | null {
        const position = this.editor.model.document.selection.getFirstPosition();
        const parent = position?.parent;
        if (!parent || !parent.is("element")) {
            return null;
        }
        return parent.getAttribute("listType") === "todo" ? (parent as ModelElement) : null;
    }

}
