// Side-effect import: declares the `math` key on EditorConfig used by the editor configs below.
import './math.js';

import { type ClassicEditor, ContextualBalloon, Paragraph, Typing, _setModelData as setData } from 'ckeditor5';
import { beforeEach, describe, expect, it } from 'vitest';

import Math from './math.js';
import MathLiveBalloon from './math_live_balloon.js';
import MathLiveEdit from './math_live_edit.js';
import { createTestEditor } from '../../../test/editor-kit.js';

const INLINE_WIDGET = '<mathtex-inline display="false" equation="x^2" type="span"></mathtex-inline>';

describe( 'MathLiveBalloon', () => {
	let editor: ClassicEditor;
	let balloon: ContextualBalloon;

	beforeEach( async () => {
		editor = await createTestEditor( [ Math, Paragraph, Typing ] );
		balloon = editor.plugins.get( ContextualBalloon );
	} );

	function domRoot(): HTMLElement {
		const root = editor.editing.view.getDomRoot();
		if ( !( root instanceof HTMLElement ) ) {
			throw new Error( 'missing editable DOM root' );
		}
		return root;
	}

	/** The balloon's visible text, or `null` when nothing of ours is in it. */
	function balloonText(): string | null {
		const view = balloon.visibleView;
		if ( !view || !( view.element instanceof HTMLElement ) ) {
			return null;
		}
		return view.element.classList.contains( 'ck-math-live-balloon' ) ? view.element.textContent : null;
	}

	async function startEditingSelected(): Promise<void> {
		editor.plugins.get( MathLiveEdit ).startEditing();
		await waitFor( () => domRoot().querySelector( 'math-field' ) );
	}

	it( 'is loaded by the Math glue plugin', () => {
		expect( editor.plugins.has( MathLiveBalloon ) ).toBe( true );
		expect( balloonText() ).toBeNull();
	} );

	it( 'shows while a field is live and hides once it is torn down', async () => {
		setData( editor.model, `<paragraph>foo[${ INLINE_WIDGET }]bar</paragraph>` );

		await startEditingSelected();
		expect( balloonText() ).toBe( 'Hello world' );

		// Escape commits the equation, which ends the session.
		domRoot().querySelector( 'math-field' )?.dispatchEvent(
			new KeyboardEvent( 'keydown', { key: 'Escape', bubbles: true, cancelable: true } ) );

		expect( balloonText() ).toBeNull();
	} );

	it( 'comes back for a second edit, reusing the same view', async () => {
		setData( editor.model, `<paragraph>foo[${ INLINE_WIDGET }]bar</paragraph>` );

		await startEditingSelected();
		const first = balloon.visibleView;
		domRoot().querySelector( 'math-field' )?.dispatchEvent(
			new KeyboardEvent( 'keydown', { key: 'Escape', bubbles: true, cancelable: true } ) );
		expect( balloonText() ).toBeNull();

		await startEditingSelected();
		expect( balloonText() ).toBe( 'Hello world' );
		expect( balloon.visibleView ).toBe( first );
	} );

	it( 'swallows mousedown, so clicking it does not blur the field and end the session', async () => {
		setData( editor.model, `<paragraph>foo[${ INLINE_WIDGET }]bar</paragraph>` );

		await startEditingSelected();
		const element = balloon.visibleView?.element;
		if ( !( element instanceof HTMLElement ) ) {
			throw new Error( 'the balloon view is not rendered' );
		}

		const event = new MouseEvent( 'mousedown', { bubbles: true, cancelable: true } );
		element.dispatchEvent( event );

		expect( event.defaultPrevented ).toBe( true );
		expect( balloonText() ).toBe( 'Hello world' );
	} );

	it( 'hides when the session is aborted because the widget disappeared', async () => {
		setData( editor.model, `<paragraph>foo[${ INLINE_WIDGET }]bar</paragraph>` );

		await startEditingSelected();
		editor.model.change( writer => {
			const paragraph = editor.model.document.getRoot()?.getChild( 0 );
			if ( paragraph?.is( 'element' ) ) {
				const widget = Array.from( paragraph.getChildren() ).find( child => child.is( 'element', 'mathtex-inline' ) );
				if ( widget ) {
					writer.remove( widget );
				}
			}
		} );

		expect( balloonText() ).toBeNull();
	} );

	it( 'is pinned to the field, so it survives destroying the editor mid-session', async () => {
		setData( editor.model, `<paragraph>foo[${ INLINE_WIDGET }]bar</paragraph>` );

		await startEditingSelected();
		await editor.destroy();
	} );
} );

async function waitFor<T>( check: () => T | null | undefined, timeout = 4000 ): Promise<T> {
	const start = performance.now();
	for ( ;; ) {
		const result = check();
		if ( result ) {
			return result;
		}
		if ( performance.now() - start > timeout ) {
			throw new Error( 'waitFor timed out' );
		}
		await new Promise( resolve => setTimeout( resolve, 25 ) );
	}
}
