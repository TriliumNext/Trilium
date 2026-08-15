// Side-effect import: declares the `math` key on EditorConfig used by the editor configs below.
import './math.js';

import {
	type ButtonView,
	type ClassicEditor,
	ContextualBalloon,
	Paragraph,
	type ToolbarView,
	Typing,
	_getModelData as getData,
	_setModelData as setData
} from 'ckeditor5';
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

	/** The balloon's toolbar, or `null` when nothing of ours is in it. */
	function visibleToolbar(): ToolbarView | null {
		const view = balloon.visibleView;
		if ( !view || !( view.element instanceof HTMLElement ) ) {
			return null;
		}
		return view.element.classList.contains( 'ck-math-live-balloon' ) ? view as ToolbarView : null;
	}

	function buttons(): Array<ButtonView> {
		const toolbar = visibleToolbar();
		if ( !toolbar ) {
			throw new Error( 'the balloon is not showing' );
		}
		return Array.from( toolbar.items ) as Array<ButtonView>;
	}

	async function startEditingSelected(): Promise<void> {
		editor.plugins.get( MathLiveEdit ).startEditing();
		await waitFor( () => domRoot().querySelector( 'math-field' ) );
	}

	it( 'is loaded by the Math glue plugin', () => {
		expect( editor.plugins.has( MathLiveBalloon ) ).toBe( true );
		expect( visibleToolbar() ).toBeNull();
	} );

	it( 'shows while a field is live and hides once it is torn down', async () => {
		setData( editor.model, `<paragraph>foo[${ INLINE_WIDGET }]bar</paragraph>` );

		await startEditingSelected();
		expect( visibleToolbar() ).not.toBeNull();

		// Escape commits the equation, which ends the session.
		domRoot().querySelector( 'math-field' )?.dispatchEvent(
			new KeyboardEvent( 'keydown', { key: 'Escape', bubbles: true, cancelable: true } ) );

		expect( visibleToolbar() ).toBeNull();
	} );

	it( 'offers the two type toggles, with the equation\'s current form lit', async () => {
		setData( editor.model, `<paragraph>foo[${ INLINE_WIDGET }]bar</paragraph>` );

		await startEditingSelected();
		const [ inline, display ] = buttons();

		expect( buttons() ).toHaveLength( 2 );
		expect( inline.label ).toBe( 'Inline equation' );
		expect( display.label ).toBe( 'Display equation' );
		expect( inline.icon ).toBeTruthy();
		expect( display.icon ).toBeTruthy();
		expect( inline.isOn ).toBe( true );
		expect( display.isOn ).toBe( false );
		expect( inline.isEnabled ).toBe( true );
		expect( display.isEnabled ).toBe( true );
	} );

	it( 'switches the equation to display and carries the edit over to it', async () => {
		setData( editor.model, `<paragraph>foo[${ INLINE_WIDGET }]bar</paragraph>` );

		await startEditingSelected();
		buttons()[ 1 ].fire( 'execute' );

		expect( getData( editor.model ) ).toContain( '<mathtex-display' );

		// The field was pulled out with the old element; editing resumes on the new one.
		await waitFor( () => domRoot().querySelector( 'math-field' ) );
		const [ inline, display ] = buttons();
		expect( inline.isOn ).toBe( false );
		expect( display.isOn ).toBe( true );
	} );

	it( 'switches back to inline', async () => {
		setData( editor.model, `<paragraph>foo[${ INLINE_WIDGET }]bar</paragraph>` );

		await startEditingSelected();
		buttons()[ 1 ].fire( 'execute' );
		await waitFor( () => domRoot().querySelector( 'math-field' ) );
		buttons()[ 0 ].fire( 'execute' );

		expect( getData( editor.model ) ).toContain( '<mathtex-inline' );
		await waitFor( () => domRoot().querySelector( 'math-field' ) );
		expect( buttons()[ 0 ].isOn ).toBe( true );
	} );

	it( 'a toggle for the form the equation already has changes nothing', async () => {
		setData( editor.model, `<paragraph>foo[${ INLINE_WIDGET }]bar</paragraph>` );

		await startEditingSelected();
		const before = getData( editor.model );
		buttons()[ 0 ].fire( 'execute' );

		expect( getData( editor.model ) ).toBe( before );
		// No conversion means no re-entry: the original field is still the live one.
		expect( domRoot().querySelector( 'math-field' ) ).not.toBeNull();
	} );

	it( 'comes back for a second edit, reusing the same view', async () => {
		setData( editor.model, `<paragraph>foo[${ INLINE_WIDGET }]bar</paragraph>` );

		await startEditingSelected();
		const first = balloon.visibleView;
		domRoot().querySelector( 'math-field' )?.dispatchEvent(
			new KeyboardEvent( 'keydown', { key: 'Escape', bubbles: true, cancelable: true } ) );
		expect( visibleToolbar() ).toBeNull();

		await startEditingSelected();
		expect( visibleToolbar() ).not.toBeNull();
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
		expect( visibleToolbar() ).not.toBeNull();
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

		expect( visibleToolbar() ).toBeNull();
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
