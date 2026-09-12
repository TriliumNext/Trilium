import { DEFAULT_TASK_STATES, DONE_STATE_NAME, isAnchorState, NONE_STATE_NAME, type TaskStateDef } from "@triliumnext/commons";
import { Command, ListEditing, Plugin, TodoList, type Editor, type EventInfo, type ModelElement, type UpcastConversionApi, type UpcastConversionData, type UpcastElementEvent, type ViewElement } from "ckeditor5";

import { onTodoRowSplit } from "../todo_list_uncheck_on_enter.js";
import { ContentHintManager, type HintHandle } from "../../content_hint_manager.js";
import { renderShortcut } from "../../shortcut.js";

/**
 * Dwell delay before hovering a checkbox pops its tooltip.
 * Long enough that brief flyovers don't spawn a tooltip, short enough that
 * intentional attention consistently produces one.
 */
const TOOLTIP_DWELL_MS = 200;

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

    /** Shared content-hint stack, with one hover handle per rendered checkbox. */
    private _hintManager?: ContentHintManager;

    /** Hover-driven handle per rendered checkbox. Disposed when the checkbox detaches. */
    private readonly _hoverHandles = new Map<HTMLInputElement, HintHandle>();

    /** Last known task state per rendered checkbox, used to refresh hover content. */
    private readonly _knownState = new Map<HTMLInputElement, string | null>();

    /** State-name → definition, keyed for `buildTooltipTitle` calls. */
    private _stateByName!: Map<string, TaskStateDef>;

    init() {
        const editor = this.editor;
        const states = getConfiguredTaskStates(editor);
        this._stateByName = new Map(states.map((state) => [state.name, state]));
        const stateByName = this._stateByName;
        // Global user preference: skip all content-hint wiring when off. The
        // rest of `init()` (schema, keystroke, downcast/upcast, post-fixer)
        // stays intact — hints are additive UX, not a load-bearing feature.
        // Missing config (external CKEditor consumers, tests) → hints on.
        const hintsEnabled = editor.config.get("contentHintsEnabled") !== false;
        if (hintsEnabled) {
            this._hintManager = new ContentHintManager({
                tooltipOptions: {
                    // Bootstrap's default sanitizer strips `data-*` attributes, which
                    // the state-icon span in the tooltip relies on to render the
                    // correct colour/glyph.
                    sanitize: false,
                    customClass: "text-editor-content-tooltip"
                },
                // Self-dismiss the tooltip after the last relevant hover event.
                autoHideAfterMs: 2000
            });
        }

        editor.model.schema.extend("$block", {allowAttributes: TASK_STATE_ATTRIBUTE});

        editor.commands.add("setTaskState", new SetTaskStateCommand(editor));

        editor.keystrokes.set(STATE_CYCLE_SHORTCUT, (_data, cancel) => {
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

                // Data pipeline only: emit a native `title` tooltip so viewers of
                // the shared page, the read-only preview, and exported HTML see
                // the state's human name when they hover the task item. Skipped
                // for anchor states (`none`/`done` — no explanation needed) and
                // for unknown states (no definition to name). We intentionally
                // do NOT set `title` in the editing pipeline: CKEditor's own
                // hover would then race the plugin's Bootstrap tooltip.
                const stateDef = typeof value === "string" && !isAnchorState(value)
                    ? stateByName.get(value)
                    : undefined;
                const title = stateDef?.title || stateDef?.name;
                if (title && options?.dataPipeline) {
                    writer.setAttribute("title", title, element);
                } else {
                    writer.removeAttribute("title", element);
                }
            }
        });

        // The state is stored on the `<li>` but upcast from that item's checkbox; see
        // {@link upcastTaskState} for why the obvious `attributeToAttribute` on the `<li>`
        // is wrong. Registered at "low" so upstream's `todoItemInputConverter` has already
        // marked the block as a todo item.
        editor.conversion.for("upcast").add((dispatcher) => {
            dispatcher.on<UpcastElementEvent>("element:input", upcastTaskState, {priority: "low"});
        });

        if (hintsEnabled) {
            this.listenTo(editor.editing.view, "render", () => {
                const domRoot = editor.editing.view.getDomRoot();
                if (!domRoot) {
                    return;
                }
                this._refreshHoverHandles(domRoot);
            });
        }

        // A new row split off with Enter inherits the previous row's `taskState` (writer.split
        // copies block attributes). Drop it so each new task starts in the plain "none" state.
        // Without this, `TodoListUncheckOnEnter` clears the new row's checkbox but the inherited
        // `taskState` survives, leaving an inconsistent row (e.g. a completed "review" state with
        // an unchecked box) and carrying #10084 over to custom states. The post-fixer below can't
        // catch it: it reacts to taskState *changes*, but on a split the attribute arrives as part
        // of the inserted node, not as a diff. `TodoListUncheckOnEnter` clears the companion
        // `todoListChecked` via the same seam.
        onTodoRowSplit(this, (writer, block) => {
            writer.removeAttribute(TASK_STATE_ATTRIBUTE, block);
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
        for (const handle of this._hoverHandles.values()) {
            handle.dispose();
        }
        this._hoverHandles.clear();
        this._knownState.clear();
        this._hintManager?.destroy();
        super.destroy();
    }

    /**
     * Reconcile hover handles with the current set of rendered checkboxes.
     * Creates a handle + attaches mouseenter/mouseleave for each new checkbox,
     * disposes handles whose input was detached, and refreshes content on
     * inputs whose task state changed since the last render.
     */
    private _refreshHoverHandles(domRoot: HTMLElement): void {
        const manager = this._hintManager;
        // The two callers that reach this method are gated on `hintsEnabled`
        // in `init()`, so `_hintManager` is set here in practice. The guard
        // keeps TypeScript happy and documents the contract.
        /* v8 ignore next 3 */
        if (!manager) {
            return;
        }
        // Reap detached checkboxes.
        for (const input of Array.from(this._hoverHandles.keys())) {
            if (!input.isConnected) {
                this._hoverHandles.get(input)?.dispose();
                this._hoverHandles.delete(input);
                this._knownState.delete(input);
            }
        }

        for (const input of domRoot.querySelectorAll<HTMLInputElement>(".todo-list__label input[type=\"checkbox\"]")) {
            const currentState = readTaskState(input);
            const previousState = this._knownState.get(input);
            const isNew = !this._hoverHandles.has(input);
            this._knownState.set(input, currentState);

            if (isNew) {
                const handle = manager.createHandle(input, this._computeContent(input));
                this._hoverHandles.set(input, handle);
                input.addEventListener("mouseenter", () => {
                    handle.showAfter(TOOLTIP_DWELL_MS);
                });
                input.addEventListener("mouseleave", () => {
                    handle.hide();
                });
            /* v8 ignore start -- taskState is scope:"item", so any state change
               triggers a full item reconvert and gives us a fresh `<input>`. The
               old input is reaped by the disconnected loop above before we get
               here, so this branch is defensive: it would only fire if CKEditor
               ever stopped reconverting on scope:"item" attribute changes. */
            } else if (currentState !== previousState) {
                this._hoverHandles.get(input)?.setContent(this._computeContent(input));
            }
            /* v8 ignore stop */
        }
    }

    /** Assemble the tooltip HTML for the given checkbox's current state. */
    private _computeContent(input: HTMLInputElement): string {
        return buildTooltipTitle(
            input.ownerDocument,
            readTaskState(input),
            this._stateByName,
            this.editor.t,
            renderShortcut(this.editor, STATE_CYCLE_SHORTCUT)
        );
    }

}

