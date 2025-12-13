// Math input widget: wraps a MathLive <math-field> and a LaTeX textarea
// and keeps them in sync for the CKEditor 5 math dialog.
import { View, type Locale, type FocusableView } from 'ckeditor5';

// Type-safe interface for MathLive's global virtual keyboard.
declare global {
	interface Window {
		mathVirtualKeyboard?: {
			visible: boolean;
			show: () => void;
			hide: () => void;
			addEventListener: ( event: string, cb: () => void ) => void;
			removeEventListener: ( event: string, cb: () => void ) => void;
		};
	}
}
// Narrow interface for the MathLive element we care about.
interface MathFieldElement extends HTMLElement {
	value: string;
	readOnly: boolean;
	mathVirtualKeyboardPolicy: string;
	inlineShortcuts?: Record<string, string>;
	setValue?: ( value: string, options?: { silenceNotifications?: boolean } ) => void;
}
// Small wrapper so the math-field can participate in CKEditor focus cycling.
export class MathFieldFocusableView extends View implements FocusableView {
	public declare element: HTMLElement | null;
	private _view: MathInputView;
	constructor( locale: Locale, view: MathInputView ) {
		super( locale );
		this._view = view;
	}
	public focus(): void {
		this._view.mathfield?.focus();
	}
	public setElement( el: HTMLElement ): void {
		( this as any ).element = el;
	}
}
// Simple textarea used to edit the raw LaTeX source.
export class LatexTextAreaView extends View implements FocusableView {
	declare public element: HTMLTextAreaElement;
	constructor( locale: Locale ) {
		super( locale );
		this.setTemplate( { tag: 'textarea', attributes: {
			class: [ 'ck', 'ck-textarea', 'ck-latex-textarea' ], spellcheck: 'false', tabindex: 0
		} } );
	}
	public focus(): void {
		this.element?.focus();
	}
}
// Main view used by the math dialog.
export default class MathInputView extends View {
	public declare value: string | null;
	public declare isReadOnly: boolean;
	public mathfield: MathFieldElement | null = null;
	public readonly latexTextAreaView: LatexTextAreaView;
	public readonly mathFieldFocusableView: MathFieldFocusableView;
	private _destroyed = false;
	private _vkGeometryHandler?: () => void;

