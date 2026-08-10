// Side-effect import: declares the `math` key on EditorConfig used by the editor configs below.
import './math.js';

import katex from 'katex';
import { ClassicEditor, ContextualBalloon, Essentials, keyCodes, Paragraph, _setModelData as setModelData } from 'ckeditor5';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { createTestEditor } from '../../../test/editor-kit.js';
import Math from './math.js';
import MathUI from './math_ui.js';

const INLINE = 'mathtex-inline';

/**
 * Covers the MathUI paths the legacy suite leaves out: the balloon's own keystrokes, closing
 * behaviour, the click-to-reopen handler and the preview element's lifecycle.
 */
describe( 'MathUI interactions', () => {
	let editor: ClassicEditor;
	let ui: MathUI;

	beforeEach( async () => {
		// The preview element is only built by the katex/mathjax render paths — a custom engine
		// callback is handed the target element directly and never creates one.
		( window as unknown as { katex: typeof katex } ).katex = katex;

		editor = await createTestEditor( [ Essentials, Paragraph, Math ], {
			math: { engine: 'katex' }
		} as never );

		ui = editor.plugins.get( MathUI );
		const balloon = editor.plugins.get( ContextualBalloon );
		vi.spyOn( balloon.view, 'attachTo' ).mockReturnValue( false );
		vi.spyOn( balloon.view, 'pin' ).mockReturnValue();
		editor.editing.view.document.isFocused = true;
	} );

	/** This plugin instance's own preview element (the page is shared across specs). */
	function previewElement(): HTMLElement | null {
		const uid = ( ui as unknown as { _previewUid: string } )._previewUid;
		return document.getElementById( uid );
	}

	function formView() {
		const view = ui.formView;
		if ( !view ) {
			throw new Error( 'The form view was not created.' );
		}
		return view;
	}

	describe( 'the Enter keystroke on the form', () => {
		it( 'submits the equation', () => {
			setModelData( editor.model, '<paragraph>f[o]o</paragraph>' );
			ui._showUI();
			formView().mathInputView.value = 'x^2';

			const executeSpy = vi.spyOn( editor, 'execute' );
			formView().keystrokes.press( {
				keyCode: keyCodes.enter,
				shiftKey: false,
				preventDefault: vi.fn(),
				stopPropagation: vi.fn()
			} as never );

			expect( executeSpy.mock.lastCall?.slice( 0, 2 ) ).toMatchObject( [ 'math', 'x^2' ] );
		} );

		it( 'leaves Shift+Enter alone so it can insert a newline', () => {
			setModelData( editor.model, '<paragraph>f[o]o</paragraph>' );
			ui._showUI();
			formView().mathInputView.value = 'x^2';

			const executeSpy = vi.spyOn( editor, 'execute' );
			formView().keystrokes.press( {
				keyCode: keyCodes.enter,
				shiftKey: true,
				preventDefault: vi.fn(),
				stopPropagation: vi.fn()
			} as never );

			expect( executeSpy ).not.toHaveBeenCalledWith( 'math', expect.anything(), expect.anything(), expect.anything(), expect.anything() );
		} );
	} );

	describe( 'closing the form', () => {
		it( 'only removes the form when the command already holds an equation', () => {
			setModelData( editor.model, `<paragraph>[<${ INLINE } equation="x^2" type="script" display="false"></${ INLINE }>]</paragraph>` );
			ui._showUI();

			const hideSpy = vi.spyOn( ui, '_hideUI' );
			formView().fire( 'cancel' );

			// The command has a value, so the balloon keeps the rest of its stack.
			expect( hideSpy ).not.toHaveBeenCalled();
		} );

		it( 'hides the whole UI when the command has no equation', () => {
			setModelData( editor.model, '<paragraph>f[o]o</paragraph>' );
			ui._showUI();

			const hideSpy = vi.spyOn( ui, '_hideUI' );
			formView().fire( 'cancel' );

			expect( hideSpy ).toHaveBeenCalled();
		} );

		it( 'does nothing when the form was never shown', () => {
			setModelData( editor.model, `<paragraph>[<${ INLINE } equation="x^2" type="script" display="false"></${ INLINE }>]</paragraph>` );

			// The command holds a value, so cancelling routes to _removeFormView — which has to
			// cope with the form not being in the balloon at all.
			expect( () => formView().fire( 'cancel' ) ).not.toThrow();
		} );
	} );

	describe( 'clicking an existing equation', () => {
		it( 'reopens the form', () => {
			setModelData( editor.model, `<paragraph>[<${ INLINE } equation="x^2" type="script" display="false"></${ INLINE }>]</paragraph>` );
			const showSpy = vi.spyOn( ui, '_showUI' );

			editor.editing.view.document.fire( 'click' );

			expect( showSpy ).toHaveBeenCalled();
		} );

		it( 'does nothing when the selection holds no equation', () => {
			setModelData( editor.model, '<paragraph>f[o]o</paragraph>' );
			const showSpy = vi.spyOn( ui, '_showUI' );

			editor.editing.view.document.fire( 'click' );

			expect( showSpy ).not.toHaveBeenCalled();
		} );
	} );

	describe( 'the preview element', () => {
		it( 'is reused rather than duplicated when the form is shown again', () => {
			setModelData( editor.model, `<paragraph>[<${ INLINE } equation="x^2" type="script" display="false"></${ INLINE }>]</paragraph>` );
			ui._showUI();

			expect( document.querySelectorAll( `[id="${ ( ui as unknown as { _previewUid: string } )._previewUid }"]` ) ).toHaveLength( 1 );

			// Re-show: the preview exists now, so _addFormView refreshes it rather than building
			// a second one.
			ui._hideUI();
			ui._showUI();

			expect( document.querySelectorAll( `[id="${ ( ui as unknown as { _previewUid: string } )._previewUid }"]` ) ).toHaveLength( 1 );
		} );

		it( 'is removed from the document when the plugin is destroyed', async () => {
			setModelData( editor.model, `<paragraph>[<${ INLINE } equation="x^2" type="script" display="false"></${ INLINE }>]</paragraph>` );
			ui._showUI();

			expect( previewElement() ).not.toBeNull();

			await editor.destroy();

			expect( previewElement() ).toBeNull();
		} );
	} );
} );
