// Math input widget: wraps a MathLive <math-field> and a LaTeX textarea
// and keeps them in sync for the CKEditor 5 math dialog.
import { View, type Locale, type FocusableView } from 'ckeditor5';
import 'mathlive/fonts.css'; // Auto-bundles offline fonts

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

interface MathFieldElement extends HTMLElement {
	value: string;
	readOnly: boolean;
	mathVirtualKeyboardPolicy: string;
	inlineShortcuts?: Record<string, string>;
	setValue?: ( value: string, options?: { silenceNotifications?: boolean } ) => void;
}

// Wrapper for the MathLive element to make it focusable in CKEditor's UI system
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
		this.element = el;
	}
}

// Wrapper for the LaTeX textarea to make it focusable in CKEditor's UI system
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

// Main view class for the math input
export default class MathInputView extends View {
	public declare value: string | null;
	public declare isReadOnly: boolean;
	public mathfield: MathFieldElement | null = null;
	public readonly latexTextAreaView: LatexTextAreaView;
	public readonly mathFieldFocusableView: MathFieldFocusableView;
	private _destroyed = false;
	private _vkGeometryHandler?: () => void;
	private _updating = false;
	private static _configured = false;

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

		// Sync changes from the LaTeX textarea to the mathfield and model
		this.listenTo( textarea, 'input', () => {
			if ( this._updating ) {
				return;
			}
			this._updating = true;
			const val = textarea.value;
			this.value = val || null;
			if ( this.mathfield ) {
				if ( val === '' ) {
					this.mathfield.remove();
					this.mathfield = null;
					this._initMathField( false );
				} else if ( this.mathfield.value.trim() !== val.trim() ) {
					this._setMathfieldValue( val );
				}
			}
			this._updating = false;
		} );

		// Sync changes from the model (this.value) to the UI elements
		this.on( 'change:value', ( _e, _n, val ) => {
			if ( this._updating ) {
				return;
			}
			this._updating = true;
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
			this._updating = false;
		} );

		// Handle read-only state changes
		this.on( 'change:isReadOnly', ( _e, _n, val ) => {
			textarea.readOnly = val;
			if ( this.mathfield ) {
				this.mathfield.readOnly = val;
			}
		} );

		// Handle virtual keyboard geometry changes
		const vk = window.mathVirtualKeyboard;
		if ( vk && !this._vkGeometryHandler ) {
			this._vkGeometryHandler = () => {
				if ( vk.visible && this.mathfield ) {
					this.mathfield.focus();
				}
			};
			vk.addEventListener( 'geometrychange', this._vkGeometryHandler );
		}

		const initial = this.value ?? '';
		if ( textarea.value !== initial ) {
			textarea.value = initial;
		}
		this._loadMathLive();
	}

	// Loads the MathLive library dynamically
	private async _loadMathLive(): Promise<void> {
		try {
			await import( 'mathlive' );
			await customElements.whenDefined( 'math-field' );
			if ( this._destroyed ) {
				return;
			}
			if ( !MathInputView._configured ) {
				const MathfieldClass = customElements.get( 'math-field' ) as any;
				if ( MathfieldClass ) {
					MathfieldClass.soundsDirectory = null;
					MathfieldClass.plonkSound = null;
					MathInputView._configured = true;
				}
			}
			if ( this.element && !this._destroyed ) {
				this._initMathField( true );
			}
		} catch {
			const c = this.element?.querySelector( '.ck-mathlive-container' );
			if ( c ) {
				c.textContent = 'Math editor unavailable';
			}
		}
	}

	// Initializes the <math-field> element
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
		// Set shortcuts after mounting (accessing inlineShortcuts requires mounted element)
		try {
			if ( mf.inlineShortcuts ) {
				mf.inlineShortcuts = { ...mf.inlineShortcuts, dx: 'dx', dy: 'dy', dt: 'dt' };
			}
		} catch {
			// Inline shortcut configuration is optional; ignore failures to avoid breaking the math field.
		}
		mf.addEventListener( 'keydown', ev => {
			if ( ev.key === 'Tab' ) {
				if ( ev.shiftKey ) {
					ev.preventDefault();
				} else {
					ev.preventDefault();
					ev.stopImmediatePropagation();
					this.latexTextAreaView.focus();
				}
			}
		}, { capture: true } );
		mf.addEventListener( 'input', () => {
			if ( this._updating ) {
				return;
			}
			this._updating = true;
			const textarea = this.latexTextAreaView.element;
			if ( textarea.value.trim() !== mf.value.trim() ) {
				textarea.value = mf.value;
			}
			this.value = mf.value || null;
			this._updating = false;
		} );
		this.mathfield = mf;
		this.mathFieldFocusableView.setElement( mf );
		this.fire( 'mathfieldReady' );
		if ( shouldFocus ) {
			requestAnimationFrame( () => mf.focus() );
		}
	}

	// Updates the mathfield value without triggering loops
	private _setMathfieldValue( value: string ): void {
		if ( !this.mathfield ) {
			return;
		}
		if ( this.mathfield.setValue ) {
			this.mathfield.setValue( value, { silenceNotifications: true } );
		} else {
			this.mathfield.value = value;
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