	constructor( locale: Locale ) {
		super( locale );
		this.latexTextAreaView = new LatexTextAreaView( locale );
		this.mathFieldFocusableView = new MathFieldFocusableView( locale, this );
		this.set( 'value', null );
		this.set( 'isReadOnly', false );
		this.setTemplate( {
			tag: 'div', attributes: { class: [ 'ck', 'ck-math-input' ] },
			children: [
				{ tag: 'div', attributes: { class: [ 'ck-mathlive-container' ] } },
				{ tag: 'label', attributes: { class: [ 'ck-latex-label' ] }, children: [ locale.t( 'LaTeX' ) ] },
				{ tag: 'div', attributes: { class: [ 'ck-latex-wrapper' ] }, children: [ this.latexTextAreaView ] }
			]
		} );
	}
	public override render(): void {
		super.render();
		const textarea = this.latexTextAreaView.element;
		// Keep value -> textarea -> mathfield in sync when user types LaTeX.
		textarea.addEventListener( 'input', () => {
			const val = textarea.value;
			this.value = val || null;
			if ( this.mathfield ) {
				// When cleared, recreate mathfield to avoid "ghost braces" artifacts.
				if ( val === '' ) {
					this.mathfield.remove();
					this.mathfield = null;
					this._initMathField( false );
				} else if ( this.mathfield.value.trim() !== val.trim() ) {
					this._setMathfieldValue( val );
				}
			}
		} );
		// External changes to value (e.g. dialog model) update both views.
		this.on( 'change:value', ( _e, _n, val ) => {
			const newVal = val ?? '';
			if ( textarea.value !== newVal ) {
				textarea.value = newVal;
			}
			if ( this.mathfield ) {
				if ( this.mathfield.value.trim() !== newVal.trim() ) {
					this._setMathfieldValue( newVal );
				}
			} else if ( newVal !== '' ) {
				this._initMathField( false );
			}
		} );
		// Keep read-only state of both widgets in sync.
		this.on( 'change:isReadOnly', ( _e, _n, val ) => {
			textarea.readOnly = val;
			if ( this.mathfield ) {
				this.mathfield.readOnly = val;
			}
		} );
		const vk = window.mathVirtualKeyboard;
		if ( vk && !this._vkGeometryHandler ) {
			// When the on-screen keyboard appears, ensure mathfield has focus
			// so MathLive captures the keyboard input correctly.
			this._vkGeometryHandler = () => {
				if ( !vk.visible || !this.mathfield ) {
					return;
				}
				this.mathfield.focus();
			};
			vk.addEventListener( 'geometrychange', this._vkGeometryHandler );
		}
		// On first render, reflect initial value into the LaTeX textarea.
		const initial = this.value ?? '';
		if ( textarea.value !== initial ) {
			textarea.value = initial;
		}
		this._loadMathLive();
	}
	private async _loadMathLive(): Promise<void> {
		try {
			await import( 'mathlive' );
			await customElements.whenDefined( 'math-field' );
			if ( this._destroyed ) {
				return;
			}
			const MathfieldClass = customElements.get( 'math-field' ) as any;
			if ( MathfieldClass ) {
				// Disable MathLive sounds globally for a quieter UI.
				MathfieldClass.soundsDirectory = null;
				MathfieldClass.plonkSound = null;
			}
			if ( this.element && !this._destroyed ) {
				this._initMathField( true );
			}
		} catch ( e ) {
			console.error( 'MathLive load error', e );
			const c = this.element?.querySelector( '.ck-mathlive-container' );
			if ( c ) {
				c.textContent = 'Math editor unavailable';
			}
		}
	}
	private _initMathField( shouldFocus: boolean ): void {
		const container = this.element?.querySelector( '.ck-mathlive-container' );
		if ( !container ) {
			return;
		}
		if ( this.mathfield ) {
			this._setMathfieldValue( this.value ?? '' );
			return;
		}
		const mf = document.createElement( 'math-field' ) as MathFieldElement;
		mf.mathVirtualKeyboardPolicy = 'auto';
		mf.setAttribute( 'tabindex', '0' );
		mf.value = this.value ?? '';
		mf.readOnly = this.isReadOnly;
		container.appendChild( mf );
		// Ensure mathfield is ready immediately for virtual keyboard input
		mf.focus();
		try {
			const anyMf = mf as any;
			// Override only dt/dx/dy, keep other built‑in shortcuts (e.g. frac).
			anyMf.inlineShortcuts = { ...( anyMf.inlineShortcuts || {} ), dx: 'dx', dy: 'dy', dt: 'dt' };
		} catch { /* */ }
		mf.addEventListener( 'keydown', ev => {
			// Let Tab move focus from mathfield into the LaTeX textarea
			// instead of being consumed by MathLive.
			if ( ev.key === 'Tab' && !ev.shiftKey ) {
				ev.preventDefault();
				ev.stopImmediatePropagation();
				this.latexTextAreaView.focus();
			}
		}, { capture: true } );

		mf.addEventListener( 'input', () => {
			if ( this.latexTextAreaView.element.value.trim() !== mf.value.trim() ) {
				this.latexTextAreaView.element.value = mf.value;
			}
			this.value = mf.value || null;
		} );

		this.mathfield = mf;
		this.mathFieldFocusableView.setElement( mf );
		this.fire( 'mathfieldReady' );
		if ( shouldFocus ) {
			requestAnimationFrame( () => mf.focus() );
		}
	}

	private _setMathfieldValue( value: string ): void {
		const mf = this.mathfield;
		if ( !mf ) {
			return;
		}
		if ( mf.setValue ) {
			mf.setValue( value, { silenceNotifications: true } );
		} else {
			mf.value = value;
		}
	}
	public hideKeyboard(): void {
		window.mathVirtualKeyboard?.hide();
	}
	public focus(): void {
		this.mathfield?.focus();
	}
	public override destroy(): void {
		this._destroyed = true;
		const vk = window.mathVirtualKeyboard;
		if ( vk && this._vkGeometryHandler ) {
			vk.removeEventListener( 'geometrychange', this._vkGeometryHandler );
			this._vkGeometryHandler = undefined;
		}
		this.hideKeyboard();
		this.mathfield?.remove();
		this.mathfield = null;
		super.destroy();
	}
}
