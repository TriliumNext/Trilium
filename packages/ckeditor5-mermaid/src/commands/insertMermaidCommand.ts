import { Command } from "ckeditor5";

/** The name under which {@link InsertMermaidCommand} is registered in the editor. */
export const INSERT_MERMAID_COMMAND = "insertMermaidCommand";

const MOCK_MERMAID_MARKUP = `flowchart TB
A --> B
B --> C`;

/**
 * The insert mermaid command.
 *
 * Allows to insert mermaid.
 */
export default class InsertMermaidCommand extends Command {

	override refresh() {
		const documentSelection = this.editor.model.document.selection;
		const selectedElement = documentSelection.getSelectedElement();

		if ( selectedElement && selectedElement.name === 'mermaid' ) {
			this.isEnabled = false;
		} else {
			this.isEnabled = true;
		}
	}

	override execute( options: { source?: string; displayMode?: string } = {} ) {
		const editor = this.editor;
		const model = editor.model;
		let mermaidItem;

		model.change( writer => {
			mermaidItem = writer.createElement( 'mermaid', {
				displayMode: options.displayMode ?? 'split',
				source: options.source ?? MOCK_MERMAID_MARKUP
			} );

			model.insertContent( mermaidItem );
		} );

		return mermaidItem;
	}
}
