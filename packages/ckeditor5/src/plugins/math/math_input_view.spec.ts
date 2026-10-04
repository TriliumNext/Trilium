// Side-effect import: declares the `math` key on EditorConfig used by the editor configs below.
import './math.js';

import { type DISPLAYABLE_LOCALE_IDS, LOCALES } from '@triliumnext/commons';
import { Locale } from 'ckeditor5';
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

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

	afterEach( () => {
		view?.element?.remove();
		view?.destroy();
		vi.restoreAllMocks();
	} );

	it( 'renders a LaTeX textarea, a label and a MathLive container', async () => {
		await renderAndWait();

		expect( view.element?.querySelector( '.ck-mathlive-container' ) ).not.toBeNull();
		expect( view.element?.querySelector( '.ck-latex-label' ) ).not.toBeNull();
		expect( textarea().tagName ).toBe( 'TEXTAREA' );
		expect( textarea().spellcheck ).toBe( false );
	} );

	it( 'mounts a math-field and announces it', async () => {
		const mathfield = await renderAndWait();

		expect( mathfield.tagName.toLowerCase() ).toBe( 'math-field' );
		expect( mathfield.getAttribute( 'tabindex' ) ).toBe( '0' );
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

		it( 'falls back to assigning value when setValue is unavailable', async () => {
			const mathfield = await renderAndWait();
			// Older MathLive builds expose no setValue; the view must still update the field.
			delete ( mathfield as { setValue?: unknown } ).setValue;

			view.value = 'q^2';

			expect( mathfield.value ).toBe( 'q^2' );
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
