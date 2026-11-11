import {
    type ModelElement, type ModelPosition, MouseObserver, Plugin, type ViewDocumentDomEventData,
    type ViewDocumentMouseDownEvent, type ViewDocumentMouseOutEvent, type ViewDowncastWriter,
    type ViewElement
} from "ckeditor5";

import { MouseMoveObserver, type ViewDocumentMouseMoveEvent } from "../collapsible_list_items.js";
import CollapsibleHeadingsEditing from "./collapsible_headings_editing.js";
import { isOnHeadingArrow } from "./collapsible_headings_read_only.js";
import { CLASSES } from "./constants.js";
import { hasSection } from "./heading_sections.js";

/**
 * The arrow at the end of a heading that has blocks under it. It shows while the pointer is over
 * the heading or the caret is in it, and always while the heading is collapsed. A press on it
 * toggles the heading.
 */
export default class CollapsibleHeadingsUI extends Plugin {

    /** The heading under the pointer. */
    private hovered: ViewElement | null = null;
    private isArrowHovered = false;
    /** The heading with the caret in it. */
    private selected: ViewElement | null = null;

    static get pluginName() {
        return "CollapsibleHeadingsUI" as const;
    }

    static get requires() {
        return [ CollapsibleHeadingsEditing ] as const;
    }

    init() {
        const editor = this.editor;
        const view = editor.editing.view;
        view.addObserver(MouseObserver);
        view.addObserver(MouseMoveObserver);

        this.listenTo<ViewDocumentMouseDownEvent>(view.document, "mousedown", (evt, data) => {
            const heading = this.getHeadingAt(data);
            if (heading && heading.isOnArrow) {
                // Keeps the caret where it is.
                data.preventDefault();
                evt.stop();
                editor.plugins.get(CollapsibleHeadingsEditing).toggle(heading.model);
            }
        }, { priority: "high" });

        this.listenTo<ViewDocumentMouseMoveEvent>(view.document, "mousemove", (_evt, data) => {
            // A held button means a drag that selects text, which leaves the view alone.
            const heading = data.domEvent.buttons === 0 ? this.getHeadingAt(data) : null;
            this.setHovered(heading?.view ?? null, !!heading?.isOnArrow);
        });

        // The moves of the pointer stop at the edge of the editable.
        this.listenTo<ViewDocumentMouseOutEvent>(view.document, "mouseout", (_evt, data) => {
            const domRoot = view.getDomRoot() as HTMLElement;
            const movedTo = data.domEvent.relatedTarget;
            if (!(movedTo instanceof Node) || !domRoot.contains(movedTo)) {
                this.setHovered(null, false);
            }
        });

        view.document.registerPostFixer((writer) => this.markSelectedHeading(writer));
    }

    /**
     * The heading under the pointer of `data` when it has blocks under it, and whether the pointer
     * is on its arrow.
     */
    private getHeadingAt(data: ViewDocumentDomEventData<MouseEvent>) {
        const editing = this.editor.editing;
        const view = data.target.getAncestors({ includeSelf: true, parentFirst: true })
            .find((element) => element.is("element") && element.hasClass(CLASSES.sectionHeading)) as
            ViewElement | undefined;
        const model = view && editing.mapper.toModelElement(view);
        if (!view || !model || !hasSection(model)) {
            return null;
        }

        const domHeading = editing.view.domConverter.mapViewToDom(view) as HTMLElement;
        return { view, model, isOnArrow: isOnHeadingArrow(domHeading, data.domEvent.clientX) };
    }

    private setHovered(heading: ViewElement | null, isOnArrow: boolean) {
        if (heading === this.hovered && isOnArrow === this.isArrowHovered) {
            return;
        }

        const previous = this.hovered;
        this.hovered = heading;
        this.isArrowHovered = isOnArrow;
        this.editor.editing.view.change((writer) => {
            if (previous) {
                writer.removeClass([ CLASSES.hovered, CLASSES.arrowHovered ], previous);
            }
            if (heading) {
                writer.addClass(CLASSES.hovered, heading);
                if (isOnArrow) {
                    writer.addClass(CLASSES.arrowHovered, heading);
                }
            }
        });
    }

    /** Keeps a class on the heading with the caret in it, while the editor has the focus. */
    private markSelectedHeading(writer: ViewDowncastWriter): boolean {
        const editing = this.editor.editing;
        const position = this.editor.model.document.selection.getFirstPosition() as ModelPosition;
        const block = position.parent as ModelElement;
        const heading = editing.view.document.isFocused && hasSection(block)
            ? editing.mapper.toViewElement(block) as ViewElement
            : null;
        if (heading === this.selected) {
            return false;
        }

        if (this.selected) {
            writer.removeClass(CLASSES.selected, this.selected);
        }
        if (heading) {
            writer.addClass(CLASSES.selected, heading);
        }
        this.selected = heading;
        return true;
    }

}
