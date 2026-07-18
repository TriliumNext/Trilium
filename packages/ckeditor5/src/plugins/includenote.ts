import { ButtonView, Command, type Editor, type ModelElement, Plugin, toWidget, type ViewElement, Widget, type Observable } from 'ckeditor5';
import noteIcon from '../icons/note.svg?raw';

export const COMMAND_NAME = 'insertIncludeNote';
export const BOX_SIZE_COMMAND_NAME = 'includeNoteBoxSize';

export const BOX_SIZES = [
	{ value: 'small', label: 'Small' },
	{ value: 'medium', label: 'Medium' },
	{ value: 'full', label: 'Full' },
	{ value: 'expandable', label: 'Expandable' }
] as const;

export type BoxSizeValue = typeof BOX_SIZES[number]['value'];

export default class IncludeNote extends Plugin {
	static get requires() {
		return [ IncludeNoteEditing, IncludeNoteUI ];
	}
}

class IncludeNoteUI extends Plugin {
	init() {
		const editor = this.editor;
		const t = editor.t;

		// The "includeNote" button must be registered among the UI components of the editor
		// to be displayed in the toolbar.
		editor.ui.componentFactory.add( 'includeNote', locale => {
			// The state of the button will be bound to the widget command.
			const command = editor.commands.get( COMMAND_NAME );

			// The button will be an instance of ButtonView.
			const buttonView = new ButtonView( locale );

			buttonView.set( {
				// The t() function helps localize the editor. All strings enclosed in t() can be
				// translated and change when the language of the editor changes.
				label: t( 'Include note' ),
				icon: noteIcon,
				tooltip: true
			} );

			// Bind the state of the button to the command.
            if (command) {
                buttonView.bind( 'isOn', 'isEnabled' ).to( command as Observable & { value: boolean; } & { isEnabled: boolean; }, 'value', 'isEnabled' );
            }

			// Execute the command when the button is clicked (executed).
			this.listenTo( buttonView, 'execute', () => editor.execute( COMMAND_NAME ) );

			return buttonView;
		} );
	}
}

class IncludeNoteEditing extends Plugin {
	static get requires() {
		return [ Widget ];
	}

	init() {
		this._defineSchema();
		this._defineConverters();

		this.editor.commands.add( COMMAND_NAME, new InsertIncludeNoteCommand( this.editor ) );
		this.editor.commands.add( BOX_SIZE_COMMAND_NAME, new IncludeNoteBoxSizeCommand( this.editor ) );
	}

	_defineSchema() {
		const schema = this.editor.model.schema;

		schema.register( 'includeNote', {
			// Behaves like a self-contained object (e.g. an image).
			isObject: true,

			allowAttributes: [ 'noteId', 'boxSize' ],

			// Allow in places where other blocks are allowed (e.g. directly in the root).
			allowWhere: '$block'
		} );
	}

