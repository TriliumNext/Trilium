// In-place equation editing: promotes a math widget's static MathLive preview to an editable
// <math-field> and demotes it back on exit. Since both render through MathLive, the swap is
// pixel-identical — which makes the promotion read as a caret simply entering the equation.
// Entry points: clicking the equation (caret lands at the click point), arrow keys walking in
// from the surrounding text, Backspace/Delete stepping in from a boundary, Enter on a selected
// widget, and the toolbar button / Ctrl+M / `$$` autoformat via {@link startEditing}.
import {
	ClickObserver,
	isForwardArrowKeyCode,
	isWidget,
	keyCodes,
	MouseObserver,
	Plugin,
	type ModelElement,
	type ModelNode,
	type ViewDocumentArrowKeyEvent,
	type ViewDocumentClickEvent,
	type ViewDocumentDeleteEvent,
	type ViewDocumentEnterEvent,
	type ViewDocumentMouseDownEvent
} from 'ckeditor5';
import { getSelectedMathModelWidget } from './utils.js';
import { loadMathLive } from './mathlive_loader.js';
import { debounce } from '../mermaid/utils.js';

// Time in milliseconds between a keystroke in the math field and the model update.
const DEBOUNCE_TIME = 300;

/** How the caret should land in the field when editing starts. */
interface MathEntryPoint {
	caret?: 'start' | 'end';
	pointer?: { x: number; y: number };
}

export default class MathLiveEdit extends Plugin {
	public static get pluginName() {
		return 'MathLiveEdit' as const;
	}

	private _session: EditSession | null = null;
	private _lastPointer: { x: number; y: number; time: number } | null = null;

	/**
	 * The equation with a field mounted in it, if any. Not the same as the selected widget: the
	 * arrow-key and Backspace entry points mount a field while the model selection stays in the
	 * surrounding text.
	 */
	public get editedElement(): ModelElement | null {
		return this._session?.element ?? null;
	}

