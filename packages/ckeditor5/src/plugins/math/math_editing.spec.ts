// Side-effect import: declares the `math` key on EditorConfig used by the editor configs below.
import './math.js';

import { ClassicEditor, CodeBlock, Paragraph, Typing, _getModelData as getData, _setModelData as setData } from 'ckeditor5';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import Math from './math.js';
import MathEditing from './math_editing.js';

const INLINE = 'mathtex-inline';
const DISPLAY = 'mathtex-display';

describe( 'MathEditing', () => {
	let editorElement: HTMLDivElement, editor: ClassicEditor;

	async function createEditor( mathConfig: Record<string, unknown> = {} ) {
		editorElement = document.createElement( 'div' );
		document.body.appendChild( editorElement );

		return ClassicEditor.create( editorElement, {
			plugins: [ Math, Typing, Paragraph, CodeBlock ],
			licenseKey: 'GPL',
			math: {
				engine: ( equation: string, element: HTMLElement ) => {
					element.innerHTML = equation;
				},
				...mathConfig
			}
		} );
	}

	beforeEach( async () => {
		editor = await createEditor();
	} );

	afterEach( async () => {
		editorElement.remove();
		await editor.destroy();
	} );

	it( 'has proper name and requirements', () => {
		expect( MathEditing.pluginName ).to.equal( 'MathEditing' );
		expect( editor.plugins.get( MathEditing ) ).to.instanceOf( MathEditing );
	} );

	it( 'registers the math command', () => {
		expect( editor.commands.get( 'math' ) ).toBeDefined();
	} );

	describe( 'schema', () => {
		it( 'allows an inline equation wherever text is allowed', () => {
			expect( editor.model.schema.checkChild( [ '$root', 'paragraph' ], INLINE ) ).toBe( true );
		} );

		it( 'allows a display equation as a block', () => {
			expect( editor.model.schema.checkChild( [ '$root' ], DISPLAY ) ).toBe( true );
		} );

		it( 'forbids an inline equation inside a code block', () => {
			expect( editor.model.schema.checkChild( [ '$root', 'codeBlock' ], INLINE ) ).toBe( false );
		} );

		it( 'marks both equation elements as objects', () => {
			expect( editor.model.schema.isObject( INLINE ) ).toBe( true );
			expect( editor.model.schema.isObject( DISPLAY ) ).toBe( true );
			expect( editor.model.schema.isInline( INLINE ) ).toBe( true );
		} );
	} );

	describe( 'upcast', () => {
		it( 'reads a MathJax inline script', () => {
			editor.setData( '<p><script type="math/tex">\\sqrt{x}</script></p>' );

			expect( getData( editor.model, { withoutSelection: true } ) ).to.equal(
				`<paragraph><${ INLINE } display="false" equation="\\sqrt{x}" type="script"></${ INLINE }></paragraph>`
			);
		} );

		it( 'reads a MathJax display script', () => {
			editor.setData( '<script type="math/tex; mode=display">\\sqrt{x}</script>' );

			expect( getData( editor.model, { withoutSelection: true } ) ).to.equal(
				`<${ DISPLAY } display="true" equation="\\sqrt{x}" type="script"></${ DISPLAY }>`
			);
		} );

		it( 'ignores a MathJax script with no text child', () => {
			editor.setData( '<p><script type="math/tex"></script></p>' );

			expect( getData( editor.model, { withoutSelection: true } ) ).to.not.contain( INLINE );
		} );

		it( 'ignores a display MathJax script with no text child', () => {
			editor.setData( '<script type="math/tex; mode=display"></script>' );

			expect( getData( editor.model, { withoutSelection: true } ) ).to.not.contain( DISPLAY );
		} );

		it( 'reads the CKEditor 4 span form, inline', () => {
			editor.setData( '<p><span class="math-tex">\\(\\sqrt{x}\\)</span></p>' );

			expect( getData( editor.model, { withoutSelection: true } ) ).to.equal(
				`<paragraph><${ INLINE } display="false" equation="\\sqrt{x}" type="span"></${ INLINE }></paragraph>`
			);
		} );

		it( 'reads the CKEditor 4 span form, display', () => {
			editor.setData( '<p><span class="math-tex">\\[\\sqrt{x}\\]</span></p>' );

			expect( getData( editor.model, { withoutSelection: true } ) ).to.contain( `${ DISPLAY } display="true"` );
		} );

		it( 'restores line breaks smuggled through the data processor', () => {
			editor.setData( '<p><span class="math-tex">\\(a\nb\\)</span></p>' );

			expect( getData( editor.model, { withoutSelection: true } ) ).to.contain( 'a\nb' );
		} );

		it( 'ignores a math-tex span with no text child', () => {
			editor.setData( '<p><span class="math-tex"></span></p>' );

			expect( getData( editor.model, { withoutSelection: true } ) ).to.not.contain( INLINE );
		} );

		it( 'reads the Quill ql-formula form', () => {
			editor.setData( '<p><span class="ql-formula" data-value="\\sqrt{x}"></span></p>' );

			expect( getData( editor.model, { withoutSelection: true } ) ).to.equal(
				`<paragraph><${ INLINE } display="false" equation="\\sqrt{x}" type="script"></${ INLINE }></paragraph>`
			);
		} );

		it( 'throws when a ql-formula carries no equation', () => {
			expect( () => editor.setData( '<p><span class="ql-formula"></span></p>' ) )
				.toThrow( /missing-equation/ );
		} );

		describe( 'with forceOutputType', () => {
			beforeEach( async () => {
				editorElement.remove();
				await editor.destroy();
				editor = await createEditor( { forceOutputType: true, outputType: 'span' } );
			} );

			it( 'overrides the type of a MathJax inline script', () => {
				editor.setData( '<p><script type="math/tex">x</script></p>' );

				expect( getData( editor.model, { withoutSelection: true } ) ).to.contain( 'type="span"' );
			} );

			it( 'overrides the type of a MathJax display script', () => {
				editor.setData( '<script type="math/tex; mode=display">x</script>' );

				expect( getData( editor.model, { withoutSelection: true } ) ).to.contain( 'type="span"' );
			} );

			it( 'overrides the type of a CKEditor 4 span', () => {
				editor.setData( '<p><span class="math-tex">\\(x\\)</span></p>' );

				expect( getData( editor.model, { withoutSelection: true } ) ).to.contain( 'type="span"' );
			} );

			it( 'overrides the type of a Quill formula', () => {
				editor.setData( '<p><span class="ql-formula" data-value="x"></span></p>' );

				expect( getData( editor.model, { withoutSelection: true } ) ).to.contain( 'type="span"' );
			} );
		} );
	} );

	describe( 'data downcast', () => {
		it( 'writes a script tag for an inline script-type equation', () => {
			setData( editor.model, `<paragraph><${ INLINE } equation="x^2" type="script" display="false"></${ INLINE }></paragraph>` );

			expect( editor.getData() ).to.equal( '<p><script type="math/tex">x^2</script></p>' );
		} );

		it( 'writes a display script tag for a display equation', () => {
			setData( editor.model, `<${ DISPLAY } equation="x^2" type="script" display="true"></${ DISPLAY }>` );

			expect( editor.getData() ).to.equal( '<script type="math/tex; mode=display">x^2</script>' );
		} );

		it( 'writes a math-tex span with inline delimiters for a span-type equation', () => {
			setData( editor.model, `<paragraph><${ INLINE } equation="x^2" type="span" display="false"></${ INLINE }></paragraph>` );

			expect( editor.getData() ).to.equal( '<p><span class="math-tex">\\(x^2\\)</span></p>' );
		} );

		it( 'writes a math-tex span with display delimiters for a display span-type equation', () => {
			setData( editor.model, `<${ DISPLAY } equation="x^2" type="span" display="true"></${ DISPLAY }>` );

			expect( editor.getData() ).to.equal( '<span class="math-tex">\\[x^2\\]</span>' );
		} );

		it( 'throws when the model element carries no equation', () => {
			setData( editor.model, `<paragraph><${ INLINE } type="script" display="false"></${ INLINE }></paragraph>` );

			expect( () => editor.getData() ).toThrow( /missing-equation/ );
		} );
	} );

	describe( 'editing downcast', () => {
		it( 'renders an inline equation as an inline widget', () => {
			setData( editor.model, `<paragraph><${ INLINE } equation="x^2" type="script" display="false"></${ INLINE }></paragraph>` );

			const rendered = editorElement.nextElementSibling?.querySelector( '.ck-math-tex-inline' );
			expect( rendered ).not.toBeNull();
			expect( rendered?.tagName ).toBe( 'SPAN' );
		} );

		it( 'renders a display equation as a block widget', () => {
			setData( editor.model, `<${ DISPLAY } equation="x^2" type="script" display="true"></${ DISPLAY }>` );

			const rendered = editorElement.nextElementSibling?.querySelector( '.ck-math-tex-display' );
			expect( rendered ).not.toBeNull();
			expect( rendered?.tagName ).toBe( 'DIV' );
		} );

		it( 'passes the equation through the configured engine', () => {
			setData( editor.model, `<paragraph><${ INLINE } equation="x^2" type="script" display="false"></${ INLINE }></paragraph>` );

			expect( editorElement.nextElementSibling?.textContent ).to.contain( 'x^2' );
		} );
	} );
} );