/**
 * Upcast `data-trilium-task-state` onto the model block of the todo item that owns the
 * converted checkbox.
 *
 * Anchoring on the checkbox rather than declaring `attributeToAttribute` on the `<li>` is
 * what keeps a state on its own item. That helper applies the model attribute to every
 * top-level node of the `<li>`'s converted range, and the list model is *flat*: a nested
 * item is a sibling block, not a descendant. A parent's range therefore covers its whole
 * subtree, so every nested item without a state of its own inherited the parent's, and
 * because that is a real model attribute, the item-scoped downcast wrote it straight back
 * into the saved content. `modelCursor.parent` at the checkbox is, by construction, the
 * one block that item produced; upstream upcasts `todoListChecked` the same way.
 */
function upcastTaskState(
    _evt: EventInfo,
    data: UpcastConversionData<ViewElement>,
    conversionApi: UpcastConversionApi
): void {
    const block = data.modelCursor.parent;
    // `todoItemInputConverter` runs first and is what marks the block as a todo item.
    if (!block.is("element") || block.getAttribute("listType") !== "todo") {
        return;
    }
    const listItem = findListItemAncestor(data.viewItem);
    /* v8 ignore next 3 -- the block above is a todo item only because upstream made one out of the
       `<li>` this very checkbox sits in, so by here there is always one to find */
    if (!listItem) {
        return;
    }
    const value = listItem.getAttribute("data-trilium-task-state");
    if (typeof value !== "string" || value === "" || isAnchorState(value)) {
        return;
    }
    // Consumed so General HTML Support doesn't also carry it as a raw `<li>` attribute.
    conversionApi.consumable.consume(listItem, {attributes: "data-trilium-task-state"});
    conversionApi.writer.setAttribute(TASK_STATE_ATTRIBUTE, value, block);
}

/** Nearest `<li>` ancestor in the view, mirroring {@link readTaskState}'s DOM walk. */
function findListItemAncestor(viewElement: ViewElement): ViewElement | null {
    let ancestor = viewElement.parent;
    while (ancestor && ancestor.is("element")) {
        if (ancestor.is("element", "li")) {
            return ancestor;
        }
        ancestor = ancestor.parent;
    }
    /* v8 ignore next -- only ever called from a checkbox inside a todo item's own `<li>` */
    return null;
}

