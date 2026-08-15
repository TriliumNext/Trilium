// In-place equation editing: mounts a MathLive <math-field> inside the selected math widget
// (replacing the static KaTeX/MathJax preview for the duration of the edit) instead of opening
// a balloon popup. MathLive is lazy-loaded on the first edit, exactly like the old dialog did.
import { Plugin, type ModelElement } from 'ckeditor5';
import { getSelectedMathModelWidget } from './utils.js';
import { debounce } from '../mermaid/utils.js';
import 'mathlive/fonts.css';
import 'mathlive/static.css';

// Time in milliseconds between a keystroke in the math field and the model update.
const DEBOUNCE_TIME = 300;

export default class MathLiveEdit extends Plugin {
	public static get pluginName() {
		return 'MathLiveEdit' as const;
	}

	private _session: EditSession | null = null;

	public init(): void {
		// The widget can disappear under an active session (undo of the insertion, remote sync).
		this.listenTo( this.editor.model.document, 'change:data', () => {
			if ( this._session && !isAttached( this._session.element ) ) {
				this._abortSession();
			}
		} );
	}

	public override destroy(): void {
		super.destroy();
		this._abortSession();
	}

	/**
	 * Starts editing the currently selected equation in place. Without a selected equation,
	 * inserts a new empty one (inline, or display when requested) and starts editing that.
	 */
	public startEditing( options: { display?: boolean } = {} ): void {
		const editor = this.editor;
		const model = editor.model;

		let element = getSelectedMathModelWidget( model.document.selection );

		if ( this._session ) {
			if ( element && this._session.element === element ) {
				this._session.mathfield.focus();
				return;
			}
			this._commitSession();
		}

		if ( !element ) {
			const display = options.display ?? false;
			model.change( writer => {
				const mathtex = writer.createElement(
					display ? 'mathtex-display' : 'mathtex-inline',
					{
						// Inherit all attributes from selection (e.g. color, background color, size).
						...Object.fromEntries( model.document.selection.getAttributes() ),
						equation: '',
						type: editor.config.get( 'math' )?.outputType ?? 'script',
						display
					}
				);
				model.insertContent( mathtex );
				writer.setSelection( mathtex, 'on' );
				element = mathtex;
			} );
		}

		if ( element ) {
			void this._mountMathField( element );
		}
	}

	private async _mountMathField( element: ModelElement ): Promise<void> {
		const editor = this.editor;

		if ( !await loadMathLive() ) {
			console.warn( 'math-live-load-failed: could not load the MathLive editor' );
			return;
		}

		// The load is asynchronous — re-check the world before touching it.
		if ( this._session || editor.state === 'destroyed' || !isAttached( element ) ) {
			return;
		}

		const widgetDom = this._getWidgetDomElement( element );
		const body = widgetDom?.querySelector<HTMLElement>( '.ck-math-widget-body' );
		if ( !body ) {
			return;
		}

		const preview = body.querySelector<HTMLElement>( '.ck-math-widget-preview' );
		preview?.classList.add( 'ck-hidden' );

		const display = !!element.getAttribute( 'display' );
		const mathfield = document.createElement( 'math-field' ) as MathFieldElement;
		// Keeps CKEditor's observers (keystrokes, mouse, selection) away from the field.
		mathfield.setAttribute( 'data-cke-ignore-events', 'true' );
		mathfield.setAttribute( 'tabindex', '0' );
		mathfield.defaultMode = display ? 'math' : 'inline-math';
		mathfield.mathVirtualKeyboardPolicy = 'auto';
		mathfield.value = String( element.getAttribute( 'equation' ) ?? '' );
		body.appendChild( mathfield );

		// Mirrors the popup editor's extra shortcuts — must be set after mounting.
		if ( mathfield.inlineShortcuts ) {
			mathfield.inlineShortcuts = { ...mathfield.inlineShortcuts, dx: 'dx', dy: 'dy', dt: 'dt' };
		}

		this._session = { element, mathfield, preview };
		this._wireFieldEvents( mathfield, element );

		requestAnimationFrame( () => mathfield.focus() );
	}

