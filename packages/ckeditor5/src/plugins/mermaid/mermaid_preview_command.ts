import { checkIsOn } from './utils.js';
import { Command, ModelElement } from 'ckeditor5';

/**
 * The mermaid preview command.
 *
 * Allows to switch to a preview mode.
 */
export default class MermaidPreviewCommand extends Command {

	override refresh() {
		const editor = this.editor;
		const documentSelection = editor.model.document.selection;
		const selectedElement = documentSelection.getSelectedElement();
		const isSelectedElementMermaid = selectedElement && selectedElement.name === 'mermaid';

		if ( isSelectedElementMermaid || documentSelection.getLastPosition()?.findAncestor( 'mermaid' ) ) {
			this.isEnabled = !!selectedElement;
		} else {
			this.isEnabled = false;
		}

		this.value = checkIsOn( editor, 'preview' );
	}

	override execute() {
		const editor = this.editor;
		const model = editor.model;
		const documentSelection = this.editor.model.document.selection;
		// `mermaid` is an object element, so the selection is always *on* it — never inside.
		const mermaidItem = documentSelection.getSelectedElement() as ModelElement | null;

		if (mermaidItem) {
			model.change( writer => {
				if ( mermaidItem.getAttribute( 'displayMode' ) !== 'preview' ) {
					writer.setAttribute( 'displayMode', 'preview', mermaidItem );
				}
			} );
		}
	}
}