/**
 * The task state applied to the todo item that owns the given checkbox. Anchor
 * states (`none`/`done`) never carry a `data-trilium-task-state`, so this
 * returns `null` for them.
 *
 * The lookup must be scoped to the *nearest* <li>, not the nearest <li> that
 * happens to carry the attribute — in nested todo lists the DOM is
 * `<li outer data-trilium-task-state="doing">…<ul><li inner>…</li></ul></li>`,
 * so a filtered `closest("li[data-trilium-task-state]")` on the inner
 * checkbox walks straight past its own (unattributed) <li> and lands on the
 * outer one, wrongly attributing the parent's state to the inner item.
 */
function readTaskState(input: HTMLInputElement): string | null {
    const li = input.closest<HTMLElement>("li");
    return li?.getAttribute("data-trilium-task-state") ?? null;
}

/**
 * Build the checkbox tooltip HTML. The base body (right-click hint + keyboard
 * shortcut) is always present. For a non-anchor state, a "Task state: …" line
 * is prepended. The state-line HTML is assembled here via the DOM API rather
 * than in the translation, so translations stay plain text.
 *  - configured state → the state's own checkbox glyph + bold name;
 *  - unknown state (attribute set but no matching definition) → the raw name
 *    followed by a translated "(missing definition)" note.
 *
 * Exported so specs can verify the assembled HTML directly, without having to
 * introspect Bootstrap Tooltip's private `_config` field.
 *
 * @param t the editor's translation function, for the strings this package owns.
 * @param shortcut the cycle shortcut, already rendered as `<kbd>` markup by
 *                 {@link renderShortcut} — the host renders it, so it arrives as content. Nothing
 *                 escapes it here, and the tooltip opts out of Bootstrap's sanitizer.
 */
export function buildTooltipTitle(
    doc: Document,
    state: string | null,
    stateByName: Map<string, TaskStateDef>,
    t: (message: string, ...values: string[]) => string,
    shortcut: string
): string {
    const body = t("Right-click or press %0 to change state.", shortcut);
    if (!state) {
        return body;
    }
    const stateDef = stateByName.get(state);
    const suffix = stateDef
        ? buildKnownStateSuffixHtml(doc, state, stateDef.title || stateDef.name)
        : buildUnknownStateSuffixHtml(
            doc,
            state,
            t("(missing definition)")
        );
    const label = t("Task state:");
    // The status line is a block-level <div> so it forces a line break before
    // the body and the CSS `margin-bottom: 8px` cleanly separates the two.
    return `<div class="tn-task-tooltip-state">${label} ${suffix}</div>${body}`;
}

/**
 * Storage form of the state-cycle shortcut. Kept in sync with the
 * `editor.keystrokes.set("Ctrl+Shift+Enter", …)` binding at the top of
 * {@link TodoListMultistateEditing#init} — this string is the source of truth
 * both places share, so a rebinding in one has to be mirrored in the other.
 */
const STATE_CYCLE_SHORTCUT = "Ctrl+Shift+Enter";

/**
 * "<mini-checkbox> <strong>Name</strong>" — the icon and name flow inline
 * after the "Task state:" label. Built via the DOM API so the state name
 * is text-escaped by the browser rather than by hand.
 */
function buildKnownStateSuffixHtml(doc: Document, state: string, name: string): string {
    const strong = doc.createElement("strong");
    strong.textContent = name;
    return `${buildStateIconElement(doc, state).outerHTML} ${strong.outerHTML}`;
}

/** "wontdo (missing definition)" — text-escaped via textContent. */
function buildUnknownStateSuffixHtml(doc: Document, state: string, missingSuffix: string): string {
    const span = doc.createElement("span");
    span.textContent = `${state} ${missingSuffix}`;
    return span.outerHTML;
}

/**
 * A miniature checkbox glyph the tooltip can inline. `.tn-task-checkbox` provides
 * the box + glyph rendering but needs an inline-block context (the class itself
 * carries only width/height/position). The `.tn-task-checkbox-inline` wrapper
 * gives it that slot so it renders correctly inside a text tooltip.
 */
function buildStateIconElement(doc: Document, state: string): HTMLSpanElement {
    const wrapper = doc.createElement("span");
    wrapper.className = "tn-task-checkbox-inline";
    const inner = doc.createElement("span");
    inner.className = "tn-task-checkbox";
    inner.setAttribute("data-trilium-task-state", state);
    wrapper.appendChild(inner);
    return wrapper;
}

class SetTaskStateCommand extends Command {

    declare public value: string | null;

    constructor(editor: Editor) {
        super(editor);
        // Refresh before executing so a call made inside the same change block — e.g. the
        // autoformat callback that runs `todoList` and then `setTaskState` back to back —
        // sees the freshly-converted todo item rather than the stale pre-change `isEnabled`
        // (a disabled command's `execute` is a no-op). Mirrors upstream `CheckTodoListCommand`.
        this.on("execute", () => this.refresh(), { priority: "highest" });
    }

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