	_defineConverters() {
		const editor = this.editor;
		const conversion = editor.conversion;

		// <includeNote> converters
		conversion.for( 'upcast' ).elementToElement( {
			model: ( viewElement, { writer: modelWriter } ) => {

				return modelWriter.createElement( 'includeNote', {
					noteId: viewElement.getAttribute( 'data-note-id' ),
					boxSize: viewElement.getAttribute( 'data-box-size' ),
				} );
			},
			view: {
				name: 'section',
				classes: 'include-note'
			}
		} );
		conversion.for( 'dataDowncast' ).elementToElement( {
			model: 'includeNote',
			view: ( modelElement, { writer: viewWriter } ) => {
				// it would make sense here to downcast to <iframe>, with this even HTML export can support note inclusion
				return viewWriter.createContainerElement( 'section', {
					class: 'include-note',
					'data-note-id': modelElement.getAttribute( 'noteId' ),
					'data-box-size': modelElement.getAttribute( 'boxSize' ),
				} );
			}
		} );
		conversion.for( 'editingDowncast' ).elementToElement( {
			model: 'includeNote',
			view: ( modelElement, { writer: viewWriter } ) => {

				const noteId = modelElement.getAttribute( 'noteId' ) as string;
				const boxSize = modelElement.getAttribute( 'boxSize' ) as string | undefined;

				const section = viewWriter.createContainerElement( 'section', {
					class: 'include-note box-size-' + boxSize,
					'data-note-id': noteId,
					'data-box-size': boxSize
				} );

				const includedNoteWrapper = viewWriter.createUIElement( 'div', {
					class: 'include-note-wrapper',
					"data-cke-ignore-events": true
				}, function( domDocument ) {
					const domElement = this.toDomElement( domDocument );

					const editorEl = editor.editing.view.getDomRoot();
					const component = glob.getComponentByEl<EditorComponent>( editorEl );

					component.loadIncludedNote( noteId, $( domElement ), boxSize );

					preventCKEditorHandling( domElement, editor );

					return domElement;
				} );

				viewWriter.insert( viewWriter.createPositionAt( section, 0 ), includedNoteWrapper );

				// hasSelectionHandle gives the block widget CKEditor's own drag grip so it moves
				// atomically, instead of the browser's native drag tearing the embedded note apart.
				return toWidget( section, viewWriter, { label: 'include note widget', hasSelectionHandle: true } );
			}
		} );

		// Handle boxSize attribute changes on existing elements
		conversion.for( 'editingDowncast' ).add( dispatcher => {
			dispatcher.on( 'attribute:boxSize:includeNote', ( evt, data, conversionApi ) => {
				const viewElement = conversionApi.mapper.toViewElement( data.item );
				/* v8 ignore next 3 -- defensive guard: when the attribute:boxSize event fires the model item is always mapped to a rendered view element; forcing an unmapped state (mapper.unbindModelElement) crashes the conversion pipeline elsewhere before this guard can be observed, so it is unreachable from a unit test */
				if ( !viewElement ) {
					return;
				}

				const viewWriter = conversionApi.writer;
				const oldBoxSize = data.attributeOldValue as string;
				const newBoxSize = data.attributeNewValue as string;

				// Remove old class and add new class
				if ( oldBoxSize ) {
					viewWriter.removeClass( 'box-size-' + oldBoxSize, viewElement );
				}
				if ( newBoxSize ) {
					viewWriter.addClass( 'box-size-' + newBoxSize, viewElement );
					viewWriter.setAttribute( 'data-box-size', newBoxSize, viewElement );

					// Re-render the included note content with the new box size. We drive this
					// directly from the converter (rather than observing the DOM attribute) so the
					// content is only rebuilt on a genuine box-size change — not whenever CKEditor
					// re-applies unrelated attributes (e.g. `draggable` while selecting the widget).
					reloadIncludedNote( editor, viewElement, data.item as ModelElement, newBoxSize );
				}
			} );
		} );
	}
}

class InsertIncludeNoteCommand extends Command {
	override execute() {
		const editorEl = this.editor.editing.view.getDomRoot();
		const component = glob.getComponentByEl(editorEl);

		component.triggerCommand('addIncludeNoteToText');
	}

	override refresh() {
		const model = this.editor.model;
		const selection = model.document.selection;
        const firstPosition = selection.getFirstPosition();
		const allowedIn = firstPosition && model.schema.findAllowedParent( firstPosition, 'includeNote' );

		this.isEnabled = allowedIn !== null;
	}
}

class IncludeNoteBoxSizeCommand extends Command {
	declare value: BoxSizeValue | null;

	override execute( options: { value: BoxSizeValue } ) {
		const model = this.editor.model;
		const includeNoteElement = this._getSelectedIncludeNote();

		if ( includeNoteElement ) {
			model.change( writer => {
				writer.setAttribute( 'boxSize', options.value, includeNoteElement );
			} );
		}
	}

	override refresh() {
		const includeNoteElement = this._getSelectedIncludeNote();

		this.isEnabled = !!includeNoteElement;
		this.value = includeNoteElement?.getAttribute( 'boxSize' ) as BoxSizeValue | null ?? null;
	}

	private _getSelectedIncludeNote() {
		const selection = this.editor.model.document.selection;
		const selectedElement = selection.getSelectedElement();

		if ( selectedElement?.name === 'includeNote' ) {
			return selectedElement;
		}

		// Check if we're inside an include note
		const firstPosition = selection.getFirstPosition();
		return firstPosition?.findAncestor( 'includeNote' ) ?? null;
	}
}

/**
 * Re-renders the included note content of an already-rendered widget after its box size changed.
 *
 * The wrapper is a `UIElement` whose DOM is opaque to CKEditor, so we reach into it directly to
 * trigger the client-side render. The box size is passed explicitly because, at conversion time,
 * the updated `data-box-size` attribute may not yet be flushed to the DOM.
 *
 * On the initial insert the attribute converter runs before the widget has been rendered to the
 * DOM, so `mapViewToDom()` returns nothing and this is a no-op — the `UIElement` render callback
 * performs that first paint instead. It only does work on a subsequent, genuine box-size change.
 */
