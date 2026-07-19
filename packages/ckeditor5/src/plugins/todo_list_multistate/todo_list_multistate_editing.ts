import { DEFAULT_TASK_STATES, DONE_STATE_NAME, formatShortcut, isAnchorState, joinShortcut, NONE_STATE_NAME, type TaskStateDef } from "@triliumnext/commons";
import { Command, env, ListEditing, Plugin, TodoList, type Editor, type ModelElement, type ViewElement } from "ckeditor5";

import { onTodoRowSplit } from "../todo_list_uncheck_on_enter.js";
import { ContentHintManager, type HintHandle } from "@triliumnext/ckeditor5-utils";

/**
 * Dwell delay before a hover or a stationary caret pops the checkbox tooltip.
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

    /**
     * Shared content-hint stack. One hover handle per rendered checkbox plus
     * one caret handle (moved between checkboxes as the caret does) push/pop
     * against it — only the top of the stack is on screen at a time. See
     * {@link ContentHintManager} for the rationale.
     */
    private _hintManager?: ContentHintManager;

    /** Hover-driven handle per rendered checkbox. Disposed when the checkbox detaches. */
    private readonly _hoverHandles = new Map<HTMLInputElement, HintHandle>();

    /**
     * Last known task state per rendered checkbox — used to detect content-changing
     * events (Ctrl+Shift+Enter, native toggle) so the caret handle can force an
     * immediate `show()` instead of a delayed one.
     */
    private readonly _knownState = new Map<HTMLInputElement, string | null>();

    /** Caret-driven handle, if the caret is currently inside a todo item. */
    private _caretHandle: HintHandle | null = null;

    /** DOM checkbox the caret handle is currently attached to. */
    private _caretInput: HTMLInputElement | null = null;

    /**
     * `data-list-item-id` of the todo item the caret is currently inside, or
     * `null` when the caret isn't inside a todo item. Tracks the *conceptual*
     * caret target so a mere DOM-node rebuild (Ctrl+Shift+Enter across the
     * isCompleted boundary recreates the checkbox input) doesn't get treated
     * as a fresh visit and delayed by the dwell timer.
     */
    private _caretItemId: string | null = null;

    /** State-name → definition, keyed for `buildTooltipTitle` calls. */
    private _stateByName!: Map<string, TaskStateDef>;

    /** Translate function resolved once from editor config; identity fallback. */
    private _translate!: TranslateFn;

    init() {
        const editor = this.editor;
        const states = getConfiguredTaskStates(editor);
        this._stateByName = new Map(states.map((state) => [state.name, state]));
        this._translate = (editor.config.get("translate") as TranslateFn | undefined)
            ?? ((key: string) => key);
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
                // Self-dismiss the tooltip 1s after the last relevant event (push,
                // content update, top change). Anything that would legitimately
                // keep the hint alive — hover crossing, caret movement, state
                // change — pushes to the manager, so the timer resets and the
                // popup stays. When events stop, it fades on its own.
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

        if (hintsEnabled) {
            this.listenTo(editor.editing.view, "render", () => {
                const domRoot = editor.editing.view.getDomRoot();
                if (!domRoot) {
                    return;
                }
                // Refresh handles first; the return value tells `_syncCaretTooltip`
                // whether the caret's item changed state on this render (Ctrl+Shift+Enter,
                // native toggle, etc.) so it can force an immediate `show()` instead
                // of waiting out the dwell timer again.
                const caretItemStateChanged = this._refreshHoverHandles(domRoot);
                this._syncCaretTooltip({ forceShowIfSameTarget: caretItemStateChanged });
            });

            // Keyboard-only navigation into an <li> doesn't move DOM focus (the editable
            // root keeps it), so the manager needs to be driven from model-selection
            // changes to catch the keyboard-into-todo case.
            this.listenTo(editor.model.document.selection, "change:range", () => {
                this._syncCaretTooltip({ forceShowIfSameTarget: false });
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
        this._caretHandle?.dispose();
        this._caretHandle = null;
        this._caretInput = null;
        this._caretItemId = null;
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
     *
     * Returns `true` iff the caret's own checkbox saw a state change on this
     * render — the caller uses that to force `show()` its caret handle instead
     * of waiting out the dwell timer (state change should reveal the tooltip
     * immediately, per the "reappear on state change" spec).
     */
    private _refreshHoverHandles(domRoot: HTMLElement): boolean {
        const manager = this._hintManager;
        // The two callers that reach this method are gated on `hintsEnabled`
        // in `init()`, so `_hintManager` is set here in practice. The guard
        // keeps TypeScript happy and documents the contract.
        /* v8 ignore next 3 */
        if (!manager) {
            return false;
        }
        // Reap detached checkboxes.
        for (const input of Array.from(this._hoverHandles.keys())) {
            if (!input.isConnected) {
                this._hoverHandles.get(input)?.dispose();
                this._hoverHandles.delete(input);
                this._knownState.delete(input);
                if (input === this._caretInput) {
                    // Caret handle for a detached input; drop it — `_syncCaretTooltip`
                    // will pick up the new one via `_findCaretCheckbox`.
                    this._caretHandle?.dispose();
                    this._caretHandle = null;
                    this._caretInput = null;
                }
            }
        }

        let caretItemStateChanged = false;

        for (const input of domRoot.querySelectorAll<HTMLInputElement>(".todo-list__label input[type=\"checkbox\"]")) {
            const currentState = readTaskState(input);
            const previousState = this._knownState.get(input);
            const isNew = !this._hoverHandles.has(input);
            this._knownState.set(input, currentState);

            if (isNew) {
                const handle = manager.createHandle(input, this._computeContent(input));
                this._hoverHandles.set(input, handle);
                // Cache the enclosing item's id — stable for this input's life, and we
                // need it on every hover event to decide whether to yield to the caret.
                /* v8 ignore next -- CKEditor's list plugin guarantees every
                   `<li>` inside a rendered todo list carries `data-list-item-id`
                   and the checkbox is nested inside that `<li>`. The `?.` /
                   `?? null` fallbacks are defensive. */
                const ownItemId = input.closest<HTMLElement>("li")?.getAttribute("data-list-item-id") ?? null;
                // Hover on the checkbox whose item already has the caret is a no-op:
                // the caret handle already owns that item's tooltip visibility, and
                // running the dwell + push cycle on top of it only confuses the stack.
                const ownedByCaret = () => ownItemId !== null && ownItemId === this._caretItemId;
                input.addEventListener("mouseenter", () => {
                    if (ownedByCaret()) return;
                    handle.showAfter(TOOLTIP_DWELL_MS);
                });
                input.addEventListener("mouseleave", () => {
                    if (ownedByCaret()) return;
                    handle.hide();
                });
            /* v8 ignore start -- taskState is scope:"item", so any state change
               triggers a full item reconvert and gives us a fresh `<input>`. The
               old input is reaped by the disconnected loop above before we get
               here, so this branch is defensive: it would only fire if CKEditor
               ever stopped reconverting on scope:"item" attribute changes. */
            } else if (currentState !== previousState) {
                this._hoverHandles.get(input)?.setContent(this._computeContent(input));
                if (input === this._caretInput) {
                    caretItemStateChanged = true;
                }
            }
            /* v8 ignore stop */
        }

        return caretItemStateChanged;
    }

    /**
     * Reconcile the caret handle against the current model caret target. Called
     * on selection changes AND at the end of every render.
     *
     * The item-id vs input-identity distinction matters: a state change across
     * the isCompleted boundary reconverts the todo item, giving us a new DOM
     * checkbox even though the caret hasn't moved. We want the tooltip to
     * reappear immediately in that case (per "reappear on state change"), not
     * to be delayed as if the user just navigated in.
     *
     * Cases:
     *   - Item unchanged, input unchanged, state unchanged → no-op.
     *   - Item unchanged, input unchanged, state changed (`forceShowIfSameTarget`)
     *     → refresh content, force immediate `show()`.
     *   - Item unchanged, input replaced (isCompleted-boundary reconversion)
     *     → rebuild handle on the new input, immediate `show()`.
     *   - Item changed (user actually moved the caret) → new handle,
     *     `showAfter(TOOLTIP_DWELL_MS)`, so drive-throughs don't spawn a tooltip.
     */
    private _syncCaretTooltip(options: { forceShowIfSameTarget: boolean }): void {
        const manager = this._hintManager;
        /* v8 ignore next 3 -- gated same as _refreshHoverHandles, see there. */
        if (!manager) {
            return;
        }
        const target = this._findCaretCheckbox();
        const targetItemId = target?.closest<HTMLElement>("li")?.getAttribute("data-list-item-id") ?? null;
        const itemChanged = targetItemId !== this._caretItemId;
        const inputChanged = target !== this._caretInput;

        if (!itemChanged) {
            if (inputChanged) {
                // Same conceptual item, but the DOM input was recreated — rebuild
                // the handle and show immediately (no dwell delay for a rebuild).
                this._caretHandle?.dispose();
                this._caretHandle = null;
                this._caretInput = target;
                /* v8 ignore next -- inside the "same item, input changed"
                   branch, `target` cannot be null: `!itemChanged` means
                   `targetItemId === this._caretItemId`, and if `target` were
                   null then `targetItemId` would be null too, forcing the
                   `_caretItemId` we're comparing against to also be null —
                   but then `_caretInput` was null too, so `inputChanged`
                   would be false and we wouldn't be in this branch. */
                if (target) {
                    this._caretHandle = manager.createHandle(target, this._computeContent(target));
                    this._caretHandle.show();
                }
            /* v8 ignore start -- reachable only when `forceShowIfSameTarget`
               is true, which the render listener only sets when
               `_refreshHoverHandles` observes a state change on the caret's
               input WITHOUT the input being recreated — see the paired v8
               ignore in `_refreshHoverHandles`. Defensive counterpart. */
            } else if (target && this._caretHandle && options.forceShowIfSameTarget) {
                this._caretHandle.setContent(this._computeContent(target));
                this._caretHandle.show();
            }
            /* v8 ignore stop */
            return;
        }

        this._caretHandle?.dispose();
        this._caretHandle = null;
        this._caretInput = target;
        this._caretItemId = targetItemId;
        if (target) {
            this._caretHandle = manager.createHandle(target, this._computeContent(target));
            this._caretHandle.showAfter(TOOLTIP_DWELL_MS);
        }
    }

    /** Assemble the tooltip HTML for the given checkbox's current state. */
    private _computeContent(input: HTMLInputElement): string {
        return buildTooltipTitle(
            input.ownerDocument,
            readTaskState(input),
            this._stateByName,
            this._translate
        );
    }

    /**
     * The <input> DOM checkbox of the todo item the caret is currently inside, or
     * `null` when the caret isn't inside a todo item. Walks up the model to find
     * an ancestor block with `listType == "todo"`, then queries the editing DOM
     * for the matching <li data-list-item-id="…">.
     */
    private _findCaretCheckbox(): HTMLInputElement | null {
        const position = this.editor.model.document.selection.getFirstPosition();
        let node: ModelElement | null = null;
        let candidate = position?.parent ?? null;
        while (candidate) {
            if (candidate.is("element") && candidate.getAttribute("listType") === "todo") {
                node = candidate as ModelElement;
                break;
            }
            candidate = candidate.parent;
        }
        if (!node) {
            return null;
        }
        const itemId = node.getAttribute("listItemId");
        /* v8 ignore next 3 -- CKEditor's list plugin guarantees `listItemId`
           is a non-empty string on every todo item; defensive fallback. */
        if (typeof itemId !== "string" || !itemId) {
            return null;
        }
        const domRoot = this.editor.editing.view.getDomRoot();
        return domRoot?.querySelector<HTMLInputElement>(
            `li[data-list-item-id="${CSS.escape(itemId)}"] .todo-list__label input[type="checkbox"]`
        ) ?? null;
    }

}

export type TranslateFn = (key: string, params?: Record<string, unknown>) => string;

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
 */
export function buildTooltipTitle(
    doc: Document,
    state: string | null,
    stateByName: Map<string, TaskStateDef>,
    translate: TranslateFn
): string {
    const body = translate("text-editor.checkbox-tooltip", {
        shortcut: renderCycleShortcut(translate)
    });
    if (!state) {
        return body;
    }
    const stateDef = stateByName.get(state);
    const suffix = stateDef
        ? buildKnownStateSuffixHtml(doc, state, stateDef.title || stateDef.name)
        : buildUnknownStateSuffixHtml(
            doc,
            state,
            translate("text-editor.checkbox-tooltip-state-unknown-suffix")
        );
    const label = translate("text-editor.checkbox-tooltip-state-label");
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
 * Render the state-cycle shortcut as `<kbd>Ctrl</kbd>+<kbd>Shift</kbd>+<kbd>Enter</kbd>`
 * (or `<kbd>⌃</kbd><kbd>⇧</kbd><kbd>↩</kbd>` on macOS). Uses the shared
 * `formatShortcut`/`joinShortcut` from `@triliumnext/commons` so key labels
 * flow through the same i18n and Mac-glyph rules as the rest of the app.
 */
function renderCycleShortcut(translate: TranslateFn): string {
    const kbdTokens = formatShortcut(STATE_CYCLE_SHORTCUT, translate, env.isMac)
        .map((token) => `<kbd>${token}</kbd>`);
    return joinShortcut(kbdTokens, env.isMac);
}

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
