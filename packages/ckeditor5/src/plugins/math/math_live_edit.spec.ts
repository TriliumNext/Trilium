// Side-effect import: declares the `math` key on EditorConfig used by the editor configs below.
import './math.js';

import { type ClassicEditor, Paragraph, Typing, _getModelData as getData, _setModelData as setData } from 'ckeditor5';
import { beforeEach, describe, expect, it } from 'vitest';

import Math from './math.js';
import MathLiveEdit from './math_live_edit.js';
import { createTestEditor } from '../../../test/editor-kit.js';

const INLINE_WIDGET = '<mathtex-inline display="false" equation="x^2" type="span"></mathtex-inline>';
const DISPLAY_WIDGET = '<mathtex-display display="true" equation="e=mc^2" type="span"></mathtex-display>';

describe( 'MathLiveEdit', () => {
	let editor: ClassicEditor;
	let plugin: MathLiveEdit;

	beforeEach( async () => {
		editor = await createTestEditor( [ Math, Paragraph, Typing ] );
		plugin = editor.plugins.get( MathLiveEdit );
	} );

	function domRoot(): HTMLElement {
		const root = editor.editing.view.getDomRoot();
		if ( !( root instanceof HTMLElement ) ) {
			throw new Error( 'missing editable DOM root' );
		}
		return root;
	}

	function findMathField(): MathFieldLike | null {
		return domRoot().querySelector( 'math-field' ) as MathFieldLike | null;
	}

	async function startEditingSelected(): Promise<MathFieldLike> {
		plugin.startEditing();
		return waitFor( findMathField );
	}

	it( 'renders an equation widget as static MathLive markup', async () => {
		setData( editor.model, `<paragraph>foo[]${ INLINE_WIDGET }bar</paragraph>` );

		const preview = await waitFor( () =>
			domRoot().querySelector( '.ck-math-widget-preview [class*="ML__"]' ) );
		expect( preview ).not.toBeNull();
	} );

	it( 'startEditing mounts a math-field inside the selected widget and hides the preview', async () => {
		setData( editor.model, `<paragraph>foo[${ INLINE_WIDGET }]bar</paragraph>` );

		const mathfield = await startEditingSelected();
		expect( mathfield.value ).toBe( 'x^2' );

		const preview = domRoot().querySelector( '.ck-math-widget-preview' );
		expect( preview?.classList.contains( 'ck-hidden' ) ).toBe( true );
	} );

	it( 'startEditing without a selected equation inserts an empty one', async () => {
		setData( editor.model, '<paragraph>foo[]bar</paragraph>' );

		const mathfield = await startEditingSelected();
		expect( mathfield.value ).toBe( '' );
		expect( getData( editor.model ) ).toContain( '<mathtex-inline' );
	} );

	it( 'edits in the field sync to the model after the debounce', async () => {
		setData( editor.model, `<paragraph>foo[${ INLINE_WIDGET }]bar</paragraph>` );

		const mathfield = await startEditingSelected();
		mathfield.value = 'x^3';
		mathfield.dispatchEvent( new Event( 'input' ) );

		await waitFor( () => getData( editor.model ).includes( 'equation="x^3"' ) || null );
	} );

	it( 'Escape commits, unmounts the field and restores the preview', async () => {
		setData( editor.model, `<paragraph>foo[${ INLINE_WIDGET }]bar</paragraph>` );

		const mathfield = await startEditingSelected();
		mathfield.value = 'x^3';
		mathfield.dispatchEvent( new KeyboardEvent( 'keydown', { key: 'Escape', bubbles: true, cancelable: true } ) );

		expect( findMathField() ).toBeNull();
		expect( getData( editor.model ) ).toContain( 'equation="x^3"' );
		expect( domRoot().querySelector( '.ck-math-widget-preview' )?.classList.contains( 'ck-hidden' ) ).toBe( false );
	} );

	it( 'committing an emptied equation removes the widget', async () => {
		setData( editor.model, `<paragraph>foo[${ INLINE_WIDGET }]bar</paragraph>` );

		const mathfield = await startEditingSelected();
		mathfield.value = '';
		mathfield.dispatchEvent( new KeyboardEvent( 'keydown', { key: 'Escape', bubbles: true, cancelable: true } ) );

		expect( findMathField() ).toBeNull();
		expect( getData( editor.model ) ).not.toContain( '<mathtex-inline' );
	} );

	it( 'ArrowRight in front of an equation walks into it instead of selecting the widget', async () => {
		setData( editor.model, `<paragraph>foo[]${ INLINE_WIDGET }bar</paragraph>` );

		domRoot().dispatchEvent( keyEvent( 'ArrowRight', 39 ) );

		const mathfield = await waitFor( findMathField );
		expect( mathfield.value ).toBe( 'x^2' );
	} );

	it( 'ArrowRight from the previous paragraph enters an equation at the start of the next', async () => {
		// Crossing the block boundary fake-selects the widget (a Widget-plugin default). The
		// next press used to skip past the equation instead of entering it: the fake-selected
		// state bubbles through the isWidget context, which the entry handler did not cover.
		setData( editor.model, `<paragraph>foo[]</paragraph><paragraph>${ INLINE_WIDGET }</paragraph>` );

		domRoot().dispatchEvent( keyEvent( 'ArrowRight', 39 ) );
		await new Promise( resolve => setTimeout( resolve, 100 ) );
		expect( findMathField() ).toBeNull();
		expect( getData( editor.model ) ).toContain( '[<mathtex-inline' );

		domRoot().dispatchEvent( keyEvent( 'ArrowRight', 39 ) );
		const mathfield = await waitFor( findMathField );
		expect( mathfield.value ).toBe( 'x^2' );
	} );

	it( 'ArrowLeft after an equation walks into it', async () => {
		setData( editor.model, `<paragraph>foo${ INLINE_WIDGET }[]bar</paragraph>` );

		domRoot().dispatchEvent( keyEvent( 'ArrowLeft', 37 ) );

		await waitFor( findMathField );
	} );

	it( 'exiting with ArrowRight through MathLive\'s real keystroke pipeline does not crash', async () => {
		// Two adjacent equations, as in the original report. The crash did not need the second
		// one, but walking out towards another widget is the harshest ordering.
		setData( editor.model, `<paragraph>foo[${ INLINE_WIDGET }]<mathtex-inline display="false" equation="y" type="span"></mathtex-inline>bar</paragraph>` );

		const mathfield = await startEditingSelected();
		// Let the mount's rAF place focus and the caret before dispatching.
		await new Promise( resolve => requestAnimationFrame( resolve ) );

		const errors: Array<unknown> = [];
		const onError = ( event: ErrorEvent ) => {
			// Browser-generated and benign: an observer's notifications spilling into the next
			// frame. Not a MathLive crash, which is what these listeners are here to catch.
			if ( String( event.message ).includes( 'ResizeObserver loop' ) ) {
				event.preventDefault();
				return;
			}
			errors.push( event.error ?? event.message );
			event.preventDefault();
		};
		window.addEventListener( 'error', onError );

		try {
			// Dispatching a keydown on the shadow keyboard sink runs MathLive's own
			// onKeystroke → moveToNextChar, which fires `move-out` mid-pipeline — the exact
			// path that used to crash with "this.mathfield is undefined" when the listener
			// unmounted the field synchronously.
			mathfield.position = mathfield.lastOffset;
			const sink = mathfield.shadowRoot?.querySelector( '[part=keyboard-sink]' );
			expect( sink ).not.toBeNull();
			sink?.dispatchEvent( new KeyboardEvent( 'keydown', {
				key: 'ArrowRight', code: 'ArrowRight', bubbles: true, composed: true, cancelable: true
			} ) );

			// The teardown is deferred past the keystroke task; wait for it.
			await waitFor( () => ( findMathField() === null ? true : null ) );
		} finally {
			window.removeEventListener( 'error', onError );
		}

		expect( errors ).toEqual( [] );
		// The caret ended up between the two equations.
		expect( getData( editor.model ) ).toMatch( /<\/mathtex-inline>\[\]<mathtex-inline/ );
	} );

	it( 'recovers when MathLive holds a stale focused field that was disposed without a blur', async () => {
		// The Firefox crash, reproduced: a <math-field> that held focus was torn down without
		// MathLive observing a blur (Firefox delivers no blur event when a focused element is
		// removed), so MathLive's module-global focus bookkeeping keeps pointing at the disposed
		// internals. Focusing the NEXT field then calls onBlur() on them:
		// "TypeError: this.mathfield is undefined" in atomToString/getValue.
		// Chrome blurs before detaching, so the dirty state cannot arise from real removal here;
		// instead dispose the internals directly — what disconnectedCallback does — with no DOM
		// change for Chrome to blur on. That is exactly the state Firefox leaves behind.
		const { loadMathLive } = await import( './mathlive_loader.js' );
		expect( await loadMathLive() ).toBe( true );

		const stale = document.createElement( 'math-field' ) as MathFieldLike;
		document.body.appendChild( stale );
		stale.focus();
		await waitFor( () => ( document.activeElement === stale ? true : null ) );
		// Let MathLive's 60ms focusBlurInProgress latch clear, as at human typing speed.
		await new Promise( resolve => setTimeout( resolve, 120 ) );
		( stale as unknown as { _mathfield: { dispose(): void } } )._mathfield.dispose();

		const errors: Array<unknown> = [];
		const onError = ( event: ErrorEvent ) => {
			// Browser-generated and benign: an observer's notifications spilling into the next
			// frame. Not a MathLive crash, which is what these listeners are here to catch.
			if ( String( event.message ).includes( 'ResizeObserver loop' ) ) {
				event.preventDefault();
				return;
			}
			errors.push( event.error ?? event.message );
			event.preventDefault();
		};
		window.addEventListener( 'error', onError );

		try {
			// Mounting and focusing a session field must survive the stale bookkeeping.
			setData( editor.model, `<paragraph>foo[${ INLINE_WIDGET }]bar</paragraph>` );
			const mathfield = await startEditingSelected();
			await waitFor( () => ( document.activeElement === mathfield ? true : null ) );
		} finally {
			window.removeEventListener( 'error', onError );
			// The host still references the manually disposed internals; disconnectedCallback
			// would call getValue() on them and crash, so detach the reference first — the same
			// null-out it performs itself after a normal disposal.
			( stale as unknown as { _mathfield: unknown } )._mathfield = null;
			stale.remove();
		}

		expect( errors ).toEqual( [] );
	} );

	it( 'rapid left-right-left re-entry does not crash on the previous, unmounted field', async () => {
		// Caret to the right of an inline equation, as in the report: entering with ArrowLeft,
		// leaving with ArrowRight (which unmounts a *focused* field) and re-entering with
		// ArrowLeft used to crash — MathLive's deferred blur bookkeeping ran against the
		// disposed first field when the second one took focus ("this.mathfield is undefined"
		// in atomToString/getValue/onBlur).
		setData( editor.model, `<paragraph>foo${ INLINE_WIDGET }[]bar</paragraph>` );

		const errors: Array<unknown> = [];
		const onError = ( event: ErrorEvent ) => {
			// Browser-generated and benign: an observer's notifications spilling into the next
			// frame. Not a MathLive crash, which is what these listeners are here to catch.
			if ( String( event.message ).includes( 'ResizeObserver loop' ) ) {
				event.preventDefault();
				return;
			}
			errors.push( event.error ?? event.message );
			event.preventDefault();
		};
		window.addEventListener( 'error', onError );

		try {
			// Left: walk into the equation and wait until the field actually holds focus.
			domRoot().dispatchEvent( keyEvent( 'ArrowLeft', 37 ) );
			const first = await waitFor( findMathField );
			await waitFor( () => ( document.activeElement === first ? true : null ) );

			// Dwell at human speed: MathLive's onFocus holds a focusBlurInProgress latch for
			// 60ms during which a blur would be silently dropped.
			await new Promise( resolve => setTimeout( resolve, 120 ) );

			// Right at the end of the equation: MathLive move-out → the field unmounts while
			// focused.
			first.shadowRoot?.querySelector( '[part=keyboard-sink]' )?.dispatchEvent(
				new KeyboardEvent( 'keydown', {
					key: 'ArrowRight', code: 'ArrowRight', bubbles: true, composed: true, cancelable: true
				} ) );
			await waitFor( () => ( findMathField() === null ? true : null ) );

			// The exit put the caret right after the widget, ready for re-entry.
			expect( getData( editor.model ) ).toContain( '</mathtex-inline>[]bar' );

			// Left again: a second field mounts and takes focus — the crash site: MathLive's
			// onFocus blurs the previously focused field, by now disposed.
			domRoot().dispatchEvent( keyEvent( 'ArrowLeft', 37 ) );
			const second = await waitFor( findMathField );
			await waitFor( () => ( document.activeElement === second ? true : null ) );
		} finally {
			window.removeEventListener( 'error', onError );
		}

		expect( errors ).toEqual( [] );
	} );

	it( 'move-out unmounts the field and puts the caret next to the widget', async () => {
		setData( editor.model, `<paragraph>foo[${ INLINE_WIDGET }]bar</paragraph>` );

		const mathfield = await startEditingSelected();
		mathfield.dispatchEvent( new CustomEvent( 'move-out', { detail: { direction: 'forward' }, cancelable: true } ) );

		// The unmount is deferred past the dispatching keystroke task.
		await waitFor( () => ( findMathField() === null ? true : null ) );
		expect( getData( editor.model ) ).toContain( '</mathtex-inline>[]' );
	} );

	it( 'move-out forward from a display equation lands in the next block', async () => {
		// The naive placement — selection directly "after" a block widget — sits between
		// blocks, where the post-fixer snapped it back onto the widget; the next ArrowRight
		// then re-entered the field at the start, trapping the caret in a loop.
		setData( editor.model, `<paragraph>ab</paragraph>[${ DISPLAY_WIDGET }]<paragraph>cd</paragraph>` );

		const mathfield = await startEditingSelected();
		mathfield.dispatchEvent( new CustomEvent( 'move-out', { detail: { direction: 'forward' }, cancelable: true } ) );

		await waitFor( () => ( findMathField() === null ? true : null ) );
		expect( getData( editor.model ) ).toContain( '<paragraph>[]cd</paragraph>' );
	} );

	it( 'move-out backward from a display equation lands at the end of the previous block', async () => {
		setData( editor.model, `<paragraph>ab</paragraph>[${ DISPLAY_WIDGET }]<paragraph>cd</paragraph>` );

		const mathfield = await startEditingSelected();
		mathfield.dispatchEvent( new CustomEvent( 'move-out', { detail: { direction: 'backward' }, cancelable: true } ) );

		await waitFor( () => ( findMathField() === null ? true : null ) );
		expect( getData( editor.model ) ).toContain( '<paragraph>ab[]</paragraph>' );
	} );

	it( 'move-out forward from a trailing display equation creates a paragraph to land in', async () => {
		setData( editor.model, `<paragraph>ab</paragraph>[${ DISPLAY_WIDGET }]` );

		const mathfield = await startEditingSelected();
		mathfield.dispatchEvent( new CustomEvent( 'move-out', { detail: { direction: 'forward' }, cancelable: true } ) );

		await waitFor( () => ( findMathField() === null ? true : null ) );
		expect( getData( editor.model ) ).toMatch( /<\/mathtex-display><paragraph>\[\]<\/paragraph>$/ );
	} );

	it( 'aborts the session when the widget disappears from the model', async () => {
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

		expect( findMathField() ).toBeNull();
	} );

	it( 'does not start editing when the editor is read-only', async () => {
		setData( editor.model, `<paragraph>foo[${ INLINE_WIDGET }]bar</paragraph>` );

		editor.enableReadOnlyMode( 'spec' );
		plugin.startEditing();
		await new Promise( resolve => setTimeout( resolve, 100 ) );

		expect( findMathField() ).toBeNull();
		editor.disableReadOnlyMode( 'spec' );
	} );

	it( 'ignores stale editors: destroying mid-mount does not throw', async () => {
		setData( editor.model, `<paragraph>foo[${ INLINE_WIDGET }]bar</paragraph>` );
		plugin.startEditing();
		await editor.destroy();
	} );
} );

interface MathFieldLike extends HTMLElement {
	value: string;
	position: number;
	lastOffset: number;
}

/** A keydown whose legacy `keyCode` is populated — CKEditor's key observers read it. */
function keyEvent( key: string, keyCode: number ): KeyboardEvent {
	const event = new KeyboardEvent( 'keydown', { key, bubbles: true, cancelable: true } );
	Object.defineProperty( event, 'keyCode', { value: keyCode } );
	return event;
}

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
