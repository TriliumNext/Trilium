import { Plugin, Enter, Delete, enableViewPlaceholder, env, type ViewDocumentEnterEvent, type ViewDocumentDeleteEvent, type ViewDocumentArrowKeyEvent } from "ckeditor5";
import { formatShortcut, joinShortcut } from "@triliumnext/commons";
import { ContentHintManager, type HintHandle } from "@triliumnext/ckeditor5-utils";
import BlockDragHandle from "./block-drag-handle.js";
import CollapsibleCommand from "./collapsible-command.js";
import { OPEN_ATTRIBUTE, TRANSIENT_OPEN_ATTRIBUTE } from "./constants.js";

type TranslateFn = (key: string, params?: Record<string, unknown>) => string;

/**
 * The keyboard shortcut for toggling a collapsible's `open` state. Shared as
 * a single source of truth between the `Ctrl+Enter` DOM keydown handler in
 * {@link CollapsibleEditing#onDomKeydown} and the summary hint's rendered
 * label — a rebinding in one has to be mirrored in the other.
 */
const TOGGLE_SHORTCUT = "Ctrl+Enter";

/**
 * Dwell delay before hover or a stationary caret pops a summary/handle hint.
 * Long enough that mouse flyovers don't spawn a popup, short enough that
 * intentional attention still produces one.
 */
const HINT_DWELL_MS = 200;

/**
 * How long a hint stays visible without any new event (push, content refresh,
 * caret movement) before it fades itself out. Matches the todo-list multistate
 * plugin's cadence so the two feel consistent.
 */
const HINT_AUTO_HIDE_MS = 2000;

/**
 * Per-summary hint state. Combines a single {@link HintHandle} with the two
 * independent visibility drivers — hover and caret — so both can coexist
 * without racing the manager's element-swap logic. `handle.show()` /
 * `handle.hide()` are called from a single derived predicate
 * (`hoverActive || caretActive`), never from either driver directly, so the
 * handle's element identity is stable for as long as the summary lives.
 */
interface SummaryHintState {
    /** Currently-mapped DOM element for this summary. Kept in sync on every render. */
    dom: HTMLElement;
    handle: HintHandle;
    hoverActive: boolean;
    caretActive: boolean;
    /**
     * Bound mouseenter/mouseleave listeners for {@link dom}. Held so we can
     * `removeEventListener` on the old DOM before re-attaching to a fresh one
     * after a CKEditor reconvert — without these references the listeners
     * would linger on the detached node, keeping their `state` closures alive
     * until GC and silently mutating shared state if the node ever re-attaches.
     */
    mouseEnter?: (event: MouseEvent) => void;
    mouseLeave?: (event: MouseEvent) => void;
}


/**
 * Schema, conversion and key handling for collapsible blocks.
 *
 * Model:        <details open><summary>title</summary>…blocks…</details>
 * Data view:    <details class="trilium-collapsible" open><summary>…</summary>…</details>
 * Editing view: same, plus a custom arrow UIElement in the summary for toggling.
 *
 * The expanded state lives in the model as the {@link OPEN_ATTRIBUTE} attribute and
 * is therefore persisted into the note's saved HTML: a block the user left open
 * reopens on the next visit. A **missing** attribute means collapsed, so notes
 * written before the state was persisted keep loading fully collapsed.
 *
 * Toggling is a model change like any other, with one deliberate exception: it runs
 * in a non-undoable batch (see {@link CollapsibleEditing#setDetailsOpen}), so
 * Ctrl+Z after reading a note doesn't re-collapse what the reader just expanded.
 */
export default class CollapsibleEditing extends Plugin {

    public static get pluginName() {
        return "CollapsibleEditing" as const;
    }

    public static get requires() {
        return [Enter, Delete] as const;
    }

    private keydownListeners: Array<{ root: HTMLElement, handler: (e: KeyboardEvent) => void }> = [];
    private toggleListeners: Array<{ root: HTMLElement, handler: (e: Event) => void }> = [];
    private dragHandle!: BlockDragHandle;
    /**
     * Shared manager for summary hints (screen-corner popup on each <summary>).
     * Each summary owns ONE handle in {@link summaryHints}; visibility is
     * driven by the two booleans on {@link SummaryHintState} (hover, caret)
     * rather than by stacking two handles against the manager. This matters
     * because pushing distinct hover + caret handles risks pointing them at
     * different DOM nodes for the same summary (`getDom` may return a fresh
     * DOM element after a reconvert while the hover map still holds the old
     * one), which would make the manager dispose the current tooltip and
     * create a new one — a visible ~150ms fade-out overlapping a ~150ms
     * fade-in when caret entry overlaps hover.
     */
    private summaryHintManager?: ContentHintManager;
    /**
     * Per-summary hint state, keyed by the model element so DOM churn doesn't
     * lose it. Updated on every view render — new summaries get a state,
     * detached ones are reaped.
     */
    private readonly summaryHints = new Map<any, SummaryHintState>();
    /**
     * Shared visibility stack for the drag-handle hints. Drag handles use
     * default near-element placement (no `text-editor-content-tooltip` class),
     * so they live in their own manager with plain `tooltipOptions`.
     */
    private handleHintManager?: ContentHintManager;
    /** Hover-driven handle per rendered drag-handle. Disposed when the handle detaches. */
    private readonly handleHoverHandles = new Map<HTMLElement, HintHandle>();
    /**
     * Collapsed <details> currently force-opened to reveal a find-in-note match.
     * This is transient editing-view state only: it never touches the model, so
     * it produces no `change:data`, no autosave, and no revision — searching must
     * not rewrite the open/closed layout the user saved. A block is held here only
     * while the find highlight sits inside it and is released the moment it leaves.
     */
    private readonly findRevealed = new Set<any>();

    public init(): void {
        this.editor.commands.add("collapsible", new CollapsibleCommand(this.editor));
        this.dragHandle = new BlockDragHandle({
            editor: this.editor,
            indicatorClass: "trilium-collapsible-drop-indicator",
            // A drop on another collapsible's <summary> should reorder relative
            // to the whole <details>, not nest inside the body (which the
            // summary-invariant post-fixer would then have to fight).
            refineTarget: (model) => {
                if (model?.is?.("element", "summary") && model.parent?.is("element", "details")) {
                    return model.parent;
                }
                return model;
            },
            onClick: (model) => {
                this.editor.model.change(w => w.setSelection(model, "on"));
                this.editor.editing.view.focus();
            }
        });
        this.registerSchema();
        this.registerConversion();
        this.registerBodyPlaceholder();
        this.registerKeyHandlers();
        this.registerClickHandler();
        this.registerDomListeners();
        this.registerPostFixers();
        this.registerFindReveal();
        // Global user preference: skip all content-hint wiring when off. The
        // rest of `init()` (schema, key handlers, drag, post-fixers) stays
        // intact — hints are additive UX, not a load-bearing feature. Missing
        // config (external CKEditor consumers, tests) → hints on.
        if (this.editor.config.get("contentHintsEnabled") !== false) {
            this.registerSummaryHints();
            this.registerHandleHints();
        }
    }

