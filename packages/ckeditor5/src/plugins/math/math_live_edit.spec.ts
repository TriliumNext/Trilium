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

	it( 'rendered equations are not elevated above the rest of the UI', async () => {
		// .ML__base is part of every rendered equation and position: relative in MathLive's own
		// stylesheet. It once sat in math.css's floating-UI z-index list (harmless while it only
		// existed inside the balloon), which painted every equation over the app's modals.
		setData( editor.model, `<paragraph>foo[]${ INLINE_WIDGET }bar</paragraph>` );

		const base = await waitFor( () =>
			domRoot().querySelector( '.ck-math-widget-preview .ML__base' ) );
		expect( getComputedStyle( base ).zIndex ).toBe( 'auto' );
	} );

	it( 'renders equations at KaTeX\'s 1.21em scale, like reading mode', async () => {
		// KaTeX draws math at 1.21em of the surrounding text (.katex { font-size: 1.21em }), so
		// reading mode and the pre-MathLive editor did too; without matching it, equations
		// shrank by that factor in the editor.
		setData( editor.model, `<paragraph>foo[]${ INLINE_WIDGET }bar</paragraph>` );

		const preview = await waitFor( () =>
			domRoot().querySelector<HTMLElement>( '.ck-math-widget-preview' ) );
		const base = parseFloat( getComputedStyle( domRoot() ).fontSize );
		expect( parseFloat( getComputedStyle( preview ).fontSize ) / base ).toBeCloseTo( 1.21, 2 );

		const mathfield = await startEditingSelected();
		expect( parseFloat( getComputedStyle( mathfield ).fontSize ) / base ).toBeCloseTo( 1.21, 2 );
	} );

	it( 'a focused field shows no platform focus ring', async () => {
		// MathLive's shadow :host(:focus-within) rule draws the OS-accent-colored native ring
		// (outline: auto), which read as a stray box around the equation being edited.
		setData( editor.model, `<paragraph>foo[${ INLINE_WIDGET }]bar</paragraph>` );

		const mathfield = await startEditingSelected();
		await waitFor( () => ( document.activeElement === mathfield ? true : null ) );
		expect( getComputedStyle( mathfield ).outlineStyle ).toBe( 'none' );
	} );

	it( 'promoting the preview to a field keeps the equation box height', async () => {
		// The pixel-parity promise: MathLive's shadow container/content paddings are zeroed and
		// the preview is inline-block like the field, so starting an edit must not grow the box.
		setData( editor.model, '<paragraph>foo[<mathtex-inline display="false" equation="\\frac{a}{b}+x" type="span"></mathtex-inline>]bar</paragraph>' );

		const preview = await waitFor( () =>
			domRoot().querySelector( '.ck-math-widget-preview [class*="ML__latex"]' ) &&
			domRoot().querySelector<HTMLElement>( '.ck-math-widget-preview' ) );
		const before = preview.getBoundingClientRect();

		const mathfield = await startEditingSelected();
		await new Promise( resolve => setTimeout( resolve, 200 ) );
		const after = mathfield.getBoundingClientRect();

		// A short equation must not be marked overflowing by the sub-pixel rounding of its box.
		expect( mathfield.hasAttribute( 'data-overflowing' ) ).toBe( false );

		// Height only: the widths still differ by a few pixels through an unresolved interplay
		// of MathLive's `.ML__latex { width: min-content }` with the wrappers' shrink-to-fit
		// sizing. (`Math` is the plugin import here; the global needs its full name.)
		expect( globalThis.Math.abs( after.height - before.height ) ).toBeLessThan( 1.5 );
	} );

	it( 'wraps a long inline equation across lines, as KaTeX did', async () => {
		// MathLive's markup is a single unbreakable run (nowrap, min-content, atomic
		// inline-block base, no whitespace between atoms); the loader inserts <wbr> after
		// top-level operators and the preview CSS lets the flow break there.
		const long = Array.from( { length: 30 }, ( _unused, i ) => `a_{${ i }}x^{${ i }}` ).join( '+' );
		setData( editor.model, `<paragraph>foo[]<mathtex-inline display="false" equation="${ long }" type="span"></mathtex-inline>bar</paragraph>` );

		domRoot().style.width = '300px';
		const preview = await waitFor( () =>
			domRoot().querySelector( '.ck-math-widget-preview [class*="ML__latex"]' ) &&
			domRoot().querySelector<HTMLElement>( '.ck-math-widget-preview' ) );

		expect( preview.querySelectorAll( 'wbr' ).length ).toBeGreaterThan( 10 );
		const height = preview.getBoundingClientRect().height;
		const lineHeight = parseFloat( getComputedStyle( domRoot() ).fontSize ) * 1.21 * 1.2;
		expect( height ).toBeGreaterThan( lineHeight * 2 );
		// And it stays within the editable instead of overflowing horizontally.
		expect( preview.getBoundingClientRect().width ).toBeLessThanOrEqual( 301 );
	} );

	it( 'a long equation scrolls inside the capped field instead of growing the item', async () => {
		// The field cannot wrap; it must stay within the editable and expose its overflow
		// through a real scrollbar (MathLive ships overflow: hidden with programmatic
		// caret-following only).
		const long = Array.from( { length: 30 }, ( _unused, i ) => `a_{${ i }}x^{${ i }}` ).join( '+' );
		setData( editor.model, `<paragraph>foo[<mathtex-inline display="false" equation="${ long }" type="span"></mathtex-inline>]bar</paragraph>` );
		// On the editable's parent: the view renderer owns the editable element's attributes
		// and reverts direct style mutations on the next render.
		const chrome = domRoot().parentElement;
		if ( !chrome ) {
			throw new Error( 'missing editable parent' );
		}
		chrome.style.width = '300px';

		const mathfield = await startEditingSelected();
		await new Promise( resolve => setTimeout( resolve, 200 ) );

		const content = mathfield.shadowRoot?.querySelector( '[part=content]' );
		if ( !content ) {
			throw new Error( 'missing field content part' );
		}
		expect( mathfield.getBoundingClientRect().width ).toBeLessThanOrEqual( 301 );
		expect( mathfield.hasAttribute( 'data-overflowing' ) ).toBe( true );
		expect( getComputedStyle( content ).overflowX ).toBe( 'auto' );
		expect( content.scrollWidth ).toBeGreaterThan( content.clientWidth );

		// Grabbing the scrollbar must not reach MathLive's selection tracking, while a
		// pointer-down on the equation itself still must. The guard runs in the capture
		// phase on the host, so a stopped event never reaches listeners on the content.
		const rect = content.getBoundingClientRect();
		let reached = 0;
		content.addEventListener( 'pointerdown', () => {
			reached++;
		} );
		const press = ( clientY: number ) => content.dispatchEvent( new MouseEvent( 'pointerdown', {
			clientX: rect.left + 10, clientY, bubbles: true, composed: true, cancelable: true
		} ) );
		press( rect.top + 4 );
		expect( reached ).toBe( 1 );
		press( rect.bottom - 2 );
		expect( reached ).toBe( 1 );
	} );

	it( 'startEditing mounts a math-field inside the selected widget and hides the preview', async () => {
		setData( editor.model, `<paragraph>foo[${ INLINE_WIDGET }]bar</paragraph>` );

		const mathfield = await startEditingSelected();
		expect( mathfield.value ).toBe( 'x^2' );

		const preview = domRoot().querySelector( '.ck-math-widget-preview' );
		expect( preview?.classList.contains( 'ck-hidden' ) ).toBe( true );
	} );

	it( 'startEditing without a selected equation inserts an empty one, showing a placeholder', async () => {
		setData( editor.model, '<paragraph>foo[]bar</paragraph>' );

		const mathfield = await startEditingSelected();
		expect( mathfield.value ).toBe( '' );
		expect( getData( editor.model ) ).toContain( '<mathtex-inline' );

		// MathLive renders the hint while the field is empty.
		expect( ( mathfield as unknown as { placeholder: string } ).placeholder )
			.toBe( '\\text{Type an equation}' );
		const hint = await waitFor( () => mathfield.shadowRoot?.querySelector( '[part=placeholder]' ) );
		expect( hint.textContent ).toContain( 'Type an equation' );

		// The hint renders in the note's content font at surrounding-text size — not in
		// MathLive's system-ui default at the field's 1.21em math scale.
		domRoot().style.setProperty( '--ck-content-font-family', 'Georgia' );
		const hintText = await waitFor( () => hint.querySelector( '.ML__text' ) );
		expect( getComputedStyle( hintText ).fontFamily ).toContain( 'Georgia' );
		// No text-mode highlight on the hint (MathLive's translucent blue behind \text runs).
		expect( getComputedStyle( hintText ).backgroundColor ).toBe( 'rgba(0, 0, 0, 0)' );
		const baseSize = parseFloat( getComputedStyle( domRoot() ).fontSize );
		expect( parseFloat( getComputedStyle( hint ).fontSize ) ).toBeCloseTo( baseSize, 0 );
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

	it( 'leaves the keys that finish a LaTeX command to MathLive, and takes them back after', async () => {
		setData( editor.model, `<paragraph>foo[${ INLINE_WIDGET }]bar</paragraph>` );

		const mathfield = await startEditingSelected();
		await waitFor( () => ( document.activeElement === mathfield ? true : null ) );

		// `\` puts the field in LaTeX mode, where the command being spelled out is not in the
		// field's value yet. Enter accepts it there — taking it to leave the field instead
		// committed an empty equation, which removed the widget the user was typing into.
		const sink = mathfield.shadowRoot?.querySelector( '[part=keyboard-sink]' );
		expect( sink ).not.toBeNull();
		sink?.dispatchEvent( sinkKey( '\\', 'Backslash' ) );
		await waitFor( () => ( mathfield.mode === 'latex' ? true : null ) );

		sink?.dispatchEvent( sinkKey( 'Enter', 'Enter' ) );
		await waitFor( () => ( mathfield.mode === 'math' ? true : null ) );
		expect( findMathField() ).not.toBeNull();
		expect( getData( editor.model ) ).toContain( '<mathtex-inline' );

		// Back in math mode the same key leaves the field, as it always did.
		sink?.dispatchEvent( sinkKey( 'Enter', 'Enter' ) );
		await waitFor( () => ( findMathField() === null ? true : null ) );
	} );

	it( 'dresses the LaTeX suggestion list as one of the app\'s own menus', async () => {
		setData( editor.model, `<paragraph>foo[${ INLINE_WIDGET }]bar</paragraph>` );

		const mathfield = await startEditingSelected();
		await waitFor( () => ( document.activeElement === mathfield ? true : null ) );

		// What `\alp` typed into the field comes to: MathLive inserts printable characters
		// through its input pipeline rather than from the keydown, and `typedText` is that
		// pipeline's own entry point.
		mathfield.executeCommand( [ 'switchMode', 'latex', '', '\\' ] );
		mathfield.executeCommand( [ 'typedText', 'alp' ] );

		// MathLive injects the popover's own stylesheet at runtime, through
		// `document.adoptedStyleSheets` — which the cascade puts after the bundled ones. Our rules
		// have to outrank it on specificity alone, or the panel keeps its stock roomy rows.
		const panel = await waitFor( () =>
			document.querySelector( '#mathlive-suggestion-popover.is-visible' ) );
		const row = panel.querySelector( 'li' );
		expect( row ).not.toBeNull();

		// MathLive's stock panel is a grey bubble with an arrow, holding rows 8px of margin and
		// 8px of padding apart.
		expect( getComputedStyle( panel ).backgroundColor ).not.toBe( 'rgb(97, 97, 97)' );
		expect( getComputedStyle( panel, '::after' ).display ).toBe( 'none' );

		// The menu colours the panel borrows are translucent, and read as see-through without the
		// app's frosting behind them. It goes on a background-less layer of its own rather than on
		// the panel, which is the only one of the two paths that survives a transparent window.
		document.documentElement.style.setProperty( '--dropdown-backdrop-filter', 'blur(20px)' );
		const frosting = getComputedStyle( panel, '::before' );
		expect( frosting.backdropFilter ).toBe( 'blur(20px)' );
		expect( frosting.zIndex ).toBe( '-1' );
		document.documentElement.style.removeProperty( '--dropdown-backdrop-filter' );
		const rowStyle = getComputedStyle( row as HTMLElement );
		expect( rowStyle.margin ).toBe( '0px' );
		expect( rowStyle.paddingLeft ).not.toBe( '8px' );

		// Sized like a menu rather than like the page: the panel hangs off `body`, so left alone
		// it reads a good deal larger than the lists it sits beside, and the 1.6rem MathLive draws
		// each suggestion at pushes the rows taller still.
		const panelSize = parseFloat( getComputedStyle( panel ).fontSize );
		expect( panelSize ).toBeLessThan( parseFloat( getComputedStyle( document.body ).fontSize ) );
		expect( ( row as HTMLElement ).getBoundingClientRect().height ).toBeLessThan( 28 );
	} );

	it( 'keeps the LaTeX suggestion list on screen as the command is typed out', async () => {
		setData( editor.model, `<paragraph>foo[${ INLINE_WIDGET }]bar</paragraph>` );

		const mathfield = await startEditingSelected();
		await waitFor( () => ( document.activeElement === mathfield ? true : null ) );

		mathfield.executeCommand( [ 'switchMode', 'latex', '', '\\' ] );
		mathfield.executeCommand( [ 'typedText', 'al' ] );
		const first = await waitFor( () =>
			document.querySelector<HTMLElement>( '#mathlive-suggestion-popover.is-visible' ) );
		const top = first.style.top;

		// Every keystroke replaces the panel: MathLive releases the shared element (taking the
		// node out of the document) and asks for it again, and the fresh one arrives unpositioned
		// and unshown until a 32ms timer catches up. Left alone, the list blinks per letter.
		mathfield.executeCommand( [ 'typedText', 'p' ] );
		const replacement = document.getElementById( 'mathlive-suggestion-popover' );
		expect( replacement ).not.toBe( first );

		await Promise.resolve();
		expect( replacement?.classList.contains( 'is-visible' ) ).toBe( true );
		expect( replacement?.style.top ).toBe( top );

		// A removal with no replacement is MathLive putting the list away, which has to stick.
		mathfield.shadowRoot?.querySelector( '[part=keyboard-sink]' )
			?.dispatchEvent( sinkKey( 'Enter', 'Enter' ) );
		await waitFor( () =>
			( document.getElementById( 'mathlive-suggestion-popover' ) === null ? true : null ) );
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
	readonly mode: 'math' | 'text' | 'latex';
	executeCommand: ( command: Array<string> ) => boolean;
}

/** A keydown for MathLive's own keystroke pipeline, which reads it off the shadow keyboard sink. */
function sinkKey( key: string, code: string ): KeyboardEvent {
	return new KeyboardEvent( 'keydown', {
		key, code, bubbles: true, composed: true, cancelable: true
	} );
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
