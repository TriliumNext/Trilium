import { Plugin, Enter, Delete, enableViewPlaceholder, getEnvKeystrokeText, type ViewDocumentEnterEvent, type ViewDocumentDeleteEvent, type ViewDocumentArrowKeyEvent } from "ckeditor5";
import { Tooltip } from "bootstrap";
import BlockDragHandle from "./block-drag-handle.js";
import CollapsibleCommand from "./collapsible-command.js";

type TranslateFn = (key: string, params?: Record<string, unknown>) => string;

/**
 * Schema, conversion and key handling for collapsible blocks.
 *
 * Model:        <details><summary>title</summary>…blocks…</details>
 * Data view:    <details class="trilium-collapsible"><summary>…</summary>…</details>
 * Editing view: same, plus a custom arrow UIElement in the summary for toggling.
 *               The DOM `open` attribute is the source of truth for collapsed state
 *               and is intentionally not persisted in the model — everything loads
 *               collapsed; freshly-inserted blocks (including those re-created by
 *               redo) are opened by the differ-driven listener below.
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
    private autoOpenTimer?: ReturnType<typeof setTimeout>;
    private dragHandle!: BlockDragHandle;
    /**
     * Pre-move open state for details that are about to be re-inserted via
     * drag. Consulted by the auto-open differ listener so a collapsed block
     * stays collapsed after being moved (instead of being unconditionally
     * opened like a freshly-inserted one).
     */
    private readonly preserveOpenOnNextInsert = new Map<any, boolean>();
    /** Summary DOM elements that currently have a Bootstrap tooltip attached. */
    private readonly summaryTooltips = new Set<HTMLElement>();
    /** The summary tooltip we currently have force-shown because the caret is inside it. */
    private caretShownTooltip?: HTMLElement;
    /** Drag-handle DOM elements that currently have a Bootstrap tooltip attached. */
    private readonly handleTooltips = new Set<HTMLElement>();

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
            },
            beforeMove: (model) => {
                if (model?.is?.("element", "details")) {
                    this.preserveOpenOnNextInsert.set(model, this.isDetailsOpen(model));
                }
            }
        });
        this.registerSchema();
        this.registerConversion();
        this.registerBodyPlaceholder();
        this.registerKeyHandlers();
        this.registerClickHandler();
        this.registerDomListeners();
        this.registerAutoOpenNewDetails();
        this.registerPostFixers();
        this.registerSummaryTooltips();
        this.registerHandleTooltips();
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
        if (this.autoOpenTimer !== undefined) {
            clearTimeout(this.autoOpenTimer);
            this.autoOpenTimer = undefined;
        }
        for (const summary of this.summaryTooltips) {
            Tooltip.getInstance(summary)?.dispose();
        }
        this.summaryTooltips.clear();
        this.caretShownTooltip = undefined;
        for (const handle of this.handleTooltips) {
            Tooltip.getInstance(handle)?.dispose();
        }
        this.handleTooltips.clear();
        this.dragHandle?.cancel();
        this.preserveOpenOnNextInsert.clear();
        super.destroy();
    }

    // -----------------------------------------------------------------
    // Schema & conversion
    // -----------------------------------------------------------------

    private registerSchema() {
        const schema = this.editor.model.schema;
        schema.register("details", { inheritAllFrom: "$container" });
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
        conversion.for("editingDowncast").elementToElement({ model: "details", view: detailsView });

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
            const resolveDetails = () => {
                const detailsDom = span.closest("details");
                if (!detailsDom) return null;
                const view = editor.editing.view.domConverter.mapDomToView(detailsDom);
                return view ? editor.editing.mapper.toModelElement(view as any) : null;
            };
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
            const toggle = () => {
                const details = span.closest("details");
                if (details) details.open = !details.open;
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

    /** True if the <details> is currently expanded (or no DOM mapping yet). */
    private isDetailsOpen(model: any): boolean {
        const dom = this.getDom<HTMLDetailsElement>(model);
        return !dom || dom.open;
    }

    /** Toggle the DOM `open` attribute directly (the source of truth in this plugin). */
    private setDetailsOpen(model: any, open: boolean) {
        const dom = this.getDom<HTMLDetailsElement>(model);
        if (dom) dom.open = open;
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

        // If the title is currently collapsed and we'll need to expand it (middle-
        // of-title split), do it now — before model.change runs and the hidden-body
        // post-fixer gets a chance to snap the caret out of the new body paragraph.
        const willSplit = !selection.isCollapsed
            ? false  // selection will be deleted first, then the new collapsed position determines branch
            : !selection.getLastPosition()!.isAtStart && !selection.getLastPosition()!.isAtEnd;
        if (willSplit && !this.isDetailsOpen(details)) {
            this.setDetailsOpen(details, true);
        }

        model.change(writer => {
            // Drop any non-collapsed selection so we operate on a single position.
            if (!selection.isCollapsed) {
                model.deleteContent(selection);
            }
            const position = selection.getLastPosition()!;

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

            // Middle of title: split. If we entered this branch via the selection-
            // delete path (rather than `willSplit` above), expand now too.
            if (!this.isDetailsOpen(details)) {
                this.setDetailsOpen(details, true);
            }
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
            const dom = this.getDom<HTMLDetailsElement>(details);
            if (!dom) return;
            dom.open = !dom.open;
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

    private onDetailsToggle(event: Event) {
        const editor = this.editor;
        const detailsDom = event.target as HTMLDetailsElement;
        if (detailsDom.tagName?.toLowerCase() !== "details") return;
        if (!detailsDom.classList.contains("trilium-collapsible")) return;

        // Keep the arrow's aria-expanded in sync regardless of who flipped `open`.
        const arrow = detailsDom.querySelector(":scope > summary > .trilium-collapsible-arrow");
        arrow?.setAttribute("aria-expanded", String(detailsDom.open));

        if (detailsDom.open) return;

        const detailsView = editor.editing.view.domConverter.mapDomToView(detailsDom);
        const detailsModel = detailsView ? editor.editing.mapper.toModelElement(detailsView as any) : null;
        if (!detailsModel) return;

        const summary = detailsModel.getChild(0);
        if (!summary?.is("element", "summary")) return;

        const position = editor.model.document.selection.getFirstPosition();
        if (!position) return;

        // Already in the toggled block's own summary — caret is still visible.
        if (position.findAncestor("summary") === summary) return;

        // The caret only needs to move if it's inside the toggled details
        // (could be many levels deep — e.g. a nested collapsible's body or its
        // summary; both get hidden when the outer one collapses).
        let isInside = false;
        for (let node: any = position.parent; node; node = node.parent) {
            if (node === detailsModel) { isInside = true; break; }
        }
        if (!isInside) return;

        editor.model.change(writer => writer.setSelection(summary, "end"));
    }

    // -----------------------------------------------------------------
    // Auto-open freshly-inserted collapsibles
    // -----------------------------------------------------------------

    /**
     * The editing downcast emits <details> closed by default so loaded documents
     * stay collapsed. We do want freshly-inserted collapsibles to open, though —
     * via the toolbar, via paste, and importantly via *redo* (which re-applies
     * the insert and would otherwise leave the redone block closed because the
     * one-shot `setTimeout` from `CollapsibleCommand.execute` has already run).
     *
     * Watching the differ for new <details> insertions after the editor is
     * `ready` covers all three paths uniformly and survives undo/redo.
     */
    private registerAutoOpenNewDetails() {
        const editor = this.editor;
        let ready = false;
        // Trilium loads note content via `editor.setData(...)` after the editor
        // is ready, so the change:data that follows is a wholesale data load —
        // not user-initiated insertions. Bracket the entire setData call with
        // `loading=true/false` (highest fires before the data is written,
        // lowest after everything setData triggered synchronously) so every
        // change:data that fires inside is covered — not just the first one.
        // The CKEditor public API doesn't guarantee setData emits exactly one
        // change:data, so a single-shot flag would leak follow-ups.
        let loading = false;
        // Accumulate across `change:data` events: if two events fire in the
        // same tick (separate model transactions), each restarting the timer
        // would otherwise drop the previous batch on the floor.
        const pendingOpen = new Set<any>();

        this.listenTo(editor, "ready", () => { ready = true; });
        this.listenTo(editor.data, "set", () => { loading = true; }, { priority: "highest" });
        this.listenTo(editor.data, "set", () => { loading = false; }, { priority: "lowest" });

        this.listenTo(editor.model.document, "change:data", () => {
            if (loading) return;
            if (!ready) return;
            for (const entry of editor.model.document.differ.getChanges()) {
                if (entry.type !== "insert") continue;
                // A single insert entry can cover multiple top-level nodes (e.g. a
                // multi-block paste). Walk via nextSibling up to entry.length so
                // every inserted <details> gets queued for auto-open, not just the
                // first one at the entry's position.
                let node = (entry as any).position?.nodeAfter;
                for (let i = 0; i < (entry as any).length && node; i++) {
                    if (node.is?.("element", "details")) pendingOpen.add(node);
                    node = node.nextSibling;
                }
            }
            if (pendingOpen.size === 0) return;

            // Defer to the next tick so the editing view has rendered the new
            // DOM elements. Replace any in-flight timer so destroy can cancel.
            // The accumulated `pendingOpen` survives the restart.
            if (this.autoOpenTimer !== undefined) clearTimeout(this.autoOpenTimer);
            this.autoOpenTimer = setTimeout(() => {
                this.autoOpenTimer = undefined;
                if ((editor as any).state === "destroyed") {
                    pendingOpen.clear();
                    this.preserveOpenOnNextInsert.clear();
                    return;
                }
                for (const node of pendingOpen) {
                    const dom = this.getDom<HTMLDetailsElement>(node);
                    if (!dom) continue;
                    // A move (drag-and-drop) records as remove + insert; restore the
                    // pre-move open state so a collapsed block stays collapsed.
                    // Fresh inserts have no entry here and default to open.
                    if (this.preserveOpenOnNextInsert.has(node)) {
                        dom.open = this.preserveOpenOnNextInsert.get(node)!;
                        this.preserveOpenOnNextInsert.delete(node);
                    } else {
                        dom.open = true;
                    }
                }
                pendingOpen.clear();
            }, 0);
        });
    }

    // -----------------------------------------------------------------
    // Summary tooltip (Bootstrap, screen-corner hint)
    // -----------------------------------------------------------------

    /**
     * Attach a Bootstrap tooltip to every <summary> DOM element so hovering or
     * focusing the title pops up a "click the arrow or press Ctrl+Enter" hint
     * in the screen corner (the same UX as the todo-list multistate plugin).
     */
    private registerSummaryTooltips() {
        const editor = this.editor;
        const t = this.translate();

        this.listenTo(editor.editing.view, "render", () => {
            // 1. Reap tooltips whose summaries CKEditor has detached. Doing this
            //    FIRST (a) frees the references so GC can collect them and
            //    (b) keeps `summaryTooltips.size` honest for the fast-path below.
            let cleaned = false;
            for (const summary of this.summaryTooltips) {
                if (!summary.isConnected) {
                    Tooltip.getInstance(summary)?.dispose();
                    this.summaryTooltips.delete(summary);
                    if (this.caretShownTooltip === summary) this.caretShownTooltip = undefined;
                    cleaned = true;
                }
            }

            // 2. Collect current summaries from the DOM.
            const currentSummaries: HTMLElement[] = [];
            this.forEachDomRoot(root => {
                for (const s of root.querySelectorAll<HTMLElement>("details.trilium-collapsible > summary")) {
                    currentSummaries.push(s);
                }
            });

            // 3. Fast-path: nothing was reaped AND the count still matches the
            //    tracked set — no work to do. This covers the typical keystroke
            //    render where nothing about the summary set has changed.
            if (!cleaned && currentSummaries.length === this.summaryTooltips.size) return;

            // 4. Wire up tooltips on newly-appeared summaries.
            for (const summary of currentSummaries) {
                if (this.summaryTooltips.has(summary)) continue;
                const title = t("text-editor.collapsible-tooltip", {
                    shortcut: getEnvKeystrokeText("Ctrl+Enter")
                });
                new Tooltip(summary, { title, customClass: "text-editor-content-tooltip" });
                this.summaryTooltips.add(summary);
            }
        });

        // The caret moving into a <summary> doesn't fire DOM focus (the editable
        // root keeps focus), so Bootstrap's focus trigger won't notice. Manually
        // show/hide the tooltip on model-selection changes so the hint also
        // appears when the user navigates into the title via keyboard or click.
        this.listenTo(editor.model.document.selection, "change:range", () => {
            const summaryModel = editor.model.document.selection.getFirstPosition()?.findAncestor("summary");
            const targetDom = summaryModel ? this.getDom<HTMLElement>(summaryModel) : null;

            // No-op when the target hasn't changed (selection moves on every keystroke
            // while typing in the summary; re-calling show() retriggers the animation).
            if (this.caretShownTooltip === targetDom) return;

            if (this.caretShownTooltip) {
                Tooltip.getInstance(this.caretShownTooltip)?.hide();
                this.caretShownTooltip = undefined;
            }
            if (targetDom) {
                Tooltip.getInstance(targetDom)?.show();
                this.caretShownTooltip = targetDom;
            }
        });
    }

    /**
     * Attach a plain Bootstrap tooltip (default near-element placement, no
     * screen-corner styling) to each drag handle so hover/focus surfaces the
     * "Drag to reposition" hint. Tracked in a Set and reaped on view render
     * the same way summary tooltips are.
     */
    private registerHandleTooltips() {
        const editor = this.editor;
        const t = this.translate();

        this.listenTo(editor.editing.view, "render", () => {
            let cleaned = false;
            for (const handle of this.handleTooltips) {
                if (!handle.isConnected) {
                    Tooltip.getInstance(handle)?.dispose();
                    this.handleTooltips.delete(handle);
                    cleaned = true;
                }
            }

            const current: HTMLElement[] = [];
            this.forEachDomRoot(root => {
                for (const h of root.querySelectorAll<HTMLElement>(".trilium-collapsible-handle")) {
                    current.push(h);
                }
            });

            if (!cleaned && current.length === this.handleTooltips.size) return;

            for (const handle of current) {
                if (this.handleTooltips.has(handle)) continue;
                new Tooltip(handle, {
                    title: t("text-editor.collapsible-handle-tooltip")
                });
                this.handleTooltips.add(handle);
            }
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
            const dom = this.getDom<HTMLDetailsElement>(node);
            if (dom && !dom.open) outermostClosed = node;
        }
        if (!outermostClosed) return false;

        const summary = outermostClosed.getChild(0);
        if (!summary?.is("element", "summary")) return false;
        if (position.findAncestor("summary") === summary) return false;

        writer.setSelection(summary, "end");
        return true;
    }
}
