// Side-effect import: declares the `math` key on EditorConfig used by the editor configs below.
import './math.js';

import katex from 'katex';
import { ClassicEditor, Essentials, Locale, Paragraph, _setModelData as setModelData } from 'ckeditor5';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { createTestEditor } from '../../../test/editor-kit.js';
import MainFormView from './main_form_view.js';
import Math from './math.js';
import MathEditing from './math_editing.js';

const INLINE = 'mathtex-inline';
const DISPLAY = 'mathtex-display';

describe( 'MainFormView', () => {
	const globals = window as unknown as { katex: typeof katex };

	function createFormView( previewEnabled: boolean ) {
		globals.katex = katex;
		return new MainFormView(
			new Locale(),
			{
				engine: 'katex',
				lazyLoad: undefined,
				previewUid: `preview-form-${ previewEnabled }`,
				previewClassName: [],
				katexRenderOptions: {}
			},
			previewEnabled,
			[]
		);
	}

	describe( 'with the preview enabled', () => {
		let view: MainFormView;

		beforeEach( () => {
			view = createFormView( true );
			view.render();
			document.body.appendChild( view.element as HTMLElement );
		} );

		it( 'builds a preview view', () => {
			expect( view.mathView ).not.toBeUndefined();
		} );

		it( 'reads the equation back from the input', () => {
			view.equation = 'x^2';

			expect( view.equation ).toBe( 'x^2' );
		} );

		it( 'strips delimiters typed into the input and flips the display switch', () => {
			view.mathInputView.value = '\\[x^2\\]';

			expect( view.mathInputView.value ).toBe( 'x^2' );
			expect( view.displayButtonView.isOn ).toBe( true );
		} );

		it( 'keeps an undelimited equation as typed', () => {
			view.mathInputView.value = 'x^2';

			expect( view.mathInputView.value ).toBe( 'x^2' );
			expect( view.displayButtonView.isOn ).toBe( false );
		} );

		it( 'mirrors the equation into the preview', () => {
			view.mathInputView.value = 'x^2';

			expect( view.mathView?.value ).toBe( 'x^2' );
		} );

		it( 'toggles the display switch when it is executed', () => {
			expect( view.displayButtonView.isOn ).toBe( false );

			view.displayButtonView.fire( 'execute' );

			expect( view.displayButtonView.isOn ).toBe( true );
		} );

		it( 'focuses its first focusable on focus()', () => {
			expect( () => view.focus() ).not.toThrow();
		} );

		it( 'reports an empty equation when the input holds nothing', () => {
			view.mathInputView.value = null;

			expect( view.equation ).toBe( '' );
		} );

		it( 'clears the input when the delimiters wrap nothing', () => {
			view.mathInputView.value = '\\[\\]';

			expect( view.mathInputView.value ).toBeNull();
			expect( view.displayButtonView.isOn ).toBe( true );
		} );

		it( 'handles the input being cleared', () => {
			view.mathInputView.value = 'x^2';

			view.mathInputView.value = null;

			expect( view.mathView?.value ).toBe( '' );
		} );
	} );

	describe( 'with the preview disabled', () => {
		it( 'builds no preview view and still tracks the equation', () => {
			const view = createFormView( false );
			view.render();
			document.body.appendChild( view.element as HTMLElement );

			expect( view.mathView ).toBeUndefined();

			view.mathInputView.value = 'x^2';
			expect( view.equation ).toBe( 'x^2' );

			// The equation setter has to cope with there being no preview to update.
			view.equation = 'y^2';
			expect( view.mathInputView.value ).toBe( 'y^2' );

			view.element?.remove();
			view.destroy();
		} );
	} );
} );

describe( 'MathCommand on a display equation', () => {
	let editor: ClassicEditor;

	beforeEach( async () => {
		editor = await createTestEditor( [ Essentials, Paragraph, Math ], {
			math: {
				engine: ( equation: string, element: HTMLElement ) => {
					element.innerHTML = equation;
				}
			}
		} as never );
	} );

	it( 'updates a selected display equation in place', () => {
		setModelData( editor.model, `[<${ DISPLAY } equation="x^2" type="span" display="true"></${ DISPLAY }>]` );

		editor.execute( 'math', 'y^2', true, 'script' );

		// The existing `span` type is kept because forceOutputType was not requested.
		expect( editor.getData() ).toContain( '\\[y^2\\]' );
	} );

	it( 'maps a view position inside an equation widget back to the model', () => {
		setModelData( editor.model, `<paragraph>[<${ INLINE } equation="x^2" type="script" display="false"></${ INLINE }>]</paragraph>` );

		const modelElement = editor.model.document.getRoot()?.getChild( 0 );
		const viewElement = modelElement?.is( 'element' ) ?
			editor.editing.mapper.toViewElement( modelElement ) :
			undefined;
		if ( !viewElement ) {
			throw new Error( 'Expected the paragraph to be mapped to the view.' );
		}

		// Exercises the viewToModelPosition callback MathEditing installs.
		const position = editor.editing.mapper.toModelPosition(
			editor.editing.view.createPositionAt( viewElement, 0 )
		);

		expect( position.parent.is( 'element' ) ).toBe( true );
		expect( editor.plugins.get( MathEditing ) ).toBeInstanceOf( MathEditing );
	} );
} );