    public override destroy(): void {
        for (const { root, handler } of this.keydownListeners) {
            root.removeEventListener("keydown", handler, true);
        }
        this.keydownListeners = [];
        for (const { root, handler } of this.toggleListeners) {
            root.removeEventListener("toggle", handler, true);
        }
        this.toggleListeners = [];
        for (const state of this.summaryHints.values()) {
            this.detachSummaryHoverListeners(state, state.dom);
            state.handle.dispose();
        }
        this.summaryHints.clear();
        this.summaryHintManager?.destroy();
        this.summaryHintManager = undefined;
        for (const handle of this.handleHoverHandles.values()) {
            handle.dispose();
        }
        this.handleHoverHandles.clear();
        this.handleHintManager?.destroy();
        this.handleHintManager = undefined;
        this.findRevealed.clear();
        this.dragHandle?.cancel();
        super.destroy();
    }

    // -----------------------------------------------------------------
    // Schema & conversion
    // -----------------------------------------------------------------

    private registerSchema() {
        const schema = this.editor.model.schema;
        schema.register("details", {
            inheritAllFrom: "$container",
            // Without this the attribute would be stripped by `insertContent`
            // (schema-driven filtering) when a collapsible is pasted or inserted.
            allowAttributes: [OPEN_ATTRIBUTE]
        });
        schema.register("summary", {
            allowIn: "details",
            allowContentOf: "$block",
            // isBlock lets MoveBlockUpDownPlugin (and other block-level commands)
            // resolve a caret-in-summary to the enclosing <details> via its
            // walk-up-to-top-level-block logic.
            isBlock: true
        });
    }

    private registerConversion() {
        const conversion = this.editor.conversion;
        const detailsView = (_m: any, { writer }: any) =>
            writer.createContainerElement("details", { class: "trilium-collapsible" });

        // <details>
        conversion.for("upcast").elementToElement({ view: "details", model: "details" });
        conversion.for("dataDowncast").elementToElement({ model: "details", view: detailsView });

        // `open` — the persisted expanded state. Upcast maps the native boolean
        // attribute (whose value is the empty string) to a model `true`; a missing
        // attribute yields no model attribute at all, i.e. collapsed.
        conversion.for("upcast").attributeToAttribute({
            view: { name: "details", key: OPEN_ATTRIBUTE },
            model: { key: OPEN_ATTRIBUTE, value: () => true }
        });
        // Both downcasts use the same explicit converter rather than the
        // `attributeToAttribute` helper: the helper derives the view value from the
        // model value (giving `open="true"`), whereas a native boolean attribute
        // wants `open=""`. Removal has to clear the view attribute outright.
        const openDowncast = (dispatcher: any) => {
            dispatcher.on(`attribute:${OPEN_ATTRIBUTE}:details`, (evt: any, data: any, conversionApi: any) => {
                if (!conversionApi.consumable.consume(data.item, evt.name)) return;
                const viewElement = conversionApi.mapper.toViewElement(data.item);
                if (!viewElement) return;
                if (data.attributeNewValue) {
                    conversionApi.writer.setAttribute(OPEN_ATTRIBUTE, "", viewElement);
                } else {
                    conversionApi.writer.removeAttribute(OPEN_ATTRIBUTE, viewElement);
                }
            });
        };
        conversion.for("dataDowncast").add(openDowncast);
        conversion.for("editingDowncast").add(openDowncast);
        // The editing view wraps the body blocks in a <div class="trilium-collapsible-content">.
        // Chromium caps a native mouse drag-selection to a single block whenever the blocks are
        // direct children of a <details> in a contenteditable (its ::details-content slot acts as
        // a hard selection boundary — keyboard and programmatic selection cross it fine, only the
        // drag algorithm doesn't). Giving the body a single wrapping container removes that
        // boundary. This is editing-only: the data downcast above stays flat
        // (<details><summary>…</summary><blocks>) so the saved HTML signature is unchanged. The
        // <summary> stays a direct child of <details> (native collapse hides everything else), so
        // only the non-summary blocks go into the wrapper.
        conversion.for("editingDowncast").elementToStructure({
            model: "details",
            view: (modelElement: any, { writer }: any) => {
                // Reconversion (triggered whenever the body blocks change) rebuilds this
                // <details>, which would otherwise default to closed and collapse a block
                // the user is editing. Seed `open` from the model here so the renderer
                // itself restores it — a post-render fix-up can't, because the view's
                // "render" event fires *before* the DOM is reconciled.
                const attributes: Record<string, string> = { class: "trilium-collapsible" };
                if (modelElement.getAttribute(OPEN_ATTRIBUTE)) {
                    attributes.open = "";
                } else if (this.findRevealed.has(modelElement)) {
                    // Force-open for a find match, without a persisted `open`. Tag it
                    // so this "opened only by search" state is styleable and can be
                    // stripped again cleanly when the highlight moves on.
                    attributes.open = "";
                    attributes[TRANSIENT_OPEN_ATTRIBUTE] = "";
                }
                const details = writer.createContainerElement("details", attributes);
                writer.insert(
                    writer.createPositionAt(details, 0),
                    writer.createSlot((node: any) => node.is("element", "summary"))
                );
                const content = writer.createContainerElement("div", {
                    class: "trilium-collapsible-content"
                });
                writer.insert(
                    writer.createPositionAt(content, 0),
                    writer.createSlot((node: any) => !node.is("element", "summary"))
                );
                writer.insert(writer.createPositionAt(details, "end"), content);
                return details;
            }
        });

        // <summary>
        conversion.for("upcast").elementToElement({ view: "summary", model: "summary" });
        conversion.for("dataDowncast").elementToElement({ model: "summary", view: "summary" });
        conversion.for("editingDowncast").elementToElement({
            model: "summary",
            view: (_m: any, { writer }: any) => this.createEditingSummary(writer)
        });
    }

    private translate(): TranslateFn {
        return (this.editor.config.get("translate") as TranslateFn | undefined)
            ?? ((key: string) => key);
    }

