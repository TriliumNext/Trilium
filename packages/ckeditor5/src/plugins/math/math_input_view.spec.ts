// Side-effect import: declares the `math` key on EditorConfig used by the editor configs below.
import './math.js';

import { type DISPLAYABLE_LOCALE_IDS, LOCALES } from '@triliumnext/commons';
import { Locale } from 'ckeditor5';
import { afterEach, beforeAll, beforeEach, describe, expect, it, onTestFinished, vi } from 'vitest';

import getCkLocale from '../../i18n.js';
import MathInputView, { LatexTextAreaView, MathFieldFocusableView } from './math_input_view.js';

interface MathField extends HTMLElement {
	value: string;
	readOnly: boolean;
	inlineShortcuts?: Record<string, string | { value: string; after?: string }>;
	setValue?: ( value: string, options?: { silenceNotifications?: boolean } ) => void;
}

describe( 'MathInputView', () => {
	let view: MathInputView;

	/** Render the view into the document and wait for MathLive to mount its <math-field>. */
	async function renderAndWait( locale = new Locale() ): Promise<MathField> {
		view = new MathInputView( locale );
		view.render();
		document.body.appendChild( view.element as HTMLElement );

		await vi.waitFor( () => expect( view.mathfield ).not.toBeNull(), { timeout: 10000 } );
		return view.mathfield as MathField;
	}

	function textarea(): HTMLTextAreaElement {
		return view.latexTextAreaView.element;
	}

	/** Margin, padding and corner radius of a menu row. */
	function spacing( item: Element ): string[] {
		const style = getComputedStyle( item );
		return [ style.margin, style.padding, style.borderRadius ];
	}

	afterEach( () => {
		view?.element?.remove();
		view?.destroy();
		vi.restoreAllMocks();
	} );

	// First in the file, so MathLive is not yet loaded in this file's frame.
	it( 'styles the menu of a field given its value before MathLive loads', async () => {
		expect( customElements.get( 'math-field' ) ).toBeUndefined();
		view = new MathInputView( new Locale() );
		view.render();
		document.body.appendChild( view.element as HTMLElement );
		view.value = 'x^2';

		await vi.waitFor( () => expect( view.mathfield?.shadowRoot ).toBeTruthy(), { timeout: 10000 } );
		const mathfield = view.mathfield as MathField;
		const menu = document.createElement( 'menu' );
		menu.className = 'ui-menu-container';
		menu.innerHTML = '<li part="menu-item"></li>';
		( mathfield.shadowRoot as ShadowRoot ).append( menu );
		mathfield.style.setProperty( '--ck-math-menu-item-padding', '1px 15px' );

		expect( getComputedStyle( menu.children[ 0 ] ).padding ).toBe( '1px 15px' );
		expect( mathfield.value ).toBe( 'x^2' );
	} );

	it( 'renders a LaTeX textarea, a label and a MathLive container', async () => {
		await renderAndWait();

		expect( view.element?.querySelector( '.ck-mathlive-container' ) ).not.toBeNull();
		expect( view.element?.querySelector( '.ck-latex-label' ) ).not.toBeNull();
		expect( textarea().tagName ).toBe( 'TEXTAREA' );
		expect( textarea().classList.contains( 'ck-input' ) ).toBe( true );
		expect( textarea().spellcheck ).toBe( false );
	} );

	it( 'mounts a math-field and announces it', async () => {
		const mathfield = await renderAndWait();

		expect( mathfield.tagName.toLowerCase() ).toBe( 'math-field' );
		expect( mathfield.getAttribute( 'tabindex' ) ).toBe( '0' );
	} );

	it( 'lets a theme space the menu rows, but not the grid cells or dividers', async () => {
		const mathfield = await renderAndWait();
		const root = mathfield.shadowRoot as ShadowRoot;
		const menu = document.createElement( 'menu' );
		menu.className = 'ui-menu-container';
		menu.innerHTML = '<li part="menu-item"></li><li part="menu-divider" role="divider"></li>';
		const grid = document.createElement( 'menu' );
		grid.className = 'ui-menu-container insert-matrix-submenu';
		grid.innerHTML = '<li part="menu-item"></li>';
		root.append( menu, grid );
		const [ row, divider ] = Array.from( menu.children );
		const cell = grid.children[ 0 ];

		expect( spacing( row ) ).toEqual( [ '0px 6px', '1px 7px', '4px' ] );

		mathfield.style.setProperty( '--ck-math-menu-item-margin', '4px 10px' );
		mathfield.style.setProperty( '--ck-math-menu-item-padding', '1px 15px' );
		mathfield.style.setProperty( '--ck-math-menu-item-border-radius', '6px' );

		expect( spacing( row ) ).toEqual( [ '4px 10px', '1px 15px', '6px' ] );
		expect( spacing( cell ) ).toEqual( [ '0px', '0px', '0px' ] );
		expect( spacing( divider ) ).toEqual( [ '0px 15px 5px', '5px 0px 0px', '0px' ] );
	} );

	it( 'lets a theme draw the color swatches', async () => {
		const mathfield = await renderAndWait();
		const swatch = '<li part="menu-item" class="menu-swatch">'
			+ '<span class="label"><span></span></span></li>';
		const grid = document.createElement( 'menu' );
		grid.className = 'ui-menu-container swatches-submenu';
		grid.innerHTML = swatch + swatch;
		grid.children[ 1 ].classList.add( 'active' );
		( mathfield.shadowRoot as ShadowRoot ).append( grid );
		const swatches = Array.from( grid.children );
		const colors = swatches.map( item => item.querySelector( 'span > span' ) as Element );
		const radii = () => colors.map( color => getComputedStyle( color ).borderRadius );

		expect( radii() ).toEqual( [ '50%', '2px' ] );
		expect( getComputedStyle( colors[ 0 ] ).minWidth ).toBe( '32px' );
		expect( [ getComputedStyle( colors[ 0 ] ).margin, getComputedStyle( grid ).maxWidth ] )
			.toEqual( [ '6px', '216px' ] );

		mathfield.style.setProperty( '--ck-math-menu-swatch-size', '24px' );
		mathfield.style.setProperty( '--ck-math-menu-swatch-gap', '8px' );
		mathfield.style.setProperty( '--ck-math-menu-swatch-background', 'transparent' );
		mathfield.style.setProperty( '--ck-math-menu-swatch-border-radius', '4px' );
		mathfield.style.setProperty( '--ck-math-menu-swatch-shadow', 'inset 0 0 0 1px red' );

		expect( radii() ).toEqual( [ '4px', '4px' ] );
		expect( swatches.map( item => getComputedStyle( item ).backgroundColor ) )
			.toEqual( [ 'rgba(0, 0, 0, 0)', 'rgba(0, 0, 0, 0)' ] );
		expect( getComputedStyle( colors[ 0 ] ).boxShadow )
			.toBe( 'rgb(255, 0, 0) 0px 0px 0px 1px inset' );
		const { minWidth, minHeight, margin } = getComputedStyle( colors[ 0 ] );
		expect( [ minWidth, minHeight, margin ] ).toEqual( [ '24px', '24px', '1px' ] );
		expect( getComputedStyle( grid ).maxWidth ).toBe( '144px' );
	} );

	it( 'lets a theme draw the menu headings', async () => {
		const mathfield = await renderAndWait();
		const menu = document.createElement( 'menu' );
		menu.className = 'ui-menu-container';
		menu.innerHTML = '<li part="menu-item" aria-disabled="true">'
			+ '<span class="label heading">Calculus</span></li>';
		( mathfield.shadowRoot as ShadowRoot ).append( menu );
		const heading = menu.children[ 0 ];
		const label = heading.children[ 0 ];
		const look = () => {
			const row = getComputedStyle( heading );
			const text = getComputedStyle( label );
			return [ row.margin, row.padding, row.borderBottom, row.opacity, text.fontSize, text.fontWeight,
				text.letterSpacing, text.textTransform, text.color, text.opacity ];
		};
		const { fontSize, letterSpacing, color } = getComputedStyle( heading );

		expect( look() ).toEqual( [ `${ parseFloat( fontSize ) / 2 }px 6px 0px`, '1px 7px',
			`0px none ${ color }`, '0.5', fontSize, '700', letterSpacing, 'none', color, '0.4' ] );

		const theme: Record<string, string> = {
			margin: '0px 0px 8px', padding: '2px 26px 1px', border: '1px solid rgb(0, 128, 0)',
			opacity: '1', 'font-size': '10px', 'font-weight': '500', 'letter-spacing': '1px',
			'text-transform': 'uppercase', color: 'rgb(255, 0, 0)'
		};
		for ( const [ name, value ] of Object.entries( theme ) ) {
			mathfield.style.setProperty( `--ck-math-menu-heading-${ name }`, value );
		}

		expect( look() ).toEqual( [ '0px 0px 8px', '2px 26px 1px', '1px solid rgb(0, 128, 0)', '1',
			'10px', '500', '1px', 'uppercase', 'rgb(255, 0, 0)', '1' ] );
	} );

	it( 'lets a theme place and color the checkmarks of menu rows, but not of swatches', async () => {
		const mathfield = await renderAndWait();
		const menu = document.createElement( 'menu' );
		menu.className = 'ui-menu-container';
		menu.innerHTML = '<li part="menu-item" aria-checked="true"><span class="ui-checkmark"></span>'
			+ '<span class="label indent">Math</span></li>'
			+ '<li part="menu-item" aria-checked="mixed"><span class="ui-mixedmark"></span>'
			+ '<span class="label indent">Bold</span></li>';
		const grid = document.createElement( 'menu' );
		grid.className = 'ui-menu-container swatches-submenu';
		grid.innerHTML = '<li part="menu-item" class="menu-swatch" aria-checked="true">'
			+ '<span class="ui-checkmark"></span><span class="label"><span></span></span></li>';
		( mathfield.shadowRoot as ShadowRoot ).append( menu, grid );
		const rows = Array.from( menu.children );
		const marks = rows.map( row => row.children[ 0 ] );
		const look = ( mark: Element ) => {
			const style = getComputedStyle( mark );
			return [ style.order, style.marginInlineStart, style.marginInlineEnd, style.color ];
		};
		const indents = () => rows.map( row => getComputedStyle( row.children[ 1 ] ).marginInlineStart );
		const swatchMark = grid.querySelector( '.ui-checkmark' ) as Element;
		const { color } = getComputedStyle( rows[ 0 ] );

		const mathLive = [ '0', '-4px', '-11px', color ];
		expect( marks.map( look ) ).toEqual( [ mathLive, mathLive ] );
		expect( indents() ).toEqual( [ '12px', '12px' ] );

		mathfield.style.setProperty( '--ck-math-menu-checkmark-order', '1' );
		mathfield.style.setProperty( '--ck-math-menu-checkmark-margin-inline', '12px 2px' );
		mathfield.style.setProperty( '--ck-math-menu-checkmark-color', 'rgb(255, 0, 0)' );
		mathfield.style.setProperty( '--ck-math-menu-checkmark-indent', '0px' );

		const red = [ '1', '12px', '2px', 'rgb(255, 0, 0)' ];
		expect( marks.map( look ) ).toEqual( [ red, red ] );
		expect( indents() ).toEqual( [ '0px', '0px' ] );
		for ( const [ index, mark ] of marks.entries() ) {
			const labelEnd = rows[ index ].children[ 1 ].getBoundingClientRect().right;
			expect( mark.getBoundingClientRect().left ).toBeGreaterThan( labelEnd );
		}
		expect( look( swatchMark ) ).toEqual( [ '0', '0px', '0px', 'rgb(255, 255, 255)' ] );
	} );

	describe( 'MathLive\'s own menu', () => {
		let menu: Element | null = null;

		/** Open the menu of a math field from its toggle, as a user does. */
		async function showMenu( theme: Record<string, string> ): Promise<Element> {
			const mathfield = await renderAndWait();
			for ( const [ name, value ] of Object.entries( theme ) ) {
				mathfield.style.setProperty( `--ck-math-menu-${ name }`, value );
			}
			const toggle = mathfield.shadowRoot?.querySelector( '[part=menu-toggle]' ) as Element;
			toggle.dispatchEvent( new PointerEvent( 'pointerdown', { bubbles: true } ) );
			menu = mathfield.shadowRoot?.querySelector( '.ui-menu-container' ) ?? null;
			expect( menu ).not.toBeNull();
			return menu as Element;
		}

		/** The row of a menu with the given label. */
		function menuRow( parent: Element, label: string ): Element {
			const row = Array.from( parent.children )
				.find( item => item.querySelector( ':scope > .label' )?.textContent === label );
			expect( row, label ).toBeDefined();
			return row as Element;
		}

		/** Click a row of a menu and return the submenu it opens. */
		function openSubmenu( row: Element ): Element {
			// MathLive selects on `pointerup`, or on `click` if the menu opened under 120ms ago.
			row.dispatchEvent( new PointerEvent( 'pointerup', { bubbles: true } ) );
			row.dispatchEvent( new MouseEvent( 'click', { bubbles: true } ) );
			const scrim = row.parentElement?.parentElement as Element;
			const menus = scrim.querySelectorAll( ':scope > .ui-menu-container' );
			expect( menus.length ).toBeGreaterThan( 1 );
			return menus[ menus.length - 1 ];
		}

		// MathLive's menus share one scrim, so a menu left open blocks the next one.
		afterEach( () => {
			menu?.dispatchEvent( new KeyboardEvent( 'keydown', { key: 'Escape', bubbles: true } ) );
			menu = null;
		} );

		it( 'lets a theme style its rows, headings and checkmarks', async () => {
			const root = await showMenu( {
				'item-padding': '1px 15px', 'heading-padding': '2px 26px 1px',
				'heading-text-transform': 'uppercase', 'checkmark-order': '1',
				'checkmark-indent': '0px'
			} );
			const insert = menuRow( root, 'Insert' );
			const divider = root.querySelector( ':scope > [role=divider]' ) as Element;
			const heading = openSubmenu( insert ).querySelector( ':scope > li > .heading' );
			const headingRow = heading?.parentElement as Element;
			const math = menuRow( openSubmenu( menuRow( root, 'Mode' ) ), 'Math' );
			const mark = math.querySelector( ':scope > .ui-checkmark' ) as Element;
			const label = math.querySelector( ':scope > .label' ) as Element;

			expect( spacing( insert ) ).toEqual( [ '0px 6px', '1px 15px', '4px' ] );
			expect( spacing( divider ) ).toEqual( [ '0px 15px 5px', '5px 0px 0px', '0px' ] );
			expect( getComputedStyle( headingRow ).padding ).toBe( '2px 26px 1px' );
			expect( getComputedStyle( heading as Element ).textTransform ).toBe( 'uppercase' );
			expect( getComputedStyle( mark ).order ).toBe( '1' );
			expect( getComputedStyle( label ).marginInlineStart ).toBe( '0px' );
		} );

		it( 'lets a theme draw its color swatches, but not space its matrix cells', async () => {
			const root = await showMenu( {
				'item-margin': '4px 10px', 'item-padding': '1px 15px', 'item-border-radius': '6px',
				'swatch-size': '24px', 'swatch-gap': '8px', 'swatch-border-radius': '4px'
			} );
			const colors = openSubmenu( menuRow( root, 'Color' ) );
			const color = colors.querySelector( '.menu-swatch > .label > span' ) as Element;
			const matrix = openSubmenu( menuRow( root, 'Insert Matrix' ) );
			const cell = matrix.querySelector( ':scope > li' ) as Element;

			expect( getComputedStyle( colors ).maxWidth ).toBe( '144px' );
			expect( getComputedStyle( color ).borderRadius ).toBe( '4px' );
			expect( getComputedStyle( color ).minWidth ).toBe( '24px' );
			expect( spacing( cell ) ).toEqual( [ '0px', '0px', '0px' ] );
		} );
	} );

	it( 'anchors the tooltips of the toggles to them, out of the scrolling field', async () => {
		onTestFinished( () => document.body.style.removeProperty( 'padding-top' ) );
		document.body.style.paddingTop = '100px';
		const mathfield = await renderAndWait();
		const toggle = mathfield.shadowRoot?.querySelector( '[part=menu-toggle]' );
		expect( toggle ).toBeTruthy();
		const tooltip = getComputedStyle( toggle as Element, '::after' );

		expect( [ tooltip.position, tooltip.positionArea ] ).toEqual( [ 'fixed', 'top' ] );
		expect( tooltip.positionAnchor ).toBe( getComputedStyle( toggle as Element ).anchorName );
		expect( tooltip.positionAnchor ).toMatch( /^--/ );

		document.body.style.paddingTop = '0px';
		await new Promise( resolve => requestAnimationFrame( resolve ) );
		expect( tooltip.positionArea ).toBe( 'bottom' );
	} );

	it( 'resizes the math field within the limits of the LaTeX textarea', async () => {
		const mathfield = await renderAndWait();
		const form = document.createElement( 'div' );
		form.className = 'ck ck-math-form';
		document.body.append( form );
		form.append( view.element as HTMLElement );
		const container = view.element?.querySelector( '.ck-mathlive-container' ) as HTMLElement;
		form.style.setProperty( '--ck-input-width', '18em' );
		const limits = ( element: Element ) => {
			const { resize, maxWidth, minHeight, maxHeight } = getComputedStyle( element );
			return [ resize, maxWidth, minHeight, maxHeight ];
		};

		expect( limits( container ) ).toEqual( limits( textarea() ) );
		expect( limits( container ) ).toEqual( [ 'both', '100%', '60px', '120px' ] );
		// CKEditor's `.ck-input` sets the textarea's min-width to `--ck-input-width` at its font size.
		expect( parseFloat( getComputedStyle( container ).minWidth ) )
			.toBeCloseTo( 18 * parseFloat( getComputedStyle( textarea() ).fontSize ) );

		container.style.height = '200px';
		const { paddingTop, paddingBottom } = getComputedStyle( container );
		expect( mathfield.getBoundingClientRect().height )
			.toBeCloseTo( container.clientHeight - parseFloat( paddingTop ) - parseFloat( paddingBottom ) );
		form.remove();
	} );

	it( 'localizes MathLive in the editor UI language rather than the browser one', async () => {
		const mathFieldClass = () => customElements.get( 'math-field' ) as unknown as { locale: string };

		await renderAndWait( new Locale( { uiLanguage: 'de' } ) );
		expect( mathFieldClass().locale ).toBe( 'de' );
		view.element?.remove();
		view.destroy();

		await renderAndWait( new Locale( { uiLanguage: 'zh' } ) );
		expect( mathFieldClass().locale ).toBe( 'zh-cn' );
		view.element?.remove();
		view.destroy();

		await renderAndWait();
		expect( mathFieldClass().locale ).toBe( 'en' );
	} );

	describe( 'in every UI language', () => {
		const localeIds = LOCALES
			.filter( locale => !locale.contentOnly )
			.map( locale => locale.id as DISPLAYABLE_LOCALE_IDS );
		const errors: unknown[] = [];
		const onError = ( event: ErrorEvent ) => errors.push( event.error ?? event.message );
		const onRejection = ( event: PromiseRejectionEvent ) => errors.push( event.reason );

		// Vitest runs the spec in an iframe, where `window.mathVirtualKeyboard` is a proxy that shows
		// the keyboard in the top window. Mounting it here makes it render in this document.
		beforeAll( async () => {
			const { initVirtualKeyboardInCurrentBrowsingContext } = await import( 'mathlive' );
			initVirtualKeyboardInCurrentBrowsingContext();
		} );

		beforeEach( () => {
			errors.length = 0;
			window.addEventListener( 'error', onError );
			window.addEventListener( 'unhandledrejection', onRejection );
		} );

		afterEach( () => {
			window.mathVirtualKeyboard?.hide();
			window.removeEventListener( 'error', onError );
			window.removeEventListener( 'unhandledrejection', onRejection );
		} );

		it.each( localeIds )( 'mounts the math field and shows the keyboard in %s', async localeId => {
			// The same language code the text editor is configured with for this locale.
			const { language } = await getCkLocale( localeId );
			const uiLanguage = typeof language === 'string' ? language : 'en';
			const mathfield = await renderAndWait( new Locale( { uiLanguage } ) );
			mathfield.focus();
			window.mathVirtualKeyboard?.show();

			// MathLive applies a locale change to the DOM in a `setTimeout`.
			await new Promise( resolve => setTimeout( resolve, 0 ) );
			await new Promise( resolve => requestAnimationFrame( resolve ) );

			const menuToggle = mathfield.shadowRoot?.querySelector( '[data-l10n-tooltip="tooltip.menu"]' );
			expect( menuToggle?.getAttribute( 'data-tooltip' ) ).toBeTruthy();
			const keyboard = document.querySelector( 'body > .ML__keyboard' );
			expect( keyboard ).not.toBeNull();
			expect( keyboard?.querySelector( '[data-tooltip]' ) ).not.toBeNull();
			expect( errors ).toEqual( [] );
		} );
	} );

	it( 'renders only the LaTeX textarea when MathLive is disabled', () => {
		view = new MathInputView( new Locale(), false );
		view.render();
		document.body.appendChild( view.element as HTMLElement );

		expect( view.element?.querySelector( '.ck-mathlive-container' ) ).toBeNull();
		expect( view.mathfield ).toBeNull();
		expect( textarea().tagName ).toBe( 'TEXTAREA' );
	} );

	it( 'accepts custom MathLive inline shortcuts from a document event', async () => {
		const addShortcut = ( event: Event ) => {
			( event as CustomEvent<Record<string, string>> ).detail.sq = '\\sqrt{#?}';
		};
		document.addEventListener( 'mathlive:custom-shortcuts', addShortcut, { once: true } );

		const mathfield = await renderAndWait();

		expect( mathfield.inlineShortcuts?.sq ).toBe( '\\sqrt{#?}' );
	} );

	describe( 'syncing', () => {
		it( 'pushes a model value into both the textarea and the math field', async () => {
			const mathfield = await renderAndWait();

			view.value = 'x^2';

			expect( textarea().value ).toBe( 'x^2' );
			await vi.waitFor( () => expect( mathfield.value.trim() ).toBe( 'x^2' ) );
		} );

		it( 'treats a null value as empty', async () => {
			await renderAndWait();
			view.value = 'x^2';

			view.value = null;

			expect( textarea().value ).toBe( '' );
		} );

		it( 'pushes a textarea edit into the model', async () => {
			await renderAndWait();

			textarea().value = 'y^2';
			textarea().dispatchEvent( new Event( 'input' ) );

			expect( view.value ).toBe( 'y^2' );
		} );

		it( 'rebuilds the math field when the textarea is cleared', async () => {
			const first = await renderAndWait();

			textarea().value = '';
			textarea().dispatchEvent( new Event( 'input' ) );

			expect( view.value ).toBeNull();
			await vi.waitFor( () => expect( view.mathfield ).not.toBe( first ) );
		} );

		it( 'pushes a math field edit into the textarea and the model', async () => {
			const mathfield = await renderAndWait();

			mathfield.value = 'z^2';
			mathfield.dispatchEvent( new Event( 'input' ) );

			expect( textarea().value ).toBe( 'z^2' );
			expect( view.value ).toBe( 'z^2' );
		} );

		it( 'clears the model when the math field is emptied', async () => {
			const mathfield = await renderAndWait();
			view.value = 'x^2';

			mathfield.value = '';
			mathfield.dispatchEvent( new Event( 'input' ) );

			expect( view.value ).toBeNull();
		} );

		it( 'accepts a textarea edit while no math field is mounted', async () => {
			await renderAndWait();
			view.mathfield?.remove();
			view.mathfield = null;

			textarea().value = 'y^2';
			textarea().dispatchEvent( new Event( 'input' ) );

			expect( view.value ).toBe( 'y^2' );
		} );

		it( 'leaves the math field alone when the textarea already agrees with it', async () => {
			const mathfield = await renderAndWait();
			view.value = 'x^2';
			await vi.waitFor( () => expect( mathfield.value.trim() ).toBe( 'x^2' ) );
			const setValue = vi.spyOn( mathfield, 'setValue' );

			textarea().value = 'x^2';
			textarea().dispatchEvent( new Event( 'input' ) );

			expect( setValue ).not.toHaveBeenCalled();
		} );

		it( 'leaves the textarea alone when the math field already agrees with it', async () => {
			const mathfield = await renderAndWait();
			textarea().value = 'x^2';
			mathfield.value = 'x^2';

			mathfield.dispatchEvent( new Event( 'input' ) );

			expect( textarea().value ).toBe( 'x^2' );
		} );

		it( 'does not touch the math field when the model value already matches', async () => {
			const mathfield = await renderAndWait();
			view.value = 'x^2';
			await vi.waitFor( () => expect( mathfield.value.trim() ).toBe( 'x^2' ) );
			const setValue = vi.spyOn( mathfield, 'setValue' );

			// Re-assigning the same value must not push it into the field again.
			view.value = 'x^2 ';

			expect( setValue ).not.toHaveBeenCalled();
		} );

		it( 'reuses an existing math field rather than building a second one', async () => {
			const first = await renderAndWait();

			// A second init with the field already present just syncs its value.
			( view as unknown as { _initMathField( focus: boolean ): void } )._initMathField( false );

			expect( view.mathfield ).toBe( first );
		} );
	} );

	describe( 'read-only state', () => {
		it( 'propagates to the textarea and the math field', async () => {
			const mathfield = await renderAndWait();

			view.isReadOnly = true;

			expect( textarea().readOnly ).toBe( true );
			expect( mathfield.readOnly ).toBe( true );
		} );
	} );

	describe( 'keyboard handling', () => {
		it( 'moves focus to the LaTeX textarea on Tab', async () => {
			const mathfield = await renderAndWait();
			const focus = vi.spyOn( view.latexTextAreaView, 'focus' );

			const event = new KeyboardEvent( 'keydown', { key: 'Tab', cancelable: true, bubbles: true } );
			mathfield.dispatchEvent( event );

			expect( event.defaultPrevented ).toBe( true );
			expect( focus ).toHaveBeenCalled();
		} );

		it( 'swallows Shift+Tab without moving focus', async () => {
			const mathfield = await renderAndWait();
			const focus = vi.spyOn( view.latexTextAreaView, 'focus' );

			const event = new KeyboardEvent( 'keydown', { key: 'Tab', shiftKey: true, cancelable: true, bubbles: true } );
			mathfield.dispatchEvent( event );

			expect( event.defaultPrevented ).toBe( true );
			expect( focus ).not.toHaveBeenCalled();
		} );

		it( 'ignores other keys', async () => {
			const mathfield = await renderAndWait();

			const event = new KeyboardEvent( 'keydown', { key: 'a', cancelable: true, bubbles: true } );
			mathfield.dispatchEvent( event );

			expect( event.defaultPrevented ).toBe( false );
		} );
	} );

	describe( 'the virtual keyboard', () => {
		// MathLive owns `window.mathVirtualKeyboard` and calls into it while a <math-field> mounts,
		// so the real object stays in place and only the pieces under test are spied on.
		function captureGeometryHandler(): { handler: () => void | undefined } {
			const vk = window.mathVirtualKeyboard;
			const captured: { handler: () => void | undefined } = { handler: () => undefined };
			if ( vk ) {
				vi.spyOn( vk, 'addEventListener' ).mockImplementation( ( event: string, cb: () => void ) => {
					if ( event === 'geometrychange' ) {
						captured.handler = cb;
					}
				} );
			}
			return captured;
		}

		function setVisible( visible: boolean ): void {
			const vk = window.mathVirtualKeyboard;
			if ( vk ) {
				Object.defineProperty( vk, 'visible', { value: visible, configurable: true } );
			}
		}

		it( 'refocuses the math field when the keyboard geometry changes while visible', async () => {
			const captured = captureGeometryHandler();

			const mathfield = await renderAndWait();
			const focus = vi.spyOn( mathfield, 'focus' );
			setVisible( true );

			captured.handler();

			expect( focus ).toHaveBeenCalled();
		} );

		it( 'does nothing on geometry change while hidden', async () => {
			const captured = captureGeometryHandler();

			const mathfield = await renderAndWait();
			const focus = vi.spyOn( mathfield, 'focus' );
			setVisible( false );

			captured.handler();

			expect( focus ).not.toHaveBeenCalled();
		} );

		it( 'hides the keyboard on request and detaches its listener on destroy', async () => {
			const vk = window.mathVirtualKeyboard;
			const hide = vk ? vi.spyOn( vk, 'hide' ).mockImplementation( () => undefined ) : undefined;
			const removeEventListener = vk ? vi.spyOn( vk, 'removeEventListener' ) : undefined;

			await renderAndWait();
			view.hideKeyboard();
			expect( hide ).toHaveBeenCalled();

			view.element?.remove();
			view.destroy();

			expect( removeEventListener ).toHaveBeenCalledWith( 'geometrychange', expect.any( Function ) );
			expect( view.mathfield ).toBeNull();
		} );
	} );

	describe( 'focus delegation', () => {
		it( 'focuses the math field through the view and its focusable wrapper', async () => {
			const mathfield = await renderAndWait();
			const focus = vi.spyOn( mathfield, 'focus' );

			view.focus();
			view.mathFieldFocusableView.focus();

			expect( focus ).toHaveBeenCalledTimes( 2 );
		} );

		it( 'focuses the textarea through its own view', async () => {
			await renderAndWait();
			const focus = vi.spyOn( textarea(), 'focus' );

			view.latexTextAreaView.focus();

			expect( focus ).toHaveBeenCalled();
		} );

		it( 'focuses the textarea when MathLive is disabled', () => {
			view = new MathInputView( new Locale(), false );
			view.render();
			const focus = vi.spyOn( view.latexTextAreaView, 'focus' );

			view.focus();

			expect( focus ).toHaveBeenCalled();
		} );
	} );

	describe( 'the sub-views in isolation', () => {
		it( 'LatexTextAreaView renders a textarea', () => {
			const sub = new LatexTextAreaView( new Locale() );
			sub.render();

			expect( sub.element.tagName ).toBe( 'TEXTAREA' );
			sub.destroy();
		} );

		it( 'MathFieldFocusableView tolerates focus before a field exists', () => {
			const host = new MathInputView( new Locale() );
			const sub = new MathFieldFocusableView( new Locale(), host );

			expect( () => sub.focus() ).not.toThrow();
			host.destroy();
		} );
	} );
} );
