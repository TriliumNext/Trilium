// Switching an equation between its inline and its display form, the way the image feature
// switches between `imageInline` and `imageBlock`: the two forms are separate schema items — an
// inline object living among text, and a block object — so the change replaces the element
// rather than flipping an attribute on it.
import { Command, type Editor, type ModelElement, type ModelPosition, type ModelSchema } from 'ckeditor5';
import MathLiveEdit from './math_live_edit.js';
import { getSelectedMathModelWidget } from './utils.js';

/** The two element names an equation can take; `display` mirrors the choice as an attribute. */
export type MathElementName = 'mathtex-inline' | 'mathtex-display';

export default class MathTypeCommand extends Command {
	declare public value: boolean;

	private readonly _modelElementName: MathElementName;

	constructor( editor: Editor, modelElementName: MathElementName ) {
		super( editor );
		this._modelElementName = modelElementName;

		// An in-place session leaves the model selection wherever the caret walked in from, so a
		// plain model change is not the only thing that can change what this command points at.
		if ( editor.plugins.has( MathLiveEdit ) ) {
			const mathLiveEdit = editor.plugins.get( MathLiveEdit );
			this.listenTo( mathLiveEdit, 'sessionStart', () => this.refresh() );
			this.listenTo( mathLiveEdit, 'sessionEnd', () => this.refresh() );
		}
	}

	/**
	 * Unlike `imageTypeInline`/`imageTypeBlock`, which disable themselves once the image already
	 * has the requested type, both directions stay enabled and the current one reports `value`.
	 * The buttons are a pair of toggles showing which form the equation is in, so the active one
	 * has to stay lit rather than grey out.
	 */
	public override refresh(): void {
		const element = getActiveMathElement( this.editor );

		this.value = element?.name === this._modelElementName;
		this.isEnabled = !!element && canPlace(
			this.editor.model.schema,
			this.editor.model.createPositionBefore( element ),
			this._modelElementName
		);
	}

	/**
	 * Replaces the equation with one of the requested form, keeping the LaTeX and every other
	 * attribute the schema still allows.
	 *
	 * @returns The new element, or `null` when there was nothing to convert.
	 */
	public override execute(): ModelElement | null {
		const model = this.editor.model;
		const element = getActiveMathElement( this.editor );

		// A disabled command never gets this far — `Command` stops its own `execute` event — so
		// the position checked in `refresh()` is known to be good here.
		if ( !element || element.name === this._modelElementName ) {
			return null;
		}

		return model.change( writer => {
			const newElement = writer.createElement( this._modelElementName, {
				...Object.fromEntries( element.getAttributes() ),
				display: this._modelElementName === 'mathtex-display'
			} );

			// `insertObject` on a selection over the old element replaces it, splits the
			// surrounding block when a block equation lands mid-paragraph, wraps an inline one in
			// a paragraph where only blocks are allowed, and drops attributes the new form does
			// not allow (`fontBackgroundColor` on a display equation).
			model.insertObject( newElement, model.createSelection( element, 'on' ), null, {
				setSelection: 'on'
			} );

			return newElement;
		} );
	}
}

/**
 * The equation the command acts on: the one being edited in place if a field is mounted,
 * otherwise the selected widget. Both matter — walking into an equation with the arrow keys
 * mounts a field without ever selecting the widget in the model.
 */
function getActiveMathElement( editor: Editor ): ModelElement | null {
	if ( editor.plugins.has( MathLiveEdit ) ) {
		const edited = editor.plugins.get( MathLiveEdit ).editedElement;
		if ( edited ) {
			return edited;
		}
	}
	return getSelectedMathModelWidget( editor.model.document.selection );
}

/**
 * Whether an element of that name can end up at the position — directly, or inside a paragraph
 * that the insertion would create for it. Mirrors the image feature's `isImageTypePlaceable`,
 * spelled out with public API rather than its `@internal` paragraphing helper.
 */
function canPlace( schema: ModelSchema, position: ModelPosition, name: MathElementName ): boolean {
	if ( schema.findAllowedParent( position, name ) ) {
		return true;
	}

	const context = schema.createContext( position );
	return schema.checkChild( context, 'paragraph' ) && schema.checkChild( context.push( 'paragraph' ), name );
}