function reloadIncludedNote( editor: Editor, viewElement: ViewElement, modelElement: ModelElement, boxSize: string ) {
	const sectionDom = editor.editing.view.domConverter.mapViewToDom( viewElement );
	const wrapperDom = sectionDom?.querySelector<HTMLElement>( '.include-note-wrapper' );
	const noteId = modelElement.getAttribute( 'noteId' ) as string | undefined;

	if ( wrapperDom && noteId ) {
		const component = glob.getComponentByEl<EditorComponent>( editor.editing.view.getDomRoot() );
		component.loadIncludedNote( noteId, $( wrapperDom ), boxSize );
	}
}

/**
 * Hack coming from https://github.com/ckeditor/ckeditor5/issues/4465
 * Source issue: https://github.com/zadam/trilium/issues/1117
 */
function preventCKEditorHandling( domElement: HTMLElement, editor: Editor ) {
	// Prevent the editor from listening on below events in order to stop rendering selection.

	// commenting out click events to allow link click handler to still work
	//domElement.addEventListener( 'click', stopEventPropagationAndHackRendererFocus, { capture: true } );

	domElement.addEventListener( 'mousedown', ( evt: MouseEvent ) => {
		// Interactive embedded content — links, form controls, and live widgets such as collections
		// (geo map, calendar, board, table) — needs the browser's native event handling to remain
		// usable, e.g. dragging a geo-map marker relies on the mousedown reaching Leaflet. Leave those
		// events completely alone: don't stop propagation, suppress the default, or steal selection.
		if ( isInteractiveTarget( evt.target, domElement ) ) {
			return;
		}

		evt.stopPropagation();

		// Suppress the browser's native caret on non-interactive areas. The widget's <section> is
		// contenteditable=false inside an editable root, so the default mousedown action drops a caret
		// next to it that visibly moves as the user clicks around.
		evt.preventDefault();

		// This prevents rendering changed view selection thus preventing to changing DOM selection while inside a widget.
		//@ts-expect-error: We are accessing a private field.
		editor.editing.view._renderer.isFocused = false;

		// Select the widget so the toolbar can appear
		selectIncludeNoteWidget( domElement, editor );
	}, { capture: true } );

	domElement.addEventListener( 'focus', stopEventPropagationAndHackRendererFocus, { capture: true } );

	// Prevents TAB handling or other editor keys listeners which might be executed on editors selection.
	domElement.addEventListener( 'keydown', stopEventPropagationAndHackRendererFocus, { capture: true } );

	function stopEventPropagationAndHackRendererFocus( evt: Event ) {
		evt.stopPropagation();
		// This prevents rendering changed view selection thus preventing to changing DOM selection while inside a widget.
        //@ts-expect-error: We are accessing a private field.
		editor.editing.view._renderer.isFocused = false;
	}
}

/**
 * Whether a mousedown target needs the browser's native handling to keep working — so the widget's
 * event interception should step aside. Covers form controls, links and media (which need focus,
 * caret or their own controls) and, crucially, live embedded widgets: web views and collection views
 * (geo map, calendar, board, table) whose own drag/click handlers rely on the native event.
 *
 * The match is bounded to within `boundary` (the widget wrapper) so the editable editor root — an
 * ancestor with `contenteditable="true"` — is never mistaken for an interactive target.
 */
function isInteractiveTarget( target: EventTarget | null, boundary: HTMLElement ): boolean {
	if ( !( target instanceof Element ) ) {
		return false;
	}

	const match = target.closest(
		'.rendered-collection, .note-detail-web-view, ' +
		'a, button, input, textarea, select, label, audio, video, ' +
		'[role="button"], [role="textbox"], [contenteditable]:not([contenteditable="false"])'
	);

	return !!match && boundary.contains( match );
}

function selectIncludeNoteWidget( domElement: HTMLElement, editor: Editor ) {
	// Find the parent section element (the widget container)
	const sectionElement = domElement.closest( 'section.include-note' ) as HTMLElement | null;
	if ( !sectionElement ) {
		return;
	}

	// Get the view element from the DOM element
	const viewElement = editor.editing.view.domConverter.mapDomToView( sectionElement );
	if ( !viewElement || !viewElement.is( 'element' ) ) {
		return;
	}

	// Get the model element from the view element
	const modelElement = editor.editing.mapper.toModelElement( viewElement );
	if ( !modelElement ) {
		return;
	}

	// Focus the editor view first to ensure selection sync works
	editor.editing.view.focus();

	// Select the model element using a non-undoable batch so it doesn't affect undo
	editor.model.enqueueChange( { isUndoable: false }, writer => {
		writer.setSelection( modelElement, 'on' );
	} );
}