	private _wireFieldEvents( mathfield: MathFieldElement, element: ModelElement ): void {
		const editor = this.editor;

		const syncToModel = debounce( () => {
			if ( this._session?.mathfield !== mathfield || !isAttached( element ) ) {
				return;
			}
			const equation = mathfield.value;
			if ( element.getAttribute( 'equation' ) !== equation ) {
				editor.model.change( writer => {
					writer.setAttribute( 'equation', equation, element );
				} );
			}
		}, DEBOUNCE_TIME );

		mathfield.addEventListener( 'input', syncToModel );

		// Arrow navigation past the field boundary walks out into the surrounding text.
		mathfield.addEventListener( 'move-out', evt => {
			const direction = ( evt as CustomEvent<{ direction: string }> ).detail?.direction;
			const backward = direction === 'backward' || direction === 'upward';
			this._leaveField( element, backward ? 'before' : 'after' );
		} );

		mathfield.addEventListener( 'keydown', evt => {
			if ( evt.key === 'Escape' ) {
				evt.preventDefault();
				evt.stopPropagation();
				this._leaveField( element, 'on' );
			} else if ( evt.key === 'Enter' ) {
				evt.preventDefault();
				evt.stopPropagation();
				this._leaveField( element, 'after' );
			} else if ( evt.key === 'Tab' ) {
				evt.preventDefault();
				evt.stopPropagation();
				this._leaveField( element, evt.shiftKey ? 'before' : 'after' );
			}
		}, { capture: true } );

		mathfield.addEventListener( 'focusout', evt => {
			const related = evt.relatedTarget;
			// Interacting with MathLive's own floating UI (virtual keyboard, menu) is not leaving.
			if ( related instanceof Node && ( mathfield.contains( related ) || isMathLiveOverlay( related ) ) ) {
				return;
			}
			this._commitSession();
		} );
	}

	private _leaveField( element: ModelElement, placement: 'before' | 'after' | 'on' ): void {
		const editor = this.editor;
		this._commitSession();
		if ( isAttached( element ) ) {
			editor.model.change( writer => {
				writer.setSelection( element, placement );
			} );
		}
		editor.editing.view.focus();
	}

	/** Unmounts the field and writes the result to the model; an emptied equation is removed. */
	private _commitSession(): void {
		const session = this._session;
		if ( !session ) {
			return;
		}
		this._session = null;

		const { element, mathfield, preview } = session;
		const equation = mathfield.value.trim();

		mathfield.remove();
		preview?.classList.remove( 'ck-hidden' );
		window.mathVirtualKeyboard?.hide();

		if ( !isAttached( element ) ) {
			return;
		}

		this.editor.model.change( writer => {
			if ( !equation ) {
				writer.remove( element );
			} else if ( element.getAttribute( 'equation' ) !== equation ) {
				writer.setAttribute( 'equation', equation, element );
			}
		} );
	}

	/** Unmounts the field without touching the model (the widget is already gone). */
	private _abortSession(): void {
		const session = this._session;
		if ( !session ) {
			return;
		}
		this._session = null;
		session.mathfield.remove();
		session.preview?.classList.remove( 'ck-hidden' );
		window.mathVirtualKeyboard?.hide();
	}

	private _getWidgetDomElement( element: ModelElement ): HTMLElement | null {
		const viewElement = this.editor.editing.mapper.toViewElement( element );
		if ( !viewElement ) {
			return null;
		}
		const dom = this.editor.editing.view.domConverter.mapViewToDom( viewElement );
		return dom instanceof HTMLElement ? dom : null;
	}
}

interface EditSession {
	element: ModelElement;
	mathfield: MathFieldElement;
	preview: HTMLElement | null;
}

interface MathFieldElement extends HTMLElement {
	value: string;
	readOnly: boolean;
	defaultMode: 'inline-math' | 'math' | 'text';
	mathVirtualKeyboardPolicy: string;
	inlineShortcuts?: Record<string, string>;
	setValue?: ( value: string, options?: { silenceNotifications?: boolean } ) => void;
}

function isAttached( element: ModelElement ): boolean {
	const root = element.root;
	return root.is( 'rootElement' ) && root.rootName !== '$graveyard';
}

function isMathLiveOverlay( node: Node ): boolean {
	return node instanceof Element && node.closest( '.ML__keyboard, .ML__popover, .ML__menu' ) !== null;
}

let mathLiveLoad: Promise<boolean> | undefined;

function loadMathLive(): Promise<boolean> {
	mathLiveLoad ??= ( async () => {
		try {
			await import( 'mathlive' );
			await customElements.whenDefined( 'math-field' );
			const mathfieldClass = customElements.get( 'math-field' ) as unknown as
				{ soundsDirectory: string | null; plonkSound: string | null } | undefined;
			if ( mathfieldClass ) {
				mathfieldClass.soundsDirectory = null;
				mathfieldClass.plonkSound = null;
			}
			return true;
		} catch {
			return false;
		}
	} )();
	return mathLiveLoad;
}
