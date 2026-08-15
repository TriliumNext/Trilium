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
import { keepSuggestionPopoverSteady } from './suggestion_popover.js';
import { loadMathLive } from './mathlive_loader.js';
import { debounce } from '../mermaid/utils.js';

// Time in milliseconds between a keystroke in the math field and the model update.
const DEBOUNCE_TIME = 300;

/**
 * The pointer dead zone at the bottom of an overflowing field, in pixels: tall enough to cover
 * an overlay scrollbar's thumb (which takes no layout space, so it cannot be measured), and
 * matched by the reserved bottom padding in math.css so no equation glyphs sit under it.
 */
const SCROLLBAR_DEAD_ZONE = 12;

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

	/**
	 * Types LaTeX into the live field at its caret, MathLive's own `#?` placeholders included,
	 * and hands focus back to it. The model catches up through the usual debounced sync, since
	 * MathLive reports a programmatic insert as an `input` event like any other edit.
	 *
	 * The caret lands in the first placeholder, so a matrix is ready to be filled in — and, since
	 * that leaves the caret *inside* the new structure, whatever the balloon offers for it is
	 * reachable straight away. LaTeX with no placeholder puts the caret after the insert instead.
	 *
	 * `selectionMode` is MathLive's: `'placeholder'` for LaTeX that opens somewhere to type, and
	 * `'item'` for LaTeX built around `#@` — the selection itself — where leaving the result
	 * selected is what lets a second accent stack on top of the first.
	 *
	 * @returns `false` when no field is mounted, so there was nothing to write into.
	 */
	public insertIntoField( latex: string, selectionMode: 'placeholder' | 'item' = 'placeholder' ): boolean {
		const mathfield = this._session?.mathfield;
		if ( !mathfield?.insert ) {
			return false;
		}

		mathfield.insert( latex, { selectionMode } );
		mathfield.focus();
		return true;
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
		// The `isWidget` context matters for the fake-selected state: crossing a block boundary
		// towards an equation fake-selects it (a Widget default this handler cannot see coming
		// from `$text`), and the NEXT press must step into the field rather than skip past it.
		this.listenTo<ViewDocumentArrowKeyEvent>( viewDocument, 'arrowKey', ( evt, data ) => {
			if ( editor.isReadOnly || data.shiftKey || data.altKey || data.ctrlKey || data.metaKey ) {
				return;
			}
			if ( data.keyCode !== keyCodes.arrowleft && data.keyCode !== keyCodes.arrowright ) {
				return;
			}
			const forward = isForwardArrowKeyCode( data.keyCode, editor.locale.contentLanguageDirection );

			// A fake-selected equation: enter it at the end the caret is arriving from.
			const selected = getSelectedMathModelWidget( editor.model.document.selection );
			const element = selected ?? this._getAdjacentMathElement( forward );
			if ( !element ) {
				return;
			}
			data.preventDefault();
			evt.stop();
			this._startElement( element, { caret: forward ? 'start' : 'end' } );
		}, { context: [ isWidget, '$text' ], priority: 'highest' } );

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
				safeFocus( this._session.mathfield );
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
		// Shown by MathLive while the field is empty, i.e. in a freshly inserted equation.
		mathfield.placeholder = `\\text{${ escapeLatexText( editor.t( 'Type an equation' ) ) }}`;
		mathfield.value = String( element.getAttribute( 'equation' ) ?? '' );
		body.appendChild( mathfield );

		// Mirrors the popup editor's extra shortcuts — must be set after mounting.
		if ( mathfield.inlineShortcuts ) {
			mathfield.inlineShortcuts = { ...mathfield.inlineShortcuts, dx: 'dx', dy: 'dy', dt: 'dt' };
		}

		// Between the host and [part=container] sits a wrapper with no part attribute — CSS
		// cannot reach it, and it otherwise sizes itself to the equation's full single-line
		// width, spilling out of the capped host instead of letting the content scroll.
		const contentPart = mathfield.shadowRoot?.querySelector( '[part=content]' );
		const shadowWrapper = mathfield.shadowRoot?.querySelector<HTMLElement>( '[part=container]' )?.parentElement;
		if ( shadowWrapper ) {
			shadowWrapper.style.maxWidth = '100%';
		}

		// The host is shrink-to-fit, so any content growth (first render, font swaps, the
		// editable resizing) changes the box — typing growth once capped is handled by the
		// field's own input events.
		const overflowObserver = new ResizeObserver( () => updateOverflowState( mathfield ) );
		if ( contentPart ) {
			overflowObserver.observe( contentPart );
		}

		this._session = {
			element, mathfield, preview, overflowObserver,
			popoverObserver: keepSuggestionPopoverSteady()
		};
		this._wireFieldEvents( mathfield, element );
		this.fire<MathLiveSessionStartEvent>( 'sessionStart', { mathfield } );

		requestAnimationFrame( () => {
			safeFocus( mathfield );
			this._placeCaret( mathfield, entry );
			updateOverflowState( mathfield );
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
		mathfield.addEventListener( 'input', () => {
			// After MathLive has re-rendered the content for this edit.
			requestAnimationFrame( () => updateOverflowState( mathfield ) );
		} );

		// Grabbing the scrollbar of an overflowing field must not also drag out a selection:
		// MathLive's pointer tracking starts on any pointerdown in the field, the scrollbar
		// included. Classic scrollbars occupy a measurable strip below clientHeight; overlay
		// scrollbars (Firefox on GTK) take no layout space at all and are painted over the
		// bottom pixels of the content — with the drag dispatching the full pointer stream —
		// so the guard dead-zones the bottom strip whenever the field is overflowing. The CSS
		// reserves matching bottom padding, keeping the zone free of glyphs. Stopping the
		// event leaves the native scrollbar interaction itself untouched.
		mathfield.addEventListener( 'pointerdown', evt => {
			if ( !mathfield.hasAttribute( 'data-overflowing' ) ) {
				return;
			}
			const content = mathfield.shadowRoot?.querySelector( '[part=content]' );
			if ( !content ) {
				return;
			}
			const rect = content.getBoundingClientRect();
			const classicStrip = rect.height - content.clientTop - content.clientHeight;
			const strip = Math.max( classicStrip, SCROLLBAR_DEAD_ZONE );
			if ( evt.clientY >= rect.bottom - strip ) {
				evt.stopPropagation();
			}
		}, { capture: true } );

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
			// Typing `\` puts the field in LaTeX mode, where a command is being spelled out with
			// a suggestion list open. MathLive binds all three of these keys there — Enter accepts
			// the entry with its suggestion, Tab accepts the suggestion alone, Escape accepts what
			// was typed without it — so leaving the field instead would tear the entry down
			// mid-command, taking a freshly inserted equation with it (an unfinished LaTeX group
			// is not in the field's value yet, and an empty equation is removed on commit).
			if ( mathfield.mode === 'latex' ) {
				return;
			}

			// Backspace or Delete in an empty field takes the equation itself. Stepping into an
			// equation is what these keys do at its boundary, so this is where they arrive when
			// the user means to get rid of one — and inside an empty field MathLive has nothing
			// left to delete, so it only plonks, leaving an equation inserted by mistake with no
			// way out. Committing an empty field is already how a widget is removed.
			if ( ( evt.key === 'Backspace' || evt.key === 'Delete' ) && !mathfield.value.trim() ) {
				evt.preventDefault();
				evt.stopPropagation();
				this._leaveField( element, evt.key === 'Backspace' ? 'before' : 'after' );
				return;
			}

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
		const model = editor.model;
		this._commitSession();
		// Focus first: while the view is unfocused a model selection is not rendered to the DOM,
		// and focusing afterwards would let the browser place a default caret (start of the
		// editable) that the selection observer then writes back over the model selection.
		editor.editing.view.focus();
		if ( !isAttached( element ) ) {
			return;
		}
		model.change( writer => {
			if ( placement === 'on' ) {
				writer.setSelection( element, 'on' );
				return;
			}
			const forward = placement === 'after';
			// For a display equation the position next to it sits between blocks, where no
			// caret can live. Setting the selection there would make the post-fixer snap it
			// back "on" the widget — and the next arrow press would walk straight back into
			// the field, trapping the caret. Resolve to the nearest real caret position in
			// the exit direction instead (for an inline equation this is the position itself).
			const edge = forward ? writer.createPositionAfter( element ) : writer.createPositionBefore( element );
			const range = model.schema.getNearestSelectionRange( edge, forward ? 'forward' : 'backward' );
			if ( range ) {
				writer.setSelection( range );
				return;
			}
			// Nothing on that side (document edge): give the caret a paragraph to land in.
			const paragraph = writer.createElement( 'paragraph' );
			writer.insert( paragraph, edge );
			writer.setSelection( paragraph, 'in' );
		} );
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
		session.overflowObserver.disconnect();
		session.popoverObserver.disconnect();
		const equation = mathfield.value.trim();

		// Blur while the internals are still alive. Firefox delivers no blur event when a
		// focused element is removed, which would leave MathLive's module-global focus
		// bookkeeping pointing at the disposed field — and crash the next field's focus.
		mathfield.blur();
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
		// Same as in _commitSession: blur while alive, or Firefox leaves MathLive's focus
		// bookkeeping pointing at the disposed field.
		session.overflowObserver.disconnect();
		session.popoverObserver.disconnect();
		session.mathfield.blur();
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

	/** Keeps the overflow marker current while the field's box settles (first render, fonts). */
	overflowObserver: ResizeObserver;

	/** Keeps the LaTeX suggestion popover from blinking as MathLive rebuilds it per keystroke. */
	popoverObserver: MutationObserver;
}

interface MathFieldElement extends HTMLElement {
	value: string;
	readOnly: boolean;
	defaultMode: 'inline-math' | 'math' | 'text';

	/** What the caret is currently typing into; `'latex'` while a command is being spelled out. */
	readonly mode: 'math' | 'text' | 'latex';

	mathVirtualKeyboardPolicy: string;
	placeholder: string;
	position: number;
	lastOffset: number;
	inlineShortcuts?: Record<string, string>;
	insert?: ( latex: string, options?: { selectionMode?: 'placeholder' | 'after' | 'before' | 'item' } ) => void;
	setValue?: ( value: string, options?: { silenceNotifications?: boolean } ) => void;
}

/**
 * Focuses a math field, tolerating a poisoned MathLive focus registry. If any earlier field was
 * disposed while it still held focus (a removal in Firefox delivers no blur event, and other code
 * or a hard editor teardown can drop a focused field the same way), MathLive's `onFocus` blurs
 * that stale field first and crashes on its disposed internals. The failed attempt clears the
 * stale registry entry before throwing, so a single retry succeeds.
 */
function safeFocus( mathfield: MathFieldElement ): void {
	try {
		mathfield.focus();
	} catch {
		mathfield.focus();
	}
}

/**
 * Marks a field whose single-line content is wider than its capped box, so the theme can put a
 * real scrollbar on it — MathLive only ever scrolls programmatically, hiding the overflow. The
 * attribute (rather than an unconditional `overflow-x: auto`) exists because sub-pixel host
 * widths round `scrollWidth` one pixel past `clientWidth`, which would summon a scrollbar under
 * every equation.
 */
function updateOverflowState( mathfield: MathFieldElement ): void {
	const content = mathfield.shadowRoot?.querySelector( '[part=content]' );
	if ( content ) {
		mathfield.toggleAttribute( 'data-overflowing', content.scrollWidth > content.clientWidth + 2 );
	}
}

/**
 * Makes a translated string safe to embed in a LaTeX `\text{…}`: characters with an escape get
 * one, the few without (group braces, backslash, superscript/tie markers) are dropped.
 */
function escapeLatexText( text: string ): string {
	return text.replace( /[\\{}^~]/g, '' ).replace( /([%$#&_])/g, '\\$1' );
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