    /**
     * Editing-view summary: a normal <summary> with a non-editable arrow UIElement
     * prepended. Clicking the arrow toggles the native <details>; the data view
     * doesn't include the arrow so it doesn't pollute saved HTML.
     */
    private createEditingSummary(writer: any): any {
        const editor = this.editor;
        const plugin = this;
        const t = this.translate();
        const summary = writer.createContainerElement("summary");

        // Selection / drag handle — non-editable affordance for selecting and
        // moving the whole <details> as a block (mirrors the table widget's
        // handle, but works without making the collapsible a widget).
        const handle = writer.createUIElement("span", {
            class: "trilium-collapsible-handle",
            role: "button",
            tabindex: "0",
            "aria-label": t("text-editor.collapsible-select-label")
        }, function(this: any, domDocument: any) {
            const span: HTMLElement = this.toDomElement(domDocument);
            const resolveDetails = () => plugin.detailsFromDom(span);
            const selectBlock = () => {
                const model = resolveDetails();
                if (!model) return;
                editor.model.change(w => w.setSelection(model, "on"));
                editor.editing.view.focus();
            };
            // Custom drag: mousedown starts tracking, document mousemove/mouseup
            // (registered by startMouseDrag) decide whether it's a click or a drag.
            // preventDefault stops the editor from placing a caret on the handle
            // and from initiating a native text selection drag.
            span.addEventListener("mousedown", (e: MouseEvent) => {
                if (e.button !== 0) return;
                const model = resolveDetails();
                if (!model) return;
                const root = span.closest(".ck-editor__editable") as HTMLElement | null;
                if (!root) return;
                e.preventDefault();
                e.stopPropagation();
                plugin.dragHandle.start(e.clientX, e.clientY, model, root);
            });
            // Suppress the trailing click so CKEditor's click handler doesn't
            // reposition the caret after our mouseup has set the selection.
            span.addEventListener("click", (e: Event) => {
                e.stopPropagation();
                e.preventDefault();
            });
            span.addEventListener("keydown", (e: KeyboardEvent) => {
                if (e.key === "Enter" || e.key === " ") {
                    e.stopPropagation();
                    e.preventDefault();
                    selectBlock();
                }
            });
            return span;
        });

        const arrow = writer.createUIElement("span", {
            class: "trilium-collapsible-arrow",
            role: "button",
            tabindex: "0",
            "aria-label": t("text-editor.collapsible-toggle-label"),
            "aria-expanded": "false"
        }, function(this: any, domDocument: any) {
            const span: HTMLElement = this.toDomElement(domDocument);
            // Toggle through the model, never by writing `detailsDom.open`: `open` is
            // now part of the editing view, so a direct DOM write would desynchronise
            // the view tree from the DOM and be clobbered by the next render.
            const toggle = () => {
                const model = plugin.detailsFromDom(span);
                if (model) plugin.toggleDetails(model);
            };
            // mousedown preventDefault keeps the browser from placing a caret
            // inside the non-editable UI element.
            span.addEventListener("mousedown", (e: Event) => e.preventDefault());
            span.addEventListener("click", (e: Event) => {
                e.stopPropagation();
                e.preventDefault();
                toggle();
            });
            // role="button" doesn't get the browser's built-in Enter/Space activation
            // (that's only for <button>), so wire it up explicitly for keyboard users.
            span.addEventListener("keydown", (e: KeyboardEvent) => {
                if (e.key === "Enter" || e.key === " ") {
                    e.stopPropagation();
                    e.preventDefault();
                    toggle();
                }
            });
            return span;
        });
        writer.insert(writer.createPositionAt(summary, 0), arrow);
        writer.insert(writer.createPositionAt(summary, 0), handle);
        // "Title" placeholder shown while the summary is empty. UIElements like the
        // arrow above don't count as content for placeholder purposes.
        enableViewPlaceholder({
            view: this.editor.editing.view,
            element: summary,
            text: t("text-editor.collapsible-title-placeholder"),
            keepOnFocus: true
        });
        return summary;
    }

    // -----------------------------------------------------------------
    // DOM/model bridge helpers
    // -----------------------------------------------------------------

    private getDom<T extends Element = HTMLElement>(model: any): T | null {
        const view = this.editor.editing.mapper.toViewElement(model);
        const dom = view ? this.editor.editing.view.domConverter.viewToDom(view) : null;
        return dom instanceof Element ? (dom as unknown as T) : null;
    }

    /** True if the <details> is currently expanded. A missing attribute means collapsed. */
    private isDetailsOpen(model: any): boolean {
        return !!model.getAttribute?.(OPEN_ATTRIBUTE);
    }

    /**
     * Write the expanded state to the model, which the downcast reflects to the DOM.
     *
     * `enqueueChange`, not `change`: a toggle can originate from a DOM event that
     * fires while a model change block is still open (the downcast setting `open`
     * makes the browser emit `toggle`), and `model.change` nested in a block joins
     * that block's batch — silently making the toggle part of the user's undo step.
     * `enqueueChange` always creates its own batch, and `isUndoable: false` keeps it
     * off the undo stack: Ctrl+Z after reading must not re-collapse the block.
     */
    private setDetailsOpen(model: any, open: boolean) {
        // Cheap guard against the downcast → DOM `toggle` → write-back loop. The
        // writer would swallow the no-op anyway, but bailing here also avoids
        // queueing an empty change block on every render-driven toggle.
        if (this.isDetailsOpen(model) === open) return;
        this.editor.model.enqueueChange({ isUndoable: false }, (writer: any) => {
            if (open) {
                writer.setAttribute(OPEN_ATTRIBUTE, true, model);
            } else {
                writer.removeAttribute(OPEN_ATTRIBUTE, model);
            }
        });
    }

    /** Flip the expanded state of a <details>. */
    private toggleDetails(model: any) {
        this.setDetailsOpen(model, !this.isDetailsOpen(model));
    }

    /** Resolve the <details> model element enclosing a DOM node, if any. */
    private detailsFromDom(node: Element): any | null {
        const detailsDom = node.closest("details");
        if (!detailsDom) return null;
        const view = this.editor.editing.view.domConverter.mapDomToView(detailsDom);
        return view ? this.editor.editing.mapper.toModelElement(view as any) : null;
    }

    /** Is the caret on the first ("top") or last ("bottom") visual line of `dom`? */
    private caretAtVisualEdge(dom: HTMLElement, edge: "top" | "bottom"): boolean {
        const win = dom.ownerDocument.defaultView;
        const sel = win?.getSelection();
        if (!sel || sel.rangeCount === 0) return true;
        const caret = sel.getRangeAt(0).getBoundingClientRect();
        const box = dom.getBoundingClientRect();
        const lineHeight = parseFloat(win!.getComputedStyle(dom).lineHeight) || 16;
        return edge === "top"
            ? caret.top < box.top + lineHeight / 2
            : caret.bottom > box.bottom - lineHeight / 2;
    }

    /** Insert a new empty paragraph at `position` and place the caret in it. */
    private insertParagraphAt(writer: any, position: any): any {
        const p = writer.createElement("paragraph");
        writer.insert(p, position);
        writer.setSelection(p, 0);
        return p;
    }

    /** Iterate every editing-view DOM root (supports multi-root editors). */
    private forEachDomRoot(fn: (root: HTMLElement) => void) {
        const view = this.editor.editing.view;
        for (const viewRoot of view.document.getRoots()) {
            const dom = view.getDomRoot(viewRoot.rootName);
            if (dom instanceof HTMLElement) fn(dom);
        }
    }

    // -----------------------------------------------------------------
    // Body placeholder
    // -----------------------------------------------------------------

    /**
     * Show a "Content" placeholder on the *first* body paragraph of a <details>
     * (only the one immediately after the summary). For a freshly-inserted
     * collapsible that's the single empty paragraph the user sees. Subsequent
     * body paragraphs the user adds don't get their own placeholder — keeps
     * the hint visible only where it's useful.
     */
    private bodyPlaceholdersApplied = new WeakSet<any>();

