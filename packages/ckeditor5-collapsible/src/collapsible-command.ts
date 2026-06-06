import { Command } from "ckeditor5";

/**
 * Inserts a new collapsible block (<details><summary>…</summary>…</details>) at the
 * current selection. The summary becomes the editable title; the body holds whatever
 * was selected (wrapped into block-level children) or a single empty paragraph if
 * the selection is collapsed. May contain any block content (including nested
 * collapsibles). After insertion the caret is placed in the empty title.
 */
export default class CollapsibleCommand extends Command {

    declare public value: boolean;

    public override refresh(): void {
        // This command is a pure insert, not a toggle — running it again inside an
        // existing collapsible would create a nested one (and re-running to "remove"
        // would lose formatting). Keep `value` false so the toolbar button never
        // shows as active.
        this.value = false;
        this.isEnabled = this.checkEnabled();
    }

    public override execute(): void {
        const editor = this.editor;
        const model = editor.model;
        const selection = model.document.selection;

        model.change(writer => {
            // Clone the selected content up front (does not modify the document).
            const fragment = !selection.isCollapsed ? model.getSelectedContent(selection) : null;

            const details = writer.createElement("details");
            const summary = writer.createElement("summary");
            writer.append(summary, details);

            if (fragment) {
                // Append fragment children as body content. Inline runs (e.g. text from
                // an intra-block selection) get wrapped in a paragraph so the body only
                // contains block-level children, as the schema requires. A <details>
                // captured by the selection range is unwrapped — taking only its body
                // content — so the new collapsible doesn't gain an unintended extra
                // level of nesting around what the user actually selected.
                let pending: any[] = [];
                const flushPending = () => {
                    if (!pending.length) return;
                    // Skip whitespace-only runs — wrapping invisible whitespace in a
                    // paragraph just litters the body.
                    const hasContent = pending.some(n =>
                        n.is?.("element") || (n.is?.("$text") && /\S/.test(n.data ?? ""))
                    );
                    if (!hasContent) { pending = []; return; }
                    const p = writer.createElement("paragraph");
                    for (const n of pending) writer.append(n, p);
                    writer.append(p, details);
                    pending = [];
                };
                const appendToBody = (element: any) => {
                    if (element.is("element", "details")) {
                        for (const grandchild of [...element.getChildren()]) {
                            if (grandchild.is("element", "summary")) continue;
                            appendToBody(grandchild);
                        }
                    } else {
                        writer.append(element, details);
                    }
                };
                for (const child of [...fragment.getChildren()]) {
                    // `child.is("element")` is true for inline elements too (soft breaks,
                    // inline widgets, …), and dropping those directly under <details>
                    // violates its block-only schema. Gate on isBlock so they fall through
                    // to `pending` and get wrapped in the next flushed paragraph.
                    if (child.is("element") && model.schema.isBlock(child)) {
                        flushPending();
                        appendToBody(child);
                    } else {
                        pending.push(child);
                    }
                }
                flushPending();
            }

            // Ensure the body has at least one block.
            if (details.childCount === 1) {
                writer.append(writer.createElement("paragraph"), details);
            }

            if (fragment) {
                model.deleteContent(selection);
            }
            model.insertContent(details);

            // Place the cursor inside the summary so the user can immediately type a title.
            // The CollapsibleEditing plugin's auto-open listener will expand the new
            // <details> on the next render (and again on redo).
            writer.setSelection(summary, 0);
        });
    }

    private checkEnabled(): boolean {
        const model = this.editor.model;
        const firstPosition = model.document.selection.getFirstPosition();
        if (!firstPosition) {
            return false;
        }
        return !!model.schema.findAllowedParent(firstPosition, "details");
    }
}
