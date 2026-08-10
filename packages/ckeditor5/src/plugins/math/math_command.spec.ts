// Side-effect import: declares the `math` key on EditorConfig used by the editor config below.
import './math.js';

import { ClassicEditor, Bold, Paragraph, Typing, _getModelData as getData, _setModelData as setData } from 'ckeditor5';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import Math from './math.js';
import { getBalloonPositionData } from './utils.js';

const INLINE = 'mathtex-inline';
const DISPLAY = 'mathtex-display';

describe( 'MathCommand', () => {
	let editorElement: HTMLDivElement, editor: ClassicEditor;

	beforeEach( async () => {
		editorElement = document.createElement( 'div' );
		document.body.appendChild( editorElement );

		editor = await ClassicEditor.create( editorElement, {
			plugins: [ Math, Typing, Paragraph, Bold ],
			licenseKey: 'GPL',
			math: {
				engine: ( equation: string, element: HTMLElement ) => {
					element.innerHTML = equation;
				}
			}
		} );
	} );

	afterEach( async () => {
		editorElement.remove();
		await editor.destroy();
	} );

	function model() {
		return getData( editor.model, { withoutSelection: true } );
	}

	describe( 'refresh', () => {
		it( 'is enabled with a collapsed selection in a paragraph and reports no value', () => {
			setData( editor.model, '<paragraph>foo[]</paragraph>' );
			const command = editor.commands.get( 'math' );

			expect( command?.isEnabled ).toBe( true );
			expect( command?.value ).toBeNull();
			expect( command?.display ).toBe( false );
		} );

		it( 'reports the equation and display flag of a selected equation', () => {
			setData( editor.model, `<paragraph>[<${ INLINE } equation="x^2" type="script" display="false"></${ INLINE }>]</paragraph>` );
			const command = editor.commands.get( 'math' );

			expect( command?.value ).toBe( 'x^2' );
			expect( command?.display ).toBe( false );
			expect( command?.isEnabled ).toBe( true );
		} );

		it( 'reports display mode for a selected display equation', () => {
			setData( editor.model, `[<${ DISPLAY } equation="x^2" type="script" display="true"></${ DISPLAY }>]` );

			expect( editor.commands.get( 'math' )?.display ).toBe( true );
		} );
	} );

	describe( 'execute', () => {
		it( 'inserts a new inline equation at the selection', () => {
			setData( editor.model, '<paragraph>foo[]</paragraph>' );

			editor.execute( 'math', 'x^2', false, 'script' );

			expect( model() ).to.equal(
				`<paragraph>foo<${ INLINE } display="false" equation="x^2" type="script"></${ INLINE }></paragraph>`
			);
		} );

		it( 'inserts a new display equation', () => {
			setData( editor.model, '<paragraph>[]</paragraph>' );

			editor.execute( 'math', 'x^2', true, 'script' );

			expect( model() ).to.contain( `<${ DISPLAY } display="true" equation="x^2" type="script">` );
		} );

		it( 'inherits selection attributes such as bold', () => {
			setData( editor.model, '<paragraph><$text bold="true">foo[]</$text></paragraph>' );

			editor.execute( 'math', 'x^2', false, 'script' );

			expect( model() ).to.contain( 'bold="true"' );
		} );

		it( 'updates a selected equation, keeping its existing type', () => {
			setData( editor.model, `<paragraph>[<${ INLINE } equation="x^2" type="span" display="false"></${ INLINE }>]</paragraph>` );

			editor.execute( 'math', 'y^2', false, 'script' );

			expect( model() ).to.equal(
				`<paragraph><${ INLINE } display="false" equation="y^2" type="span"></${ INLINE }></paragraph>`
			);
		} );

		it( 'updates a selected equation and forces the output type when asked', () => {
			setData( editor.model, `<paragraph>[<${ INLINE } equation="x^2" type="span" display="false"></${ INLINE }>]</paragraph>` );

			editor.execute( 'math', 'y^2', false, 'script', true );

			expect( model() ).to.contain( 'type="script"' );
		} );

		it( 'falls back to the given output type when the selected equation has none', () => {
			setData( editor.model, `<paragraph>[<${ INLINE } equation="x^2" display="false"></${ INLINE }>]</paragraph>` );

			editor.execute( 'math', 'y^2', false, 'script' );

			expect( model() ).to.contain( 'type="script"' );
		} );

		it( 'converts a selected inline equation to a display one', () => {
			setData( editor.model, `<paragraph>[<${ INLINE } equation="x^2" type="script" display="false"></${ INLINE }>]</paragraph>` );

			editor.execute( 'math', 'x^2', true, 'script' );

			expect( model() ).to.contain( `<${ DISPLAY } display="true"` );
		} );
	} );
} );

describe( 'getBalloonPositionData', () => {
	let editorElement: HTMLDivElement, editor: ClassicEditor;

	beforeEach( async () => {
		editorElement = document.createElement( 'div' );
		document.body.appendChild( editorElement );

		editor = await ClassicEditor.create( editorElement, {
			plugins: [ Math, Typing, Paragraph ],
			licenseKey: 'GPL',
			math: {
				engine: ( equation: string, element: HTMLElement ) => {
					element.innerHTML = equation;
				}
			}
		} );
	} );

	afterEach( async () => {
		editorElement.remove();
		await editor.destroy();
	} );

	it( 'targets the DOM element of a selected equation widget', () => {
		setData( editor.model, `<paragraph>[<${ INLINE } equation="x^2" type="script" display="false"></${ INLINE }>]</paragraph>` );

		const { target, positions } = getBalloonPositionData( editor );

		expect( target ).toBeInstanceOf( HTMLElement );
		expect( positions ).toHaveLength( 3 );
	} );

	it( 'targets the selection range when no widget is selected', () => {
		setData( editor.model, '<paragraph>f[o]o</paragraph>' );

		const { target, positions } = getBalloonPositionData( editor );

		expect( target ).toBeInstanceOf( Range );
		expect( positions ).toHaveLength( 3 );
	} );

	it( 'throws when the view selection has no range at all', () => {
		setData( editor.model, '<paragraph>foo</paragraph>' );
		editor.editing.view.change( writer => {
			writer.setSelection( null );
		} );

		expect( () => getBalloonPositionData( editor ) ).toThrow( /math-missing-range/ );
	} );
} );