    private registerBodyPlaceholder() {
        const editor = this.editor;
        const t = this.translate();
        editor.conversion.for("editingDowncast").add((dispatcher: any) => {
            dispatcher.on("insert:paragraph", (_evt: any, data: any, conversionApi: any) => {
                const paragraph = data.item;
                const parent = paragraph.parent;
                if (!parent?.is("element", "details")) return;
                // Only the first body block (index 1; index 0 is the summary).
                if (parent.getChild(1) !== paragraph) return;
                const view = conversionApi.mapper.toViewElement(paragraph);
                if (!view || this.bodyPlaceholdersApplied.has(view)) return;
                enableViewPlaceholder({
                    view: editor.editing.view,
                    element: view,
                    text: t("text-editor.collapsible-body-placeholder"),
                    keepOnFocus: true
                });
                this.bodyPlaceholdersApplied.add(view);
            }, { priority: "low" });
        });
    }

    // -----------------------------------------------------------------
    // View-event key handlers (Enter, Delete, ArrowUp)
    // -----------------------------------------------------------------

    private registerKeyHandlers() {
        const viewDocument = this.editor.editing.view.document;
        this.listenTo<ViewDocumentEnterEvent>(viewDocument, "enter",
            (evt, data) => this.onEnterInSummary(evt, data), { context: "summary" });
        this.listenTo<ViewDocumentEnterEvent>(viewDocument, "enter",
            (evt, data) => this.onEnterInBody(evt, data));
        this.listenTo<ViewDocumentArrowKeyEvent>(viewDocument, "arrowKey",
            (evt, data) => this.onUpArrow(evt, data));
        this.listenTo<ViewDocumentDeleteEvent>(viewDocument, "delete",
            (evt, data) => this.onDeleteAdjacentDetails(evt, data));
        this.listenTo<ViewDocumentDeleteEvent>(viewDocument, "delete",
            (evt, data) => this.onBackspaceInEmptySummary(evt, data), { context: "summary" });
    }

    /**
     * Enter inside a summary:
     *   - at start of title  → blank paragraph before the collapsible
     *   - at end of title    → expanded: empty paragraph at start of body
     *                          collapsed: blank paragraph after the collapsible
     *   - anywhere else      → split the title, right side becomes the first body
     *                          block (expand if collapsed)
     */
    private onEnterInSummary(evt: any, data: any) {
        const editor = this.editor;
        const model = editor.model;
        const selection = model.document.selection;

        const summary = selection.getFirstPosition()?.findAncestor("summary");
        if (!summary) return;

        // Titles are single-line: always swallow Enter so it never inserts a newline
        // — even when there's an active selection inside the summary (native Enter
        // would otherwise split the summary and produce an invalid structure).
        data.preventDefault();
        evt.stop();

        const details = summary.parent;
        if (!details || !details.is("element", "details")) return;

        model.change(writer => {
            // Drop any non-collapsed selection so we operate on a single position.
            if (!selection.isCollapsed) {
                model.deleteContent(selection);
            }
            const position = selection.getLastPosition();
            if (!position) return;

            if (position.isAtStart) {
                this.insertParagraphAt(writer, writer.createPositionBefore(details));
                return;
            }

            if (position.isAtEnd) {
                const pos = this.isDetailsOpen(details)
                    ? writer.createPositionAfter(summary)
                    : writer.createPositionAfter(details);
                // If the spot already holds an empty paragraph (the body's
                // placeholder paragraph, or a blank line the user left after
                // the collapsible), just park the caret in it — stacking a
                // second identical empty paragraph on top would surprise the
                // user and require an extra Backspace to clean up.
                const existing = pos.nodeAfter;
                if (existing?.is?.("element", "paragraph") && existing.isEmpty) {
                    writer.setSelection(existing, 0);
                    return;
                }
                this.insertParagraphAt(writer, pos);
                return;
            }

            // Middle of title: split, which needs the body visible. Expand inside
            // this same change block so the hidden-body post-fixer (which runs once
            // the block completes) sees the block already open and leaves the caret
            // in the new body paragraph. Using the block's own writer rather than
            // `setDetailsOpen` is deliberate here: the expansion is part of the
            // user's edit, so undoing the split should restore the collapsed state.
            writer.setAttribute(OPEN_ATTRIBUTE, true, details);
            const rightRange = writer.createRange(
                writer.createPositionAt(summary, position.offset),
                writer.createPositionAt(summary, "end")
            );
            const p = writer.createElement("paragraph");
            writer.insert(p, summary, "after");
            writer.move(rightRange, writer.createPositionAt(p, 0));
            writer.setSelection(p, 0);
        });
    }

    /**
     * Enter in an empty trailing paragraph of the body exits the collapsible
     * (text + Enter + Enter → out — same convention as blockquote).
     */
    private onEnterInBody(evt: any, data: any) {
        const editor = this.editor;
        const selection = editor.model.document.selection;
        if (!selection.isCollapsed) return;

        const parent = selection.getLastPosition()?.parent;
        // Restrict to <paragraph> so we don't hijack the native Enter behaviour
        // of list items (outdent), headings (convert to paragraph), etc.
        if (!parent || !parent.is("element", "paragraph")) return;
        if (!parent.isEmpty || parent.nextSibling) return;

        const details = parent.parent;
        if (!details || !details.is("element", "details")) return;

        data.preventDefault();
        evt.stop();

        editor.model.change(writer => {
            writer.remove(parent);
            const after = details.nextSibling;
            if (after?.is("element", "paragraph")) {
                writer.setSelection(after, 0);
            } else {
                this.insertParagraphAt(writer, writer.createPositionAfter(details));
            }
        });
    }

    /**
     * Up arrow:
     *   - from inside a summary whose details has a previous-sibling details
     *     → jump into the previous details (its last block if open, summary if closed)
     *   - from the start of any other block whose previous sibling is a details
     *     → jump into the previous details (same rules)
     * Multi-line summary navigation is left to the browser via the visual-edge guard.
     */
    private onUpArrow(evt: any, data: any) {
        const selection = this.editor.model.document.selection;
        if (data.keyCode !== 38 || data.shiftKey || !selection.isCollapsed) return;

        const position = selection.getFirstPosition();
        if (!position) return;

        const summary = position.findAncestor("summary");
        if (summary) {
            const details = summary.parent;
            if (!details?.is("element", "details")) return;
            const dom = this.getDom<HTMLElement>(summary);
            if (dom && !this.caretAtVisualEdge(dom, "top")) return;
            const prev = details.previousSibling;
            if (!prev?.is("element", "details")) return;
            this.jumpUpInto(prev, /* atOffsetZeroIfOpen */ false, evt, data);
            return;
        }

        const block = position.parent;
        if (!block || !block.is("element") || !position.isAtStart) return;
        const prev = block.previousSibling;
        if (!prev?.is("element", "details")) return;
        this.jumpUpInto(prev, /* atOffsetZeroIfOpen */ true, evt, data);
    }

