// Math input widget: wraps a MathLive <math-field> and a LaTeX textarea
// and keeps them in sync for the CKEditor 5 math dialog.
import { View, type Locale, type FocusableView, type TemplateDefinition } from 'ckeditor5';
import type { InlineShortcutDefinitions } from 'mathlive';
import 'mathlive/fonts.css'; // Auto-bundles offline fonts
import 'mathlive/static.css'; // Static styles for mathlive

// `window.mathVirtualKeyboard` is declared by MathLive itself. This file used to re-declare it,
// which was harmless while the plugin lived in its own package but collides here.

interface MathFieldElement extends HTMLElement {
	value: string;
	readOnly: boolean;
	mathVirtualKeyboardPolicy: string;
	inlineShortcuts?: InlineShortcutDefinitions;
	setValue: ( value: string, options?: { silenceNotifications?: boolean } ) => void;
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
			class: [ 'ck', 'ck-input', 'ck-textarea', 'ck-latex-textarea' ],
			spellcheck: 'false',
			tabindex: 0
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
	private readonly _enableMathField: boolean;
	private static _configured = false;

	/** Replaces the editor when MathLive fails to load; resolved up front, while the locale is at hand. */
	private readonly _unavailableLabel: string;

	/** The editor UI language, which MathLive otherwise reads from `navigator.language`. */
	private readonly _mathLiveLocale: string;

	constructor( locale: Locale, enableMathField = true ) {
		super( locale );
		this._enableMathField = enableMathField;
		this._unavailableLabel = locale.t( 'Math editor unavailable' );
		this._mathLiveLocale = toMathLiveLocale( locale.uiLanguage );
		this.latexTextAreaView = new LatexTextAreaView( locale );
		this.mathFieldFocusableView = new MathFieldFocusableView( locale, this );
		this.set( 'value', null );
		this.set( 'isReadOnly', false );
		const children: Array<TemplateDefinition | View> = [];
		// Only include the MathLive container in the DOM when the feature is enabled
		if ( this._enableMathField ) {
			children.push( { tag: 'div', attributes: { class: [ 'ck-mathlive-container' ] } } );
		}
		children.push(
			{ tag: 'label', attributes: { class: [ 'ck-latex-label' ] }, children: [ locale.t( 'LaTeX' ) ] },
			this.latexTextAreaView
		);
		this.setTemplate( {
			tag: 'div', attributes: { class: [ 'ck', 'ck-math-input' ] },
			children
		} );
	}