	public init(): void {
		const editor = this.editor;

		// The widget can disappear under an active session (undo of the insertion, remote sync).
		this.listenTo( editor.model.document, 'change:data', () => {
			if ( this._session && !isAttached( this._session.element ) ) {
				this._abortSession();
			}
		} );

		this.listenTo( editor, 'change:isReadOnly', () => {
			if ( editor.isReadOnly ) {
				this._commitSession();
			}
		} );

		this._enableSeamlessEntry();
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

		if ( editor.isReadOnly ) {
			return;
		}

		let element = getSelectedMathModelWidget( model.document.selection );

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
			this._startElement( element, { caret: 'end' } );
		}
	}

	/** The seamless entry points: click, horizontal arrows, Backspace/Delete, Enter. */
	private _enableSeamlessEntry(): void {
		const editor = this.editor;
		const view = editor.editing.view;
		const viewDocument = view.document;

		view.addObserver( MouseObserver );
		view.addObserver( ClickObserver );

		// Remember where the mouse went down, to place the caret there after promoting.
		this.listenTo<ViewDocumentMouseDownEvent>( viewDocument, 'mousedown', ( _evt, data ) => {
			const domEvent = data.domEvent;
			this._lastPointer = { x: domEvent.clientX, y: domEvent.clientY, time: performance.now() };
		} );

		// Clicking an equation edits it where the click landed.
		this.listenTo<ViewDocumentClickEvent>( viewDocument, 'click', () => {
			if ( editor.isReadOnly ) {
				return;
			}
			const element = getSelectedMathModelWidget( editor.model.document.selection );
			if ( !element ) {
				return;
			}
			const pointer = this._takeFreshPointer();
			this._startElement( element, pointer ? { pointer } : { caret: 'end' } );
		} );

		// Arrow keys walk into an adjacent equation instead of fake-selecting the widget.
		this.listenTo<ViewDocumentArrowKeyEvent>( viewDocument, 'arrowKey', ( evt, data ) => {
			if ( editor.isReadOnly || data.shiftKey || data.altKey || data.ctrlKey || data.metaKey ) {
				return;
			}
			if ( data.keyCode !== keyCodes.arrowleft && data.keyCode !== keyCodes.arrowright ) {
				return;
			}
			const forward = isForwardArrowKeyCode( data.keyCode, editor.locale.contentLanguageDirection );
			const element = this._getAdjacentMathElement( forward );
			if ( !element ) {
				return;
			}
			data.preventDefault();
			evt.stop();
			this._startElement( element, { caret: forward ? 'start' : 'end' } );
		}, { context: '$text', priority: 'highest' } );

		// Backspace/Delete at an equation boundary steps into it rather than selecting it.
		this.listenTo<ViewDocumentDeleteEvent>( viewDocument, 'delete', ( evt, data ) => {
			if ( editor.isReadOnly ) {
				return;
			}
			const forward = data.direction === 'forward';
			const element = this._getAdjacentMathElement( forward );
			if ( !element ) {
				return;
			}
			data.preventDefault();
			evt.stop();
			this._startElement( element, { caret: forward ? 'start' : 'end' } );
		}, { context: '$text', priority: 'highest' } );

		// Enter on a fake-selected equation edits it instead of splitting around it.
		this.listenTo<ViewDocumentEnterEvent>( viewDocument, 'enter', ( evt, data ) => {
			if ( editor.isReadOnly ) {
				return;
			}
			const element = getSelectedMathModelWidget( editor.model.document.selection );
			if ( !element ) {
				return;
			}
			data.preventDefault();
			evt.stop();
			this._startElement( element, { caret: 'end' } );
		}, { context: isWidget, priority: 'highest' } );
	}

	/** The equation next to a collapsed selection in the given direction, if any. */
	private _getAdjacentMathElement( forward: boolean ): ModelElement | null {
		const selection = this.editor.model.document.selection;
		if ( !selection.isCollapsed ) {
			return null;
		}
		const position = selection.getFirstPosition();
		if ( !position ) {
			return null;
		}

		const inlineNode = forward ? position.nodeAfter : position.nodeBefore;
		if ( isMathtex( inlineNode ) ) {
			return inlineNode;
		}

		// Crossing a block boundary into a display equation.
		const block = position.parent;
		if ( block.is( 'element' ) ) {
			if ( forward && position.isAtEnd && isMathtex( block.nextSibling ) ) {
				return block.nextSibling;
			}
			if ( !forward && position.isAtStart && isMathtex( block.previousSibling ) ) {
				return block.previousSibling;
			}
		}
		return null;
	}

	private _takeFreshPointer(): { x: number; y: number } | null {
		const pointer = this._lastPointer;
		this._lastPointer = null;
		if ( !pointer || performance.now() - pointer.time > 1000 ) {
			return null;
		}
		return { x: pointer.x, y: pointer.y };
	}

	private _startElement( element: ModelElement, entry: MathEntryPoint ): void {
		if ( this.editor.isReadOnly ) {
			return;
		}
		if ( this._session ) {
			if ( this._session.element === element ) {
				this._session.mathfield.focus();
				this._placeCaret( this._session.mathfield, entry );
				return;
			}
			this._commitSession();
		}
		void this._mountMathField( element, entry );
	}

	private async _mountMathField( element: ModelElement, entry: MathEntryPoint ): Promise<void> {
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
		this.fire<MathLiveSessionStartEvent>( 'sessionStart', { mathfield } );

		requestAnimationFrame( () => {
			mathfield.focus();
			this._placeCaret( mathfield, entry );
		} );
	}

	private _placeCaret( mathfield: MathFieldElement, entry: MathEntryPoint ): void {
		if ( entry.pointer && forwardPointerToField( mathfield, entry.pointer ) ) {
			return;
		}
		mathfield.position = entry.caret === 'start' ? 0 : mathfield.lastOffset;
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
			const customEvt = evt as CustomEvent<{ direction: string }>;
			const direction = customEvt.detail?.direction;
			const backward = direction === 'backward' || direction === 'upward';

			// This event is dispatched from inside MathLive's keystroke pipeline, which keeps
			// using the field's internals after our listener returns. Cancel it (so MathLive
			// skips its "plonk" announcement on the field we are leaving) and defer the actual
			// unmount until the keystroke task has finished — tearing the field down
			// synchronously crashes that pipeline ("this.mathfield is undefined" in announce()).
			customEvt.preventDefault();
			queueMicrotask( () => {
				if ( this._session?.mathfield === mathfield ) {
					this._leaveField( element, backward ? 'before' : 'after' );
				}
			} );
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
			// Reaching for floating UI that belongs to the session — MathLive's own virtual
			// keyboard or menu, or the editor's balloon — is not leaving the field.
			if ( related instanceof Node && ( mathfield.contains( related ) || isSessionOverlay( related ) ) ) {
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
		this.fire<MathLiveSessionEndEvent>( 'sessionEnd' );

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
		this.fire<MathLiveSessionEndEvent>( 'sessionEnd' );
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

/** Fired once a `<math-field>` is mounted and wired, i.e. whenever an equation goes live. */
export type MathLiveSessionStartEvent = {
	name: 'sessionStart';
	args: [ { mathfield: HTMLElement } ];
};

/** Fired when that field is torn down, whether the result was committed or discarded. */
export type MathLiveSessionEndEvent = {
	name: 'sessionEnd';
	args: [];
};

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
	position: number;
	lastOffset: number;
	inlineShortcuts?: Record<string, string>;
	setValue?: ( value: string, options?: { silenceNotifications?: boolean } ) => void;
}

function isMathtex( node: ModelNode | null ): node is ModelElement {
	return !!node && ( node.is( 'element', 'mathtex-inline' ) || node.is( 'element', 'mathtex-display' ) );
}

function isAttached( element: ModelElement ): boolean {
	const root = element.root;
	return root.is( 'rootElement' ) && root.rootName !== '$graveyard';
}

function isSessionOverlay( node: Node ): boolean {
	return node instanceof Element &&
		node.closest( '.ML__keyboard, .ML__popover, .ML__menu, .ck-balloon-panel' ) !== null;
}

/**
 * Lands the caret at the point the user clicked by replaying the click on the mounted field.
 * MouseEvents with pointer-event names on purpose: MathLive's own listener hit-tests the caret
 * from `clientX`/`clientY`, but a genuine synthetic `PointerEvent` would make it call
 * `setPointerCapture()` with a pointer id the browser never activated, which throws.
 */
function forwardPointerToField( mathfield: MathFieldElement, point: { x: number; y: number } ): boolean {
	const rect = mathfield.getBoundingClientRect();
	if ( point.x < rect.left || point.x > rect.right || point.y < rect.top || point.y > rect.bottom ) {
		return false;
	}
	const init: MouseEventInit = { clientX: point.x, clientY: point.y, cancelable: true };
	mathfield.dispatchEvent( new MouseEvent( 'pointerdown', init ) );
	// The matching "up" must land on the field content inside the shadow root — that is where
	// MathLive's pointer tracker listens — or the next mouse move would extend the selection.
	const content = mathfield.shadowRoot?.querySelector( '[part=content]' );
	( content ?? mathfield ).dispatchEvent( new MouseEvent( 'pointerup', init ) );
	return true;
}