    private jumpUpInto(details: any, atOffsetZeroIfOpen: boolean, evt: any, data: any) {
        const open = this.isDetailsOpen(details);
        const target = open
            ? details.getChild(details.childCount - 1)
            : details.getChild(0);
        if (!target?.is("element")) return;
        const offset: number | "end" = open && atOffsetZeroIfOpen ? 0 : "end";
        this.editor.model.change(writer => writer.setSelection(target, offset));
        data.preventDefault();
        evt.stop();
    }

    /**
     * Two-step delete next to a <details> (matches CKEditor's widget/object pattern):
     *   1st press: select the whole <details> so the user sees what's about to go.
     *   2nd press: with the details selected, default delete removes it.
     */
    private onDeleteAdjacentDetails(evt: any, data: any) {
        const selection = this.editor.model.document.selection;
        // 2nd press: a <details> is already selected; let CKEditor's default delete
        // remove it (more reliable than us calling writer.remove here).
        if (selection.getSelectedElement()?.is("element", "details")) return;

        if (!selection.isCollapsed) return;
        const position = selection.getFirstPosition();
        if (!position) return;
        const adjacent = data.direction === "forward" ? position.nodeAfter : position.nodeBefore;
        if (!adjacent || !adjacent.is("element", "details")) return;

        // Don't hijack a delete when the current block is empty — the user is
        // removing the empty block, not the details next to it. Default behaviour
        // collapses the empty paragraph naturally.
        const currentBlock = position.parent;
        if (currentBlock?.is("element") && currentBlock.isEmpty) return;

        this.editor.model.change(writer => writer.setSelection(adjacent, "on"));
        data.preventDefault();
        evt.stop();
    }

    /** Backspace at start of an empty summary unwraps the collapsible. */
    private onBackspaceInEmptySummary(evt: any, data: any) {
        const selection = this.editor.model.document.selection;
        if (data.direction !== "backward" || !selection.isCollapsed) return;
        const summary = selection.getLastPosition()?.findAncestor("summary");
        if (!summary || !summary.isEmpty) return;
        const details = summary.parent;
        if (!details || !details.is("element", "details")) return;
        data.preventDefault();
        evt.stop();

        // Move the caret out of the (about-to-be-removed) empty summary so the
        // structural post-fixer doesn't strand it after unwrap. If the body is
        // also empty, there's nothing left in the collapsible to drop the caret
        // into — replace the whole block with a fresh empty paragraph instead.
        this.editor.model.change(writer => {
            const firstBody = details.getChild(1);
            if (firstBody?.is("element")) {
                writer.setSelection(firstBody, 0);
                // Remove the empty summary first so unwrap doesn't briefly leave
                // an orphan <summary> in the parent (which would otherwise
                // require the summary-invariant post-fixer to clean up).
                writer.remove(summary);
                writer.unwrap(details);
            } else {
                const p = writer.createElement("paragraph");
                writer.insert(p, writer.createPositionBefore(details));
                writer.setSelection(p, 0);
                writer.remove(details);
            }
        });
    }

    // -----------------------------------------------------------------
    // Click handler
    // -----------------------------------------------------------------

    /**
     * Suppress the native click-to-toggle on <summary> in the editor — only the
     * custom arrow may change the open state. The data/published view keeps the
     * native marker and click-to-toggle behavior.
     *
     * Modifier-clicks that land on an interactive element (link, button) pass
     * through so e.g. Ctrl+click on a link inside the title opens it in a new
     * tab. Modifier-clicks on plain summary text are still suppressed — the
     * native <details> would otherwise toggle, which is rarely intended.
     */
    private registerClickHandler() {
        this.listenTo(this.editor.editing.view.document, "click", (_evt, data: any) => {
            const domEvent = data.domEvent as MouseEvent | undefined;
            const hasModifier = !!(domEvent?.ctrlKey || domEvent?.metaKey || domEvent?.shiftKey || domEvent?.altKey);
            for (let node = data.target; node; node = node.parent) {
                // Modifier-click on an interactive element (link/button): let the
                // browser handle it — we encountered the interactive element before
                // the summary so the user clearly intended its default action.
                if (hasModifier && (node.is?.("element", "a") || node.is?.("element", "button"))) {
                    return;
                }
                if (node.is?.("element", "summary") && node.parent?.is("element", "details")) {
                    data.preventDefault();
                    return;
                }
            }
        });
    }

    // -----------------------------------------------------------------
    // DOM listeners (need DOM roots; registered once the editor is ready)
    // -----------------------------------------------------------------

    private registerDomListeners() {
        const editor = this.editor;
        this.listenTo(editor, "ready", () => {
            this.forEachDomRoot(root => {
                // DOM-level keydown for Ctrl+Enter and ArrowDown. View-event listeners
                // are unreliable when the caret is inside attribute elements (links,
                // formatted text, …); DOM capture phase always fires.
                const keydownHandler = (event: KeyboardEvent) => this.onDomKeydown(event);
                // Move the caret out of a body that's about to be hidden by collapse.
                // (toggle does not bubble — capture phase.)
                const toggleHandler = (event: Event) => this.onDetailsToggle(event);
                root.addEventListener("keydown", keydownHandler, true);
                root.addEventListener("toggle", toggleHandler, true);
                this.keydownListeners.push({ root, handler: keydownHandler });
                this.toggleListeners.push({ root, handler: toggleHandler });
            });
        });
    }

    private onDomKeydown(event: KeyboardEvent) {
        const selection = this.editor.model.document.selection;

        // Ctrl+Enter (Cmd+Enter on Mac) inside a summary toggles the enclosing details.
        if (event.key === "Enter" && !event.shiftKey && !event.altKey && (event.ctrlKey || event.metaKey)) {
            const summary = selection.getFirstPosition()?.findAncestor("summary");
            const details = summary?.parent;
            if (!details?.is("element", "details")) return;
            this.toggleDetails(details);
            event.preventDefault();
            event.stopPropagation();
            return;
        }

        // ArrowDown in a summary jumps into the body (or skips past a collapsed block).
        // Only when the selection is collapsed — otherwise native should collapse the
        // selection first (don't eat the user's selection in our jump).
        if (event.key === "ArrowDown" && !event.shiftKey && !event.altKey && !event.ctrlKey && !event.metaKey && selection.isCollapsed) {
            const summary = selection.getFirstPosition()?.findAncestor("summary");
            if (!summary) return;
            const details = summary.parent;
            if (!details?.is("element", "details")) return;
            const dom = this.getDom<HTMLElement>(summary);
            if (dom && !this.caretAtVisualEdge(dom, "bottom")) return;
            const target = this.isDetailsOpen(details) ? summary.nextSibling : details.nextSibling;
            if (!target?.is("element")) return;
            this.editor.model.change(writer => writer.setSelection(target, 0));
            event.preventDefault();
            event.stopPropagation();
        }
    }

