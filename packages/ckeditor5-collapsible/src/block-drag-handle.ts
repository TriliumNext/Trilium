import type { Editor } from "ckeditor5";

export interface BlockDragHandleOptions {
    editor: Editor;
    /** className for the drop indicator drawn between blocks while dragging. */
    indicatorClass: string;
    /**
     * Re-route a model element under the cursor to a different target before
     * before/after is decided — e.g. a hit on a <summary> redirects to its
     * parent <details>. Return the same model to keep it as-is, or a new one
     * to retarget.
     */
    refineTarget?: (model: any) => any;
    /** Invoked when the user clicks the handle without dragging past the threshold. */
    onClick?: (model: any) => void;
}

interface DragState {
    model: any;
    startX: number;
    startY: number;
    started: boolean;
    indicator: HTMLElement | null;
    root: HTMLElement;
    onMove: (e: MouseEvent) => void;
    onUp: (e: MouseEvent) => void;
}

/**
 * Custom mouse-based drag for moving a model block to a new position. Bypasses
 * the HTML5 drag API (and therefore CKEditor's clipboard pipeline, which would
 * otherwise intercept `drop` and try to paste the drag payload at the cursor).
 *
 * Usage: instantiate once per plugin, call `start(x, y, model, root)` from a
 * mousedown handler on the block's drag handle, and `cancel()` from the
 * plugin's destroy().
 */
export default class BlockDragHandle {

    private dragState: DragState | null = null;

    constructor(private readonly opts: BlockDragHandleOptions) {}

    /**
     * Begin tracking a potential drag. We don't yet commit to "this is a drag"
     * — that decision happens in `onMove` once the cursor crosses a small
     * threshold; below the threshold a quick mousedown/mouseup is treated as
     * a click and invokes `onClick`.
     */
    public start(x: number, y: number, model: any, root: HTMLElement): void {
        this.cancel();
        const onMove = (e: MouseEvent) => this.onMove(e);
        const onUp = (e: MouseEvent) => this.onUp(e);
        this.dragState = {
            model, startX: x, startY: y, started: false, indicator: null, root, onMove, onUp
        };
        const doc = root.ownerDocument;
        doc.addEventListener("mousemove", onMove, true);
        doc.addEventListener("mouseup", onUp, true);
    }

    /** Cancel any active drag. Safe to call when no drag is in progress. */
    public cancel(): void {
        const state = this.dragState;
        if (!state) return;
        state.indicator?.remove();
        const doc = state.root.ownerDocument;
        doc.removeEventListener("mousemove", state.onMove, true);
        doc.removeEventListener("mouseup", state.onUp, true);
        this.dragState = null;
    }

    private onMove(e: MouseEvent): void {
        const state = this.dragState;
        if (!state) return;
        if (!state.started) {
            const dx = e.clientX - state.startX;
            const dy = e.clientY - state.startY;
            // 4px² threshold — below it tiny mouse jitter shouldn't pop the indicator.
            if (dx * dx + dy * dy < 16) return;
            state.started = true;
            const indicator = state.root.ownerDocument.createElement("div");
            indicator.className = this.opts.indicatorClass;
            state.root.ownerDocument.body.appendChild(indicator);
            state.indicator = indicator;
        }
        const target = this.findDropTarget(e.clientX, e.clientY, state.root);
        const dom = target ? this.getDom(target.model) : null;
        if (!target || !dom || !state.indicator) {
            if (state.indicator) state.indicator.style.display = "none";
            return;
        }
        const rect = dom.getBoundingClientRect();
        const top = target.before ? rect.top : rect.bottom;
        state.indicator.style.display = "block";
        state.indicator.style.left = `${rect.left}px`;
        state.indicator.style.top = `${top - 1}px`;
        state.indicator.style.width = `${rect.width}px`;
    }

    private onUp(e: MouseEvent): void {
        const state = this.dragState;
        if (!state) return;
        this.cancel();
        if (!state.started) {
            this.opts.onClick?.(state.model);
            return;
        }
        const target = this.findDropTarget(e.clientX, e.clientY, state.root);
        if (!target || target.model === state.model) return;
        // Reject drops into the dragged block's own subtree (would create a cycle).
        for (let node: any = target.model; node; node = node.parent) {
            if (node === state.model) return;
        }
        this.opts.editor.model.change(writer => {
            const pos = target.before
                ? writer.createPositionBefore(target.model)
                : writer.createPositionAfter(target.model);
            writer.move(writer.createRangeOn(state.model), pos);
        });
    }

    /**
     * Map a viewport coordinate to a model insertion target. Walks up the DOM
     * from the point to find a block-level element that maps to a model
     * element, then decides "drop before" vs "drop after" based on the
     * cursor's vertical position relative to the target's midpoint. Falls back
     * to the nearest top-level child when the cursor lands in margin/empty
     * space.
     */
    private findDropTarget(x: number, y: number, root: HTMLElement): { model: any, before: boolean } | null {
        let el: HTMLElement | null = root.ownerDocument.elementFromPoint(x, y) as HTMLElement | null;
        while (el && el !== root) {
            const view = this.opts.editor.editing.view.domConverter.mapDomToView(el);
            let model = view ? this.opts.editor.editing.mapper.toModelElement(view as any) : null;
            let rectEl: HTMLElement = el;
            if (model && this.opts.refineTarget) {
                const refined = this.opts.refineTarget(model);
                if (refined && refined !== model) {
                    model = refined;
                    const refinedDom = this.getDom(refined);
                    if (refinedDom) rectEl = refinedDom;
                }
            }
            if (model?.is?.("element") && model.parent) {
                const rect = rectEl.getBoundingClientRect();
                return { model, before: y < rect.top + rect.height / 2 };
            }
            el = el.parentElement;
        }

        // The cursor is over root margins / inter-block whitespace / past the
        // last block. Fall back to the nearest top-level child by vertical
        // distance so drops always land somewhere sensible.
        let closest: { model: any, distance: number, before: boolean } | null = null;
        for (const child of Array.from(root.children) as HTMLElement[]) {
            const view = this.opts.editor.editing.view.domConverter.mapDomToView(child);
            const model = view ? this.opts.editor.editing.mapper.toModelElement(view as any) : null;
            if (!model?.is?.("element") || !model.parent) continue;
            const rect = child.getBoundingClientRect();
            const distance = y < rect.top ? rect.top - y : y > rect.bottom ? y - rect.bottom : 0;
            if (!closest || distance < closest.distance) {
                closest = { model, distance, before: y < rect.top + rect.height / 2 };
            }
        }
        return closest;
    }

    private getDom(model: any): HTMLElement | null {
        const view = this.opts.editor.editing.mapper.toViewElement(model);
        const dom = view ? this.opts.editor.editing.view.domConverter.viewToDom(view) : null;
        return dom instanceof HTMLElement ? dom : null;
    }
}