	public override render(): void {
		super.render();
		const textarea = this.latexTextAreaView.element;

		// Sync changes from the LaTeX textarea to the mathfield and model
		this.listenTo( textarea, 'input', () => {
			/* v8 ignore next 3 -- re-entrancy latch: set only while the partner handler writes */
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
			} else if ( this._enableMathField && newVal !== '' ) {
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
		/* v8 ignore next 3 -- a freshly templated textarea is empty and `value` starts null, so
		   these are always already equal on first render */
		if ( textarea.value !== initial ) {
			textarea.value = initial;
		}
		if ( this._enableMathField ) {
			this._loadMathLive();
		}
	}

	// Loads the MathLive library dynamically
	private async _loadMathLive(): Promise<void> {
		/* v8 ignore start -- the catch is only reached if the bundled MathLive import itself fails */
		try {
			await import( 'mathlive' );
			await customElements.whenDefined( 'math-field' );
			if ( this._destroyed ) {
				return;
			}
			const MathfieldClass = customElements.get( 'math-field' ) as any;
			/* v8 ignore next -- defensive: whenDefined() resolved, so the element is registered */
			if ( MathfieldClass ) {
				if ( !MathInputView._configured ) {
					MathfieldClass.soundsDirectory = null;
					MathfieldClass.plonkSound = null;
					MathInputView._configured = true;
				}
				// Setting the locale re-renders every math field and keyboard, so it is set only on change.
				if ( MathfieldClass.locale !== this._mathLiveLocale ) {
					MathfieldClass.locale = this._mathLiveLocale;
				}
			}
			if ( this.element && !this._destroyed ) {
				this._initMathField( true );
			}
		} catch {
			const c = this.element?.querySelector( '.ck-mathlive-container' );
			if ( c ) {
				c.textContent = this._unavailableLabel;
			}
		}
		/* v8 ignore stop */
	}

	// Initializes the <math-field> element
	private _initMathField( shouldFocus: boolean ): void {
		const container = this.element?.querySelector( '.ck-mathlive-container' );
		/* v8 ignore next 3 -- defensive: the container is part of this view's own template */
		if ( !container ) {
			return;
		}
		if ( this.mathfield ) {
			this._setMathfieldValue( this.value ?? '' );
			return;
		}
		// Made before MathLive defines it, the element has no shadow root to adopt `SHADOW_STYLES`;
		// `_loadMathLive()` creates it with the current value once MathLive has loaded.
		if ( !customElements.get( 'math-field' ) ) {
			return;
		}
		const mf = document.createElement( 'math-field' ) as MathFieldElement;
		adoptShadowStyles( mf );
		mf.mathVirtualKeyboardPolicy = 'auto';
		mf.setAttribute( 'tabindex', '0' );
		mf.value = this.value ?? '';
		mf.readOnly = this.isReadOnly;
		container.appendChild( mf );
		// Set shortcuts after mounting (accessing inlineShortcuts requires mounted element)
		try {
			if ( mf.inlineShortcuts ) {
				// Allows external listeners to inject custom MathLive shortcuts by mutating event.detail.
				const customShortcuts: InlineShortcutDefinitions = {};
				document.dispatchEvent( new CustomEvent( 'mathlive:custom-shortcuts', { detail: customShortcuts } ) );
				mf.inlineShortcuts = { ...mf.inlineShortcuts, ...customShortcuts };
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
			/* v8 ignore next 3 -- re-entrancy latch: set only while the partner handler writes */
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
		/* v8 ignore next 3 -- defensive: every caller checks for the math field first */
		if ( !this.mathfield ) {
			return;
		}
		this.mathfield.setValue( value, { silenceNotifications: true } );
	}

	public hideKeyboard(): void {
		window.mathVirtualKeyboard?.hide();
	}

	public focus(): void {
		if ( this.mathfield ) {
			this.mathfield.focus();
		} else {
			this.latexTextAreaView.focus();
		}
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

// MathLive looks a locale up as given, then by its first two letters, and files Simplified Chinese
// under `zh-cn`, which CKEditor calls `zh`.
function toMathLiveLocale( uiLanguage: string ): string {
	return uiLanguage === 'zh' ? 'zh-cn' : uiLanguage;
}

// The scrolling `.ck-mathlive-container` clips the toggles' tooltips, so these rules fix them to
// their toggles. `::part()` can't tell MathLive's menu rows from its headings and grid cells, or
// reach a swatch's color or a checkmark, so the menu rules read variables that fall back to
// MathLive's values.
const SHADOW_STYLES = `@supports (position-area: top) {
	[part='virtual-keyboard-toggle'] {
		anchor-name: --ck-math-keyboard-toggle;
	}
	[part='menu-toggle'] {
		anchor-name: --ck-math-menu-toggle;
	}
	[part='virtual-keyboard-toggle']::after {
		position-anchor: --ck-math-keyboard-toggle;
	}
	[part='menu-toggle']::after {
		position-anchor: --ck-math-menu-toggle;
	}
	:is([part='virtual-keyboard-toggle'], [part='menu-toggle'])::after {
		position: fixed;
		inset: auto;
		margin-bottom: 4px;
		position-area: top;
		position-try-fallbacks: flip-block;
	}
}
:where(.ui-menu-container > li:not([role='divider'])) {
	margin: var(--ck-math-menu-item-margin, 0 6px);
	padding: var(--ck-math-menu-item-padding, 1px 7px);
	border-radius: var(--ck-math-menu-item-border-radius, 4px);
}
:where(.ui-menu-container > li:has(> .heading)) {
	margin: var(--ck-math-menu-heading-margin, 0.5em 6px 0);
	padding: var(--ck-math-menu-heading-padding, 1px 7px);
	border-bottom: var(--ck-math-menu-heading-border, none);
	opacity: var(--ck-math-menu-heading-opacity, 0.5);
}
:where(.ui-menu-container > li > .heading) {
	font-size: var(--ck-math-menu-heading-font-size, inherit);
	font-weight: var(--ck-math-menu-heading-font-weight, bold);
	letter-spacing: var(--ck-math-menu-heading-letter-spacing, inherit);
	text-transform: var(--ck-math-menu-heading-text-transform, none);
	color: var(--ck-math-menu-heading-color, inherit);
	opacity: var(--ck-math-menu-heading-opacity, 0.4);
}
.swatches-submenu {
	--_swatch-size: var(--ck-math-menu-swatch-size, 2rem);
	max-width: calc(
		var(--_columns) * (var(--_swatch-size) + var(--ck-math-menu-swatch-gap, 18px)) + 16px
	);
}
.menu-swatch {
	background: var(--ck-math-menu-swatch-background, var(--neutral-200));
}
.menu-swatch.active {
	background: var(--ck-math-menu-swatch-background, var(--neutral-100));
}
.menu-swatch > .label > span {
	/* Besides two of these margins, a gap holds two 2px swatch margins and two 1px label borders. */
	margin: calc((var(--ck-math-menu-swatch-gap, 18px) - 6px) / 2);
	box-shadow: var(--ck-math-menu-swatch-shadow, none);
	border-radius: var(--ck-math-menu-swatch-border-radius, 50%);
}
.menu-swatch.active > .label > span {
	border-radius: var(--ck-math-menu-swatch-border-radius, 2px);
}
.ui-menu-container > li:not(.menu-swatch) > :is(.ui-checkmark, .ui-mixedmark) {
	order: var(--ck-math-menu-checkmark-order, 0);
	margin-inline: var(--ck-math-menu-checkmark-margin-inline, -4px -11px);
	color: var(--ck-math-menu-checkmark-color, inherit);
}
:where(.ui-menu-container > li > .label.indent) {
	margin-inline-start: var(--ck-math-menu-checkmark-indent, 12px);
}`;

let shadowStyleSheet: CSSStyleSheet | undefined;

function adoptShadowStyles( mathfield: HTMLElement ): void {
	const root = mathfield.shadowRoot;
	/* v8 ignore next 3 -- MathLive attaches an open shadow root in the math-field constructor */
	if ( !root ) {
		return;
	}
	if ( !shadowStyleSheet ) {
		shadowStyleSheet = new CSSStyleSheet();
		shadowStyleSheet.replaceSync( SHADOW_STYLES );
	}
	root.adoptedStyleSheets = [ ...root.adoptedStyleSheets, shadowStyleSheet ];
}