    /**
     * The DOM `toggle` event, which fires both for our own downcast-driven changes
     * and for toggles the browser performs on its own (Chromium expands a closed
     * <details> to reveal a find-in-page match).
     *
     * Moving the caret out of a body that just collapsed is *not* handled here —
     * {@link CollapsibleEditing#hiddenBodyPostFixer} reads the same model attribute
     * and does it for every path that can close a block, including this one.
     */
    private onDetailsToggle(event: Event) {
        const detailsDom = event.target as HTMLDetailsElement;
        if (detailsDom.tagName?.toLowerCase() !== "details") return;
        if (!detailsDom.classList.contains("trilium-collapsible")) return;

        // Keep the arrow's aria-expanded in sync regardless of who flipped `open`.
        const arrow = detailsDom.querySelector(":scope > summary > .trilium-collapsible-arrow");
        arrow?.setAttribute("aria-expanded", String(detailsDom.open));

        // Adopt a state the model doesn't know about yet. Toggles that originated
        // from the model land here too and are absorbed by setDetailsOpen's guard.
        const detailsModel = this.detailsFromDom(detailsDom);
        if (!detailsModel) return;
        // A find-reveal drives this block's `open` transiently in the editing view
        // only — adopting it into the (persisted) model would let a search rewrite
        // the saved open/closed layout, so leave the model alone here.
        if (this.findRevealed.has(detailsModel)) return;
        this.setDetailsOpen(detailsModel, detailsDom.open);
    }

    // -----------------------------------------------------------------
    // Find-in-note reveal (transient, editing-view only)
    // -----------------------------------------------------------------

    /**
     * Follow the find-and-replace highlight: when it lands inside a collapsed
     * block, open that block (and any collapsed ancestors) just enough to show
     * the match; re-collapse the moment the highlight leaves. Purely editing-view
     * state — see {@link findRevealed}. No-op when the editor has no find plugin.
     */
    private registerFindReveal() {
        if (!this.editor.plugins.has("FindAndReplaceEditing")) return;
        const findEditing: any = this.editor.plugins.get("FindAndReplaceEditing");
        const state = findEditing?.state;
        if (!state?.on) return;
        this.listenTo(state, "change:highlightedResult", (_evt: any, _name: any, highlighted: any) => {
            this.syncFindReveal(highlighted);
        });
    }

    /**
     * Reconcile {@link findRevealed} with the block(s) the current highlight sits
     * in. Ancestors newly holding the highlight get revealed; blocks that no
     * longer hold it are re-collapsed. A `null` highlight (search cleared/closed)
     * collapses everything.
     */
    private syncFindReveal(highlighted: any) {
        const wanted = new Set<any>();
        for (let node = highlighted?.marker?.getStart?.()?.parent; node; node = node.parent) {
            // A persisted-open block is already visible — nothing transient to do.
            if (node.is?.("element", "details") && !this.isDetailsOpen(node)) {
                wanted.add(node);
            }
        }

        for (const details of this.findRevealed) {
            if (!wanted.has(details)) {
                // Keep the entry in the set until the reveal is stripped: while it's present,
                // onDetailsToggle's guard swallows the write-back from the DOM `toggle` that
                // removing `open` fires (mirrors the reveal path below). setDetailsOpen's own
                // no-op guard is the backstop where `toggle` fires asynchronously.
                this.applyFindReveal(details, false);
                this.findRevealed.delete(details);
            }
        }
        for (const details of wanted) {
            if (!this.findRevealed.has(details)) {
                this.findRevealed.add(details);
                this.applyFindReveal(details, true);
            }
        }
    }

    /** Add or strip the transient `open` (and its CSS marker) on the editing view. */
    private applyFindReveal(details: any, reveal: boolean) {
        const viewElement = this.editor.editing.mapper.toViewElement(details);
        if (!viewElement) return;
        this.editor.editing.view.change((writer: any) => {
            if (reveal) {
                writer.setAttribute(OPEN_ATTRIBUTE, "", viewElement);
                writer.setAttribute(TRANSIENT_OPEN_ATTRIBUTE, "", viewElement);
            } else {
                // If the user genuinely toggled it open mid-search, leave it open;
                // only the transient marker is ours to remove.
                if (!this.isDetailsOpen(details)) {
                    writer.removeAttribute(OPEN_ATTRIBUTE, viewElement);
                }
                writer.removeAttribute(TRANSIENT_OPEN_ATTRIBUTE, viewElement);
            }
        });
    }

    // -----------------------------------------------------------------
    // Summary hint (screen-corner popup) — driven by ContentHintManager
    // -----------------------------------------------------------------

    /**
     * Register the summary-hint plumbing:
     *  - hover-driven show/hide on every rendered <summary>;
     *  - caret-driven show/hide following the model selection;
     *  - one handle per summary, `hoverActive || caretActive` drives visibility.
     *
     * The single-handle design (instead of pushing separate hover + caret
     * handles onto the manager stack) avoids the fade-out+fade-in flicker
     * that occurs when hover has already pushed on one DOM node and caret
     * pushes on a different DOM node for the same model summary (e.g. after
     * a CKEditor reconvert). Only one Bootstrap Tooltip is ever created per
     * summary, and its target element is stable across combined interactions.
     */
    private registerSummaryHints() {
        const editor = this.editor;
        const t = this.translate();
        const title = t("text-editor.collapsible-tooltip", {
            shortcut: renderToggleShortcut(t)
        });
        const manager = new ContentHintManager({
            tooltipOptions: {
                sanitize: false,
                customClass: "text-editor-content-tooltip"
            },
            autoHideAfterMs: HINT_AUTO_HIDE_MS
        });
        this.summaryHintManager = manager;

        // Re-sync on every render: adopt fresh <summary> DOM nodes, drop
        // stale ones, and refresh caret ownership so a reconvert-in-flight
        // doesn't leave a handle pointing at a detached element.
        this.listenTo(editor.editing.view, "render", () => this.syncSummaryHints(manager, title));

        // The caret moving into a <summary> doesn't fire DOM focus (the
        // editable root keeps focus), so a hover-only trigger would miss
        // keyboard-into-summary navigation. Re-sync on selection changes to
        // update `caretActive` across every tracked summary.
        this.listenTo(editor.model.document.selection, "change:range", () => this.syncSummaryCaret());
    }

