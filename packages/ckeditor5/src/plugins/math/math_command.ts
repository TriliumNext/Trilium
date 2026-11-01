import { Command } from 'ckeditor5';
import { getSelectedMathModelWidget } from './utils.js';

export default class MathCommand extends Command {
	public override value: string | null = null;
	public override execute(
		equation: string,
		display?: boolean,
		outputType: 'script' | 'span' = 'script',
		forceOutputType?: boolean
	): void {
		const model = this.editor.model;
		const selection = model.document.selection;
		const selectedElement = selection.getSelectedElement();

		model.change( writer => {
			let mathtex;
			if (
				selectedElement &&
				( selectedElement.is( 'element', 'mathtex-inline' ) ||
					selectedElement.is( 'element', 'mathtex-display' ) )
			) {
				// Update selected element
				const typeAttr = selectedElement.getAttribute( 'type' );

				// Use already set type if found and is not forced
				const type = forceOutputType ?
					outputType :
					typeAttr || outputType;

				mathtex = writer.createElement(
					display ? 'mathtex-display' : 'mathtex-inline',
					{
						...Object.fromEntries(selection.getAttributes()),
						equation,
						type,
						display
					}
				);
			} else {
				const selection = this.editor.model.document.selection;

				// Create new model element
				mathtex = writer.createElement(
					display ? 'mathtex-display' : 'mathtex-inline',
					{
						// Inherit all attributes from selection (e.g. color, background color, size).
						...Object.fromEntries(selection.getAttributes()),
						equation,
						type: outputType,
						display,
					}
				);
			}
			model.insertContent( mathtex );
		} );
	}

	public display = false;

	public override refresh(): void {
		const model = this.editor.model;
		const selection = model.document.selection;
		const selectedElement = selection.getSelectedElement();

		this.isEnabled =
			selectedElement === null ||
			selectedElement.is( 'element', 'mathtex-inline' ) ||
			selectedElement.is( 'element', 'mathtex-display' );

		const selectedEquation = getSelectedMathModelWidget( selection );
		const value = selectedEquation?.getAttribute( 'equation' );
		this.value = typeof value === 'string' ? value : null;
		const display = selectedEquation?.getAttribute( 'display' );
		this.display = typeof display === 'boolean' ? display : false;
	}
}
