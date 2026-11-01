import { Plugin, RemoveFormat } from "ckeditor5";

/**
 * A simple plugin that extends the remove format feature to consider links.
 */
export default class RemoveFormatLinksPlugin extends Plugin {

    static get requires() {
        return [ RemoveFormat ]
    }

    init() {
        // Extend the editor schema and mark the "linkHref" model attribute as formatting.
        this.editor.model.schema.setAttributeProperties( 'linkHref', {
            isFormatting: true
        });

        this.#clearLinkOnEmptiedBlock();
    }

    /**
     * Drops the `linkHref` attribute from the document selection when a deletion has just
     * emptied the block it sits in.
     *
     * `model.deleteContent()` re-applies the pre-delete *formatting* attributes to the
     * selection whenever the deletion leaves its parent block empty, so that typing carries
     * on in the same style (bold text stays bold). Marking `linkHref` as formatting above —
     * which is what makes "Remove format" strip links — opts it into that restore too, so
     * selecting a line holding only a link and deleting it left the selection (and the
     * block, via the stored `selection:linkHref` attribute) still inside the link. The line
     * looked empty but anything typed next became part of the old link (#10613).
     */
    #clearLinkOnEmptiedBlock() {
        const model = this.editor.model;

        this.listenTo( model, 'deleteContent', () => {
            const selection = model.document.selection;

            if ( !selection.isCollapsed || !selection.hasAttribute( 'linkHref' ) ) {
                return;
            }

            const block = selection.getFirstPosition()?.parent;
            if ( !block?.isEmpty ) {
                return;
            }

            // Nested inside the deletion's own change block, so this stays part of the same
            // undo step: a single undo brings the link back rather than only its attribute.
            model.change( writer => writer.removeSelectionAttribute( 'linkHref' ) );
        }, { priority: 'low' } );
    }

}