    /**
     * Reap dead summaries, adopt new ones (wiring up mouse listeners and a
     * fresh handle), and re-run caret sync so `caretActive` reflects the
     * current selection against the current DOM.
     */
    private syncSummaryHints(manager: ContentHintManager, title: string): void {
        // Collect the current summaries and their model elements. Do this
        // BEFORE the reap loop so we can detect summaries whose DOM was
        // replaced (model still present, DOM changed) and rebind their state
        // to the new element in place — no dispose+create flicker.
        const current = new Map<any, HTMLElement>();
        const mapper = this.editor.editing.mapper;
        const domConverter = this.editor.editing.view.domConverter;
        this.forEachDomRoot(root => {
            for (const dom of root.querySelectorAll<HTMLElement>("details.trilium-collapsible > summary")) {
                const view = domConverter.mapDomToView(dom);
                const model = view ? mapper.toModelElement(view as any) : null;
                if (model) current.set(model, dom);
            }
        });

        // Fast-path: `render` fires after every keystroke, so most invocations
        // find the summary set completely unchanged (same models, same DOM
        // nodes). Bail before the reap+adopt loops when nothing structural
        // changed — caret sync is driven by `change:range` and doesn't need
        // to run again here.
        let structuralChange = current.size !== this.summaryHints.size;
        if (!structuralChange) {
            for (const [model, dom] of current) {
                const existing = this.summaryHints.get(model);
                if (!existing || existing.dom !== dom) {
                    structuralChange = true;
                    break;
                }
            }
        }
        if (!structuralChange) return;

        // Drop states whose model is no longer in the rendered tree.
        for (const [model, state] of this.summaryHints) {
            if (!current.has(model)) {
                this.detachSummaryHoverListeners(state, state.dom);
                state.handle.dispose();
                this.summaryHints.delete(model);
            }
        }

        // For each current summary: adopt (fresh state) or refresh (existing
        // state, possibly with a new DOM node after a reconvert).
        for (const [model, dom] of current) {
            const existing = this.summaryHints.get(model);
            if (existing) {
                if (existing.dom !== dom) {
                    // Model persisted but its DOM was regenerated. Rebind:
                    // remove the old listeners (their closures would otherwise
                    // pin the detached DOM), dispose the old handle, then wire
                    // fresh listeners + handle on the new element.
                    this.detachSummaryHoverListeners(existing, existing.dom);
                    existing.handle.dispose();
                    existing.dom = dom;
                    existing.handle = manager.createHandle(dom, title);
                    // Rederive `hoverActive` from the new DOM — the mouse
                    // may or may not still be over the fresh element, and
                    // carrying over the boolean would strand a "phantom
                    // hover" popup when the pointer already left during the
                    // reconvert.
                    existing.hoverActive = dom.matches(":hover");
                    this.attachSummaryHoverListeners(existing);
                    this.applyVisibility(existing);
                }
                continue;
            }
            const state: SummaryHintState = {
                dom,
                handle: manager.createHandle(dom, title),
                // Same reasoning as the rebind path: adopt the DOM's actual
                // hover state so a summary that mounted under an already-
                // hovering pointer picks up correctly.
                hoverActive: dom.matches(":hover"),
                caretActive: false
            };
            this.summaryHints.set(model, state);
            this.attachSummaryHoverListeners(state);
        }

        this.syncSummaryCaret();
    }

    /**
     * Recompute `caretActive` for every tracked summary from the current
     * model selection. Idempotent: only touches handles whose caret ownership
     * actually flipped, so a keystroke inside a summary that doesn't cross a
     * boundary is free.
     */
    private syncSummaryCaret(): void {
        const caretSummary = this.editor.model.document.selection.getFirstPosition()?.findAncestor("summary") ?? null;
        for (const [model, state] of this.summaryHints) {
            const shouldBeActive = model === caretSummary;
            if (state.caretActive === shouldBeActive) continue;
            state.caretActive = shouldBeActive;
            this.applyVisibility(state);
        }
    }

    /**
     * Apply the derived predicate `hoverActive || caretActive` to a state's
     * handle. Hover has a dwell delay; caret is immediate — pushing without
     * dwell when caret takes ownership matches user intent (keyboard/click
     * navigation should reveal the hint promptly).
     */
    private applyVisibility(state: SummaryHintState): void {
        if (state.caretActive) {
            // Caret entering trumps any pending hover dwell — show now.
            state.handle.show();
        } else if (state.hoverActive) {
            state.handle.showAfter(HINT_DWELL_MS);
        } else {
            state.handle.hide();
        }
    }

    private attachSummaryHoverListeners(state: SummaryHintState): void {
        state.mouseEnter = () => {
            state.hoverActive = true;
            this.applyVisibility(state);
        };
        state.mouseLeave = () => {
            state.hoverActive = false;
            this.applyVisibility(state);
        };
        state.dom.addEventListener("mouseenter", state.mouseEnter);
        state.dom.addEventListener("mouseleave", state.mouseLeave);
    }

    private detachSummaryHoverListeners(state: SummaryHintState, previousDom: HTMLElement): void {
        if (state.mouseEnter) previousDom.removeEventListener("mouseenter", state.mouseEnter);
        if (state.mouseLeave) previousDom.removeEventListener("mouseleave", state.mouseLeave);
    }

    /**
     * Attach a manager-mediated hover hint to each drag handle. Drag handles
     * use default near-element Bootstrap placement (no screen-corner CSS),
     * so they live in their own manager with plain `tooltipOptions`.
     */
    private registerHandleHints() {
        const editor = this.editor;
        const t = this.translate();
        const title = t("text-editor.collapsible-handle-tooltip");
        const manager = new ContentHintManager({
            autoHideAfterMs: HINT_AUTO_HIDE_MS
        });
        this.handleHintManager = manager;

        this.listenTo(editor.editing.view, "render", () => {
            for (const [dragHandle, handle] of this.handleHoverHandles) {
                if (!dragHandle.isConnected) {
                    handle.dispose();
                    this.handleHoverHandles.delete(dragHandle);
                }
            }

            this.forEachDomRoot(root => {
                for (const dragHandle of root.querySelectorAll<HTMLElement>(".trilium-collapsible-handle")) {
                    if (this.handleHoverHandles.has(dragHandle)) continue;
                    const handle = manager.createHandle(dragHandle, title);
                    this.handleHoverHandles.set(dragHandle, handle);
                    dragHandle.addEventListener("mouseenter", () => handle.showAfter(HINT_DWELL_MS));
                    dragHandle.addEventListener("mouseleave", () => handle.hide());
                }
            });
        });
    }

    // -----------------------------------------------------------------
    // Model post-fixers
    // -----------------------------------------------------------------

    private registerPostFixers() {
        const document = this.editor.model.document;
        document.registerPostFixer(writer => this.structuralPostFixer(writer));
        document.registerPostFixer(writer => this.summaryInvariantPostFixer(writer));
        document.registerPostFixer(writer => this.bodyExistsPostFixer(writer));
        document.registerPostFixer(writer => this.gapPostFixer(writer));
        document.registerPostFixer(writer => this.hiddenBodyPostFixer(writer));
    }

    /**
     * Every <details> must have at least one body block after its <summary>.
     * Without one the placeholder vanishes and the collapsible looks broken —
     * this happens after Backspace at the start of an empty body, or after
     * onEnterInBody removes the only body paragraph to exit the block. Runs
     * after summaryInvariantPostFixer so the summary is guaranteed to exist
     * before we count children.
     */
    private bodyExistsPostFixer(writer: any): boolean {
        const changes = this.editor.model.document.differ.getChanges();
        const visited = new Set<any>();

        const ensure = (details: any): boolean => {
            if (visited.has(details)) return false;
            visited.add(details);
            if (details.childCount > 1) return false;
            const summary = details.getChild(0);
            if (!summary?.is("element", "summary")) return false;
            writer.insert(writer.createElement("paragraph"), details, "end");
            return true;
        };

        for (const entry of changes) {
            if (entry.type !== "remove") continue;
            const parent = (entry as any).position?.parent;
            if (parent?.is("element", "details") && ensure(parent)) return true;
        }
        return false;
    }

    /**
     * Cleanup invariants after every change:
     *  - <summary> not inside <details> → remove it
     *  - <details> with no children → remove it
     * For inserts we walk the inserted subtree to catch orphans nested inside it.
     * For removes we check whether the removal emptied a <details> (the removed
     * node itself is gone; `entry.position.nodeAfter` is the node that took its
     * place, not the removed one — never inspect it directly).
     */
    private structuralPostFixer(writer: any): boolean {
        const changes = this.editor.model.document.differ.getChanges();
        const visited = new Set<any>();
        for (const entry of changes) {
            if (entry.type === "insert") {
                // Walk via nextSibling up to entry.length — a multi-block insert
                // covers entry.length top-level nodes at this position.
                let node = (entry as any).position.nodeAfter;
                for (let i = 0; i < (entry as any).length && node; i++) {
                    if (node.is("element") && !visited.has(node)) {
                        visited.add(node);
                        for (const item of writer.createRangeOn(node).getItems()) {
                            if (item.is("element", "summary") && !item.parent?.is("element", "details")) {
                                writer.remove(item);
                                return true;
                            }
                            if (item.is("element", "details") && item.isEmpty) {
                                writer.remove(item);
                                return true;
                            }
                        }
                    }
                    node = node.nextSibling;
                }
            } else if (entry.type === "remove") {
                const parent = (entry as any).position.parent;
                if (parent && !visited.has(parent) && parent.is("element", "details") && parent.isEmpty) {
                    visited.add(parent);
                    writer.remove(parent);
                    return true;
                }
            }
        }
        return false;
    }

    /**
     * Every <details> must start with exactly one <summary> child. Defends against:
     *   - pasted/imported HTML with no <summary>, multiple <summary>, or summary
     *     not as the first child
     *   - the user dragging the <summary> out of its <details>
     *   - block-level commands (heading, etc.) renaming the summary to something
     *     else
     *
     * When a summary is missing we insert a blank one rather than re-using the
     * first existing child — the other content stays put as body, and the user
     * sees a fresh empty title to fill in.
     */
    private summaryInvariantPostFixer(writer: any): boolean {
        const changes = this.editor.model.document.differ.getChanges();
        const visited = new Set<any>();

        const ensureValid = (details: any): boolean => {
            if (visited.has(details)) return false;
            visited.add(details);

            const summaries: any[] = [];
            for (const child of details.getChildren()) {
                if (child.is("element", "summary")) summaries.push(child);
            }

            if (summaries.length === 0) {
                writer.insert(writer.createElement("summary"), details, 0);
                return true;
            }

            // Extra <summary>s: demote them to paragraphs (text content preserved).
            if (summaries.length > 1) {
                for (let i = 1; i < summaries.length; i++) {
                    writer.rename(summaries[i], "paragraph");
                }
                return true;
            }

            // Single summary but not at position 0: move it.
            if (details.getChild(0) !== summaries[0]) {
                writer.move(writer.createRangeOn(summaries[0]), writer.createPositionAt(details, 0));
                return true;
            }

            return false;
        };

        for (const entry of changes) {
            if (entry.type === "insert") {
                // Walk via nextSibling up to entry.length — a multi-block insert
                // covers entry.length top-level nodes at this position.
                let node = (entry as any).position.nodeAfter;
                for (let i = 0; i < (entry as any).length && node; i++) {
                    if (node.is("element")) {
                        for (const item of writer.createRangeOn(node).getItems()) {
                            if (item.is("element", "details") && ensureValid(item)) return true;
                        }
                    }
                    node = node.nextSibling;
                }
                // Also validate the receiving parent — e.g. dragging a <summary>
                // into a <details> that already has one gives us two summaries.
                const parent = (entry as any).position?.parent;
                if (parent?.is("element", "details") && ensureValid(parent)) return true;
            } else if (entry.type === "remove" || entry.type === "attribute") {
                const parent = (entry as any).position?.parent;
                if (parent?.is("element", "details") && ensureValid(parent)) return true;
            }
        }
        return false;
    }

    /**
     * Prevent the caret from sitting in the "gap" position directly inside a
     * <details> (between summary and a body block). Prefer the previous sibling
     * so the caret stays on the summary line when the block is collapsed.
     */
    private gapPostFixer(writer: any): boolean {
        const selection = this.editor.model.document.selection;
        // Only re-pin the caret — never collapse a user's multi-block selection.
        if (!selection.isCollapsed) return false;
        const position = selection.getFirstPosition();
        if (!position || !position.parent.is("element", "details")) return false;
        const details = position.parent;
        const before = position.offset > 0 ? details.getChild(position.offset - 1) : null;
        const after = details.getChild(position.offset);

        // If `before` is a nested <details>, landing at its "end" would just put us
        // in another gap (childCount). Dig one level deeper to its last child block.
        if (before?.is("element", "details") && before.childCount > 0) {
            const last = before.getChild(before.childCount - 1);
            if (last?.is("element")) {
                writer.setSelection(last, "end");
                return true;
            }
        }
        if (before?.is("element")) {
            writer.setSelection(before, "end");
            return true;
        }
        if (after?.is("element")) {
            writer.setSelection(after, 0);
            return true;
        }
        return false;
    }

    /**
     * Never let the caret rest inside a body whose enclosing <details> is
     * collapsed (so it doesn't disappear into hidden content, and so widget
     * toolbars don't trigger for invisible elements).
     */
    private hiddenBodyPostFixer(writer: any): boolean {
        const selection = this.editor.model.document.selection;
        // Only re-pin the caret — never collapse a user's multi-block selection.
        if (!selection.isCollapsed) return false;
        const position = selection.getFirstPosition();
        if (!position) return false;

        let outermostClosed: any = null;
        for (let node: any = position.parent; node; node = node.parent) {
            if (!node.is?.("element", "details")) continue;
            if (!this.isDetailsOpen(node)) outermostClosed = node;
        }
        if (!outermostClosed) return false;

        const summary = outermostClosed.getChild(0);
        if (!summary?.is("element", "summary")) return false;
        if (position.findAncestor("summary") === summary) return false;

        writer.setSelection(summary, "end");
        return true;
    }
}

/**
 * Render the toggle shortcut as `<kbd>Ctrl</kbd>+<kbd>Enter</kbd>` (or
 * `<kbd>⌃</kbd><kbd>↩</kbd>` on macOS). Uses the shared `formatShortcut` /
 * `joinShortcut` from `@triliumnext/commons` so key labels flow through the
 * same i18n and Mac-glyph rules as the rest of the app.
 */
function renderToggleShortcut(translate: TranslateFn): string {
    const kbdTokens = formatShortcut(TOGGLE_SHORTCUT, translate, env.isMac)
        .map((token: string) => `<kbd>${token}</kbd>`);
    return joinShortcut(kbdTokens, env.isMac);
}
