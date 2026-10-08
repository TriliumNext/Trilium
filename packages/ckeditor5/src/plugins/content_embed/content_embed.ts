import {
	ButtonView,
	Command,
	type DowncastConversionApi,
	type Editor,
	enableViewPlaceholder,
	IconCaption,
	IconLink,
	IconThreeVerticalDots,
	type MapperModelToViewPositionEvent,
	ModelElement,
	type ModelNode,
	type ModelDocumentFragment,
	type ModelWriter,
	type PlaceholderableViewElement,
	Plugin,
	toWidget,
	toWidgetEditable,
	type ViewEditableElement,
	type ViewElement,
	Widget,
	type Observable
} from 'ckeditor5';
import editIcon from 'boxicons/svg/regular/bx-edit-alt.svg?raw';
import windowIcon from 'boxicons/svg/regular/bx-window-alt.svg?raw';
import noteIcon from '../../icons/note.svg?raw';
import { encodeBlockParameter, parseBlockRange } from '@triliumnext/commons';
import { getAttachmentId, getNoteId } from '../referencelink.js';
import ResizableWidgets, { SIZE_ATTRIBUTES } from '../resizable_widgets/resizable_widgets.js';
import './nested_editor_events.js';

export const COMMAND_NAME = 'insertContentEmbed';
export const BOX_SIZE_COMMAND_NAME = 'contentEmbedBoxSize';
export const CONVERT_LINK_TO_EMBED_COMMAND = 'convertLinkToEmbed';
export const CONVERT_EMBED_TO_LINK_COMMAND = 'convertEmbedToLink';
export const TOGGLE_CAPTION_COMMAND_NAME = 'toggleContentEmbedCaption';
export const TOGGLE_TITLE_COMMAND_NAME = 'toggleContentEmbedTitle';
export const TOGGLE_EDITABLE_COMMAND_NAME = 'toggleContentEmbedEditable';
/** The toolbar button that opens the context menu of an embed whose title is hidden. */
export const CONTENT_EMBED_MENU = 'contentEmbedMenu';

export const BOX_SIZES = [ 'tiny', 'small', 'medium', 'full', 'expandable' ] as const;

export type BoxSizeValue = typeof BOX_SIZES[number];

/** The box sizes that can be resized. Tiny and Full fit their content. */
const RESIZABLE_BOX_SIZES: unknown[] = [ 'small', 'medium', 'expandable' ];

/** The flags of an embed, each saved as `"true"` in a `data-*` attribute while it is on. */
const FLAG_ATTRIBUTES = [
	[ 'hideTitle', 'data-hide-title' ],
	[ 'editable', 'data-editable' ]
] as const;

type EmbedFlag = typeof FLAG_ATTRIBUTES[number][0];

/** What the toolbar of an embed shows of it, for a menu offering the same commands. */
export interface ContentEmbedState {
	/** Whether the content can be edited in place. */
	isEditable: boolean;
	/** Whether the content has an editable mode, which its content type opts in to. */
	isEditableToggleable: boolean;
	boxSize: BoxSizeValue | null;
	/** Whether the title shows, which a Tiny or an Expandable embed always does. */
	isTitleShown: boolean;
	isTitleToggleable: boolean;
	hasCaption: boolean;
	isCaptionToggleable: boolean;
	isConvertibleToLink: boolean;
}

/**
 * The user-facing name of a box size, as shown by the widget toolbar's dropdown.
 *
 * A switch rather than a table of labels, so that each one is written as a literal argument of a
 * `t()` call: that is how the messages this package owns are discovered (see `messages.ts`) and a
 * label tucked away in a table would be invisible to translators.
 *
 * @param t the editor's translation function.
 * @param size the box size; an unrecognized one has no label and is returned as-is.
 */
export function getBoxSizeLabel(t: (message: string) => string, size: BoxSizeValue): string {
	switch (size) {
		case 'tiny':
			return t('Tiny');
		case 'small':
			return t('Small');
		case 'medium':
			return t('Medium');
		case 'full':
			return t('Full');
		case 'expandable':
			return t('Expandable');
		default:
			return size;
	}
}

export default class ContentEmbed extends Plugin {
	/** The buttons that the content of the selected embed adds to its toolbar, or `null`. */
	declare public selectedEmbedTools: ContentEmbedToolProvider | null;

	static get requires() {
		return [ ContentEmbedEditing, ContentEmbedUI ];
	}

	static get pluginName() {
		return 'ContentEmbed' as const;
	}

	constructor( editor: Editor ) {
		super( editor );
		// Set before `init()` of the plugins it requires, whose toolbar items bind to it.
		this.set( 'selectedEmbedTools', null );
	}

	init() {
		// Runs before `WidgetToolbarRepository` positions the toolbar from its width.
		this.listenTo( this.editor.ui, 'update', () => {
			this.selectedEmbedTools = getSelectedEmbedTools( this.editor );
		}, { priority: 'high' } );
	}

	/**
	 * Selects the embed that `domElement` is part of, so that commands act on the embed a
	 * context menu is opened on. Returns `false` when `domElement` is not part of an embed of
	 * this editor.
	 */
	selectEmbedAt( domElement: Element ): boolean {
		const embed = getContentEmbedAt( this.editor, domElement );
		if ( !embed ) {
			return false;
		}

		this.editor.model.enqueueChange( { isUndoable: false }, writer => {
			writer.setSelection( embed, 'on' );
		} );
		return true;
	}

	/**
	 * The state of the embed that `domElement` is part of, as its toolbar shows it with the
	 * embed selected, or `null`. The selection is left as it is.
	 */
	getEmbedStateAt( domElement: Element ): ContentEmbedState | null {
		const editor = this.editor;
		const embed = getContentEmbedAt( editor, domElement );
		if ( !embed ) {
			return null;
		}

		const isTitleToggleable = isEmbedTitleToggleable( embed );
		return {
			isEditable: !!embed.getAttribute( 'editable' ),
			isEditableToggleable: isEmbedEditableToggleable( editor, embed ),
			boxSize: embed.getAttribute( 'boxSize' ) as BoxSizeValue | undefined ?? null,
			isTitleShown: !isTitleToggleable || !embed.getAttribute( 'hideTitle' ),
			isTitleToggleable,
			hasCaption: !!getCaption( embed ),
			isCaptionToggleable: isEmbedCaptionToggleable( editor, embed ),
			isConvertibleToLink: isEmbedConvertibleToLink( editor, embed )
		};
	}

	/** Whether `domElement` is a reference link that `convertLinkToEmbed` turns into an embed. */
	canConvertLinkToEmbed( domElement: HTMLElement ): boolean {
		return !!getLinkToEmbed( this.editor, domElement );
	}

	/** The box sizes, with the labels the toolbar gives them. */
	getBoxSizes(): { value: BoxSizeValue; label: string }[] {
		return BOX_SIZES.map( value => ( { value, label: getBoxSizeLabel( this.editor.t, value ) } ) );
	}
}

class ContentEmbedUI extends Plugin {
	init() {
		const editor = this.editor;
		const t = editor.t;

		// The "contentEmbed" button must be registered among the UI components of the editor
		// to be displayed in the toolbar.
		editor.ui.componentFactory.add( 'contentEmbed', locale => {
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

		editor.ui.componentFactory.add( CONVERT_EMBED_TO_LINK_COMMAND, locale => {
			const command = editor.commands.get( CONVERT_EMBED_TO_LINK_COMMAND );
			const buttonView = new ButtonView( locale );

			buttonView.set( {
				label: t( 'Convert to link' ),
				icon: IconLink,
				tooltip: true
			} );

			// Shown only on an embed that names a note or an attachment.
			if ( command ) {
				buttonView.bind( 'isEnabled' ).to( command );
				bindToolbarItemVisibility(
					editor, buttonView, command, CONVERT_EMBED_TO_LINK_COMMAND
				);
			}

			this.listenTo( buttonView, 'execute', () => {
				editor.execute( CONVERT_EMBED_TO_LINK_COMMAND );
			} );

			return buttonView;
		} );

		editor.ui.componentFactory.add( TOGGLE_CAPTION_COMMAND_NAME, locale => {
			const command = editor.commands.get( TOGGLE_CAPTION_COMMAND_NAME );
			const buttonView = new ButtonView( locale );

			buttonView.set( {
				label: t( 'Toggle caption on' ),
				icon: IconCaption,
				tooltip: true,
				isToggleable: true
			} );

			if ( command ) {
				buttonView.bind( 'isOn', 'isEnabled' ).to( command, 'value', 'isEnabled' );
				buttonView.bind( 'label' ).to( command, 'value', value =>
					value ? t( 'Toggle caption off' ) : t( 'Toggle caption on' ) );
			}

			this.listenTo( buttonView, 'execute', () => {
				editor.execute( TOGGLE_CAPTION_COMMAND_NAME, { focusCaptionOnShow: true } );
				editor.editing.view.focus();
			} );

			return buttonView;
		} );

		editor.ui.componentFactory.add( TOGGLE_EDITABLE_COMMAND_NAME, locale => {
			const command = editor.commands.get( TOGGLE_EDITABLE_COMMAND_NAME );
			const buttonView = new ButtonView( locale );

			buttonView.set( {
				label: t( 'Editable' ),
				icon: editIcon,
				tooltip: true,
				isToggleable: true
			} );

			// Shown only for content that has an editable mode.
			if ( command ) {
				buttonView.bind( 'isOn', 'isEnabled' ).to( command, 'value', 'isEnabled' );
				buttonView.bind( 'isVisible' ).to( command, 'isEnabled' );
			}

			this.listenTo( buttonView, 'execute', () => {
				editor.execute( TOGGLE_EDITABLE_COMMAND_NAME );
				editor.editing.view.focus();
			} );

			return buttonView;
		} );

		editor.ui.componentFactory.add( TOGGLE_TITLE_COMMAND_NAME, locale => {
			const command = editor.commands.get( TOGGLE_TITLE_COMMAND_NAME );
			const buttonView = new ButtonView( locale );

			buttonView.set( {
				label: t( 'Show title' ),
				icon: windowIcon,
				tooltip: true,
				isToggleable: true
			} );

			if ( command ) {
				buttonView.bind( 'isOn', 'isEnabled' ).to( command, 'value', 'isEnabled' );
				bindToolbarItemVisibility( editor, buttonView, command, TOGGLE_TITLE_COMMAND_NAME );
			}

			this.listenTo( buttonView, 'execute', () => {
				editor.execute( TOGGLE_TITLE_COMMAND_NAME );
				editor.editing.view.focus();
			} );

			return buttonView;
		} );

		editor.ui.componentFactory.add( CONTENT_EMBED_MENU, locale => {
			const command = editor.commands.get( TOGGLE_TITLE_COMMAND_NAME );
			const buttonView = new ButtonView( locale );

			buttonView.set( {
				label: t( 'More actions' ),
				icon: IconThreeVerticalDots,
				tooltip: true
			} );

			// Replaces the menu button of the title row while the title is hidden.
			if ( command ) {
				buttonView.bind( 'isEnabled' ).to( command );
				buttonView.bind( 'isVisible' ).to( command, 'isEnabled', command, 'value',
					( isEnabled, isTitleShown ) => isEnabled && !isTitleShown );
			}

			this.listenTo( buttonView, 'execute', () => {
				openContentEmbedMenu( editor, buttonView.element );
			} );

			return buttonView;
		} );
	}
}

class ContentEmbedEditing extends Plugin {
	static get requires() {
		return [ Widget, ResizableWidgets ];
	}

	static get pluginName() {
		return 'ContentEmbedEditing' as const;
	}

	/** The captions that were hidden or that a Tiny box size removed, by embed. */
	private readonly savedCaptions = new WeakMap<ModelElement, unknown>();

	/** The embeds whose saved caption a Tiny box size removed. */
	private readonly tinyEmbeds = new WeakSet<ModelElement>();

	init() {
		this._defineSchema();
		this._defineConverters();

		const editor = this.editor;
		editor.plugins.get( ResizableWidgets ).register( 'contentEmbed', {
			propertyPrefix: '--include-note',
			isWidthResizable: true,
			isHeightResizable: true,
			isCentered: true,
			heightTarget: '.include-note-content',
			minWidth: 10,
			minHeight: 3,
			isResizable: embed => RESIZABLE_BOX_SIZES.includes( embed.getAttribute( 'boxSize' ) )
		} );

		const commands = editor.commands;
		commands.add( COMMAND_NAME, new InsertContentEmbedCommand( editor ) );
		commands.add( BOX_SIZE_COMMAND_NAME, new ContentEmbedBoxSizeCommand( editor ) );
		commands.add( CONVERT_LINK_TO_EMBED_COMMAND, new ConvertLinkToEmbedCommand( editor ) );
		commands.add( CONVERT_EMBED_TO_LINK_COMMAND, new ConvertEmbedToLinkCommand( editor ) );
		commands.add( TOGGLE_CAPTION_COMMAND_NAME, new ToggleContentEmbedCaptionCommand( editor ) );
		commands.add( TOGGLE_TITLE_COMMAND_NAME, new ToggleContentEmbedTitleCommand( editor ) );
		commands.add(
			TOGGLE_EDITABLE_COMMAND_NAME, new ToggleContentEmbedEditableCommand( editor ) );

		editor.model.document.registerPostFixer( writer => this.removeTinyCaptions( writer ) );

		// Widget UI sets `_renderer.isFocused` to false on a press. The view ignores its events
		// (`data-cke-ignore-events`), so a press or key that the view sees is back in the text.
		const viewDocument = editor.editing.view.document;
		const restore = () => restoreRendererFocus( editor );
		this.listenTo( viewDocument, 'mousedown', restore, { priority: 'highest' } );
		this.listenTo( viewDocument, 'keydown', restore, { priority: 'highest' } );
	}

	/** Keeps a copy of `caption`, for `embed` to show again. */
	saveCaption( embed: ModelElement, caption: ModelElement ) {
		this.savedCaptions.set( embed, caption.toJSON() );
		this.tinyEmbeds.delete( embed );
	}

	/** A copy of the caption last saved for `embed`, or `null`. */
	getSavedCaption( embed: ModelElement ): ModelElement | null {
		const json = this.savedCaptions.get( embed );
		return json ? ModelElement.fromJSON( json ) : null;
	}

	/** A copy of the caption that a Tiny box size removed from `embed`, or `null`. */
	takeTinyCaption( embed: ModelElement ): ModelElement | null {
		return this.tinyEmbeds.delete( embed ) ? this.getSavedCaption( embed ) : null;
	}

	_defineSchema() {
		const schema = this.editor.model.schema;

		schema.register( 'contentEmbed', {
			// Behaves like a self-contained object (e.g. an image).
			isObject: true,
			isBlock: true,

			// An embed shows either a note or an attachment. An embed that
			// `FileUploadEditing` is uploading carries the upload attributes instead of its id.
			allowAttributes: [
				'noteId', 'block', 'attachmentId', 'boxSize', 'hideTitle', 'editable', 'uploadId',
				'uploadStatus', 'uploadFileName'
			],

			// Allow in places where other blocks are allowed (e.g. directly in the root).
			allowWhere: '$block'
		} );

		// `ImageCaptionEditing` and `TableCaptionEditing` share the same `caption` element.
		if ( schema.isRegistered( 'caption' ) ) {
			schema.extend( 'caption', { allowIn: 'contentEmbed' } );
		} else {
			schema.register( 'caption', {
				allowIn: 'contentEmbed',
				allowContentOf: '$block',
				isLimit: true
			} );
		}
	}

	_defineConverters() {
		const editor = this.editor;
		const conversion = editor.conversion;
		const t = editor.t;

		// <contentEmbed> converters
		conversion.for( 'upcast' ).elementToElement( {
			model: ( viewElement, { writer: modelWriter } ) => {
				const attachmentId = viewElement.getAttribute( 'data-attachment-id' );
				const block = viewElement.getAttribute( 'data-block' );
				const embedded = attachmentId
					? { attachmentId }
					: { noteId: viewElement.getAttribute( 'data-note-id' ), ...( block ? { block } : {} ) };

				return modelWriter.createElement( 'contentEmbed', {
					...embedded,
					boxSize: viewElement.getAttribute( 'data-box-size' ),
					...getFlagsOfView( viewElement )
				} );
			},
			// Embeds saved before captions existed are `<section>` elements.
			view: {
				name: /^(?:figure|section)$/,
				classes: 'include-note'
			}
		} );
		conversion.for( 'dataDowncast' ).elementToElement( {
			model: 'contentEmbed',
			view: ( modelElement, { writer: viewWriter } ) => {
				return viewWriter.createContainerElement( 'figure', {
					class: 'include-note',
					...getEmbeddedEntityAttributes( modelElement ),
					'data-box-size': modelElement.getAttribute( 'boxSize' ),
					...getFlagAttributes( modelElement )
				} );
			}
		} );
		conversion.for( 'editingDowncast' ).elementToElement( {
			model: 'contentEmbed',
			view: ( modelElement, { writer: viewWriter } ) => {

				const boxSize = modelElement.getAttribute( 'boxSize' ) as string | undefined;

				const figure = viewWriter.createContainerElement( 'figure', {
					class: 'include-note box-size-' + boxSize,
					...getEmbeddedEntityAttributes( modelElement ),
					'data-box-size': boxSize,
					...getFlagAttributes( modelElement )
				} );

				const embedWrapper = viewWriter.createUIElement( 'div', {
					class: 'include-note-wrapper',
					"data-cke-ignore-events": true
				}, function( domDocument ) {
					const domElement = this.toDomElement( domDocument );

					showEmbeddedContent( editor, modelElement, domElement );
					preventCKEditorHandling( domElement, editor );

					return domElement;
				} );

				viewWriter.insert( viewWriter.createPositionAt( figure, 0 ), embedWrapper );

				// hasSelectionHandle gives the block widget CKEditor's own drag grip so it moves
				// atomically, instead of the browser's native drag tearing the embedded note apart.
				// The label is announced by screen readers; lowercase to match the "image widget" /
				// "table widget" labels CKEditor gives its own widgets.
				return toWidget( figure, viewWriter, {
					label: editor.t( 'include note widget' ),
					hasSelectionHandle: true
				} );
			}
		} );

		// Handle boxSize attribute changes on existing elements
		conversion.for( 'editingDowncast' ).add( dispatcher => {
			dispatcher.on( 'attribute:boxSize:contentEmbed', ( evt, data, conversionApi ) => {
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

					// Re-render the embedded note content with the new box size. We drive this
					// directly from the converter (rather than observing the DOM attribute) so the
					// content is only rebuilt on a genuine box-size change — not whenever CKEditor
					// re-applies unrelated attributes (e.g. `draggable` while selecting the widget).
					reloadEmbeddedContent( editor, viewElement, data.item as ModelElement, newBoxSize );
				}
			} );

			// Marks the view of the embed without drawing the content again. Content with an
			// editable mode reads `data-editable` from the embed.
			for ( const [ flag, dataAttribute ] of FLAG_ATTRIBUTES ) {
				dispatcher.on( `attribute:${ flag }:contentEmbed`, ( _evt, data, api ) => {
					const viewElement = api.mapper.toViewElement( data.item as ModelElement );
					/* v8 ignore next 3 -- converted after the embed itself, so always mapped */
					if ( !viewElement ) {
						return;
					}

					if ( data.attributeNewValue ) {
						api.writer.setAttribute( dataAttribute, 'true', viewElement );
					} else {
						api.writer.removeAttribute( dataAttribute, viewElement );
					}
				} );
			}

			// Redraws the content in place when an upload ends. A converter that lists
			// `attributes` also reconverts the embed on every change of its children, such as
			// a caption toggle.
			for ( const attribute of [ 'attachmentId', 'block', 'uploadFileName' ] ) {
				dispatcher.on( `attribute:${ attribute }:contentEmbed`, ( _evt, data, api ) => {
					redrawEmbeddedEntity( editor, data.item as ModelElement, api );
				} );
			}
		} );

		// <caption> converters, for the caption of an embed only
		conversion.for( 'upcast' ).elementToElement( {
			view: element => isContentEmbedCaptionView( element ) ? { name: true } : null,
			model: 'caption'
		} );
		conversion.for( 'dataDowncast' ).elementToElement( {
			model: 'caption',
			view: ( modelElement, { writer: viewWriter } ) => isContentEmbed( modelElement.parent )
				? viewWriter.createContainerElement( 'figcaption' )
				: null
		} );
		conversion.for( 'editingDowncast' ).elementToElement( {
			model: 'caption',
			view: ( modelElement, { writer: viewWriter } ) => {
				if ( !isContentEmbed( modelElement.parent ) ) {
					return null;
				}

				const figcaption: ViewEditableElement & PlaceholderableViewElement =
					viewWriter.createEditableElement( 'figcaption' );
				figcaption.placeholder = t( 'Enter caption' );
				enableViewPlaceholder( {
					view: editor.editing.view,
					element: figcaption,
					keepOnFocus: true
				} );

				return toWidgetEditable( figcaption, viewWriter, {
					label: t( 'Caption for the included note' )
				} );
			}
		} );

		// The default mapping places model offset 0 before the content wrapper, which has no model
		// length. The caption goes after it.
		editor.editing.mapper.on<MapperModelToViewPositionEvent>(
			'modelToViewPosition',
			( _evt, data ) => {
				const parent = data.modelPosition.parent;
				const viewElement = parent.is( 'element', 'contentEmbed' )
					? data.mapper.toViewElement( parent )
					: undefined;
				if ( !viewElement ) {
					return;
				}

				const offset = getWrapperIndex( viewElement ) + 1 + data.modelPosition.offset;
				data.viewPosition = editor.editing.view.createPositionAt(
					viewElement, Math.min( offset, viewElement.childCount ) );
			}
		);
	}

	/**
	 * Removes the caption of every Tiny embed that a change touched, keeping a copy for when
	 * the embed gets a larger box size.
	 */
	private removeTinyCaptions( writer: ModelWriter ) {
		const embeds = new Set<ModelElement>();
		for ( const change of this.editor.model.document.differ.getChanges() ) {
			if ( change.type === 'attribute' && change.attributeKey === 'boxSize' ) {
				addContentEmbeds( embeds, change.range.start.nodeAfter );
			} else if ( change.type === 'insert' && change.name === 'caption' ) {
				addContentEmbeds( embeds, change.position.parent );
			} else if ( change.type === 'insert' && change.name !== '$text' ) {
				addContentEmbeds( embeds, change.position.nodeAfter );
			}
		}

		let isChanged = false;
		for ( const embed of embeds ) {
			const caption = getCaption( embed );
			if ( caption && embed.getAttribute( 'boxSize' ) === 'tiny' ) {
				this.saveCaption( embed, caption );
				this.tinyEmbeds.add( embed );
				writer.remove( caption );
				isChanged = true;
			}
		}

		return isChanged;
	}
}

class InsertContentEmbedCommand extends Command {
	override execute() {
		const editorEl = this.editor.editing.view.getDomRoot();
		const component = glob.getComponentByEl(editorEl);

		component.triggerCommand('addIncludeNoteToText');
	}

	override refresh() {
		const model = this.editor.model;
		const selection = model.document.selection;
        const firstPosition = selection.getFirstPosition();
		const allowedIn = firstPosition && model.schema.findAllowedParent( firstPosition, 'contentEmbed' );

		this.isEnabled = allowedIn !== null;
	}
}

class ContentEmbedBoxSizeCommand extends Command {
	declare value: BoxSizeValue | null;

	/**
	 * Sets the box size of the selected embed and resets its height. Tiny and Full reset the
	 * width too. Tiny takes the caption away, and a larger size shows it again.
	 */
	override execute( options: { value: BoxSizeValue } ) {
		const editor = this.editor;
		const embedElement = getSelectedContentEmbed( editor );

		if ( embedElement ) {
			editor.model.change( writer => {
				const wasTiny = embedElement.getAttribute( 'boxSize' ) === 'tiny';
				writer.setAttribute( 'boxSize', options.value, embedElement );
				writer.removeAttribute( SIZE_ATTRIBUTES.height, embedElement );
				if ( !RESIZABLE_BOX_SIZES.includes( options.value ) ) {
					writer.removeAttribute( SIZE_ATTRIBUTES.width, embedElement );
				}

				if ( options.value === 'tiny' ) {
					writer.setSelection( embedElement, 'on' );
				} else if ( wasTiny && !getCaption( embedElement ) ) {
					const caption = editor.plugins.get( ContentEmbedEditing )
						.takeTinyCaption( embedElement );
					if ( caption ) {
						writer.append( caption, embedElement );
					}
				}
			} );
		}
	}

	override refresh() {
		const embedElement = getSelectedContentEmbed( this.editor );

		this.isEnabled = !!embedElement;
		this.value = embedElement?.getAttribute( 'boxSize' ) as BoxSizeValue | null ?? null;
	}
}

/** Shows or hides the caption of the selected embed. A Tiny embed has none. */
export class ToggleContentEmbedCaptionCommand extends Command {
	declare value: boolean;

	override refresh() {
		const embed = getSelectedContentEmbed( this.editor );

		this.isEnabled = !!embed && isEmbedCaptionToggleable( this.editor, embed );
		this.value = !!embed && !!getCaption( embed );
	}

	/**
	 * @param options.focusCaptionOnShow whether a caption that the command shows takes the
	 * selection.
	 */
	override execute( { focusCaptionOnShow = false }: { focusCaptionOnShow?: boolean } = {} ) {
		const editor = this.editor;
		const embed = getSelectedContentEmbed( editor );
		if ( !embed ) {
			return;
		}

		const editing = editor.plugins.get( ContentEmbedEditing );
		editor.model.change( writer => {
			const caption = getCaption( embed );
			if ( caption ) {
				editing.saveCaption( embed, caption );
				writer.setSelection( embed, 'on' );
				writer.remove( caption );
				return;
			}

			const shown = editing.getSavedCaption( embed ) ?? writer.createElement( 'caption' );
			writer.append( shown, embed );
			if ( focusCaptionOnShow ) {
				writer.setSelection( shown, 'in' );
			}
		} );
	}
}

/**
 * Shows or hides the title row of the selected embed. A Tiny or an Expandable embed always
 * shows it.
 */
export class ToggleContentEmbedTitleCommand extends Command {
	/** Whether the title shows. */
	declare value: boolean;

	override refresh() {
		const embed = getSelectedContentEmbed( this.editor );

		this.isEnabled = !!embed && isEmbedTitleToggleable( embed );
		this.value = !embed?.getAttribute( 'hideTitle' );
	}

	override execute() {
		toggleSelectedEmbedFlag( this.editor, 'hideTitle' );
	}
}

/**
 * Turns the editing of the selected embed's content on and off, for content whose type has an
 * editable mode.
 */
export class ToggleContentEmbedEditableCommand extends Command {
	/** Whether the content can be edited. */
	declare value: boolean;

	constructor( editor: Editor ) {
		super( editor );
		// Content declares its editable mode once it renders, which changes nothing in the model.
		this.listenTo( editor.ui, 'update', () => this.refresh(), { priority: 'high' } );
	}

	override refresh() {
		const embed = getSelectedContentEmbed( this.editor );

		this.isEnabled = !!embed && isEmbedEditableToggleable( this.editor, embed );
		this.value = !!embed?.getAttribute( 'editable' );
	}

	override execute() {
		toggleSelectedEmbedFlag( this.editor, 'editable' );
	}
}

/** Sets the flag of the selected embed when it is off, and removes it when it is on. */
function toggleSelectedEmbedFlag( editor: Editor, flag: EmbedFlag ) {
	const embed = getSelectedContentEmbed( editor );
	if ( !embed ) {
		return;
	}

	editor.model.change( writer => {
		if ( embed.getAttribute( flag ) ) {
			writer.removeAttribute( flag, embed );
		} else {
			writer.setAttribute( flag, true, embed );
		}
	} );
}

/** Replaces a reference link with an embed of the note or attachment it points to, in its place. */
class ConvertLinkToEmbedCommand extends Command {
	/**
	 * @param options.domElement the link, as the editing view renders it.
	 * @param options.boxSize the size of the embed, `medium` when not given.
	 */
	override execute( { domElement, boxSize }: { domElement: HTMLElement; boxSize?: string } ) {
		const editor = this.editor;
		const link = getLinkToEmbed( editor, domElement );
		if ( !link ) {
			return;
		}

		const { reference, embedded } = link;
		editor.model.change( writer => {
			const embed = writer.createElement( 'contentEmbed', {
				...embedded,
				boxSize: boxSize ?? 'medium'
			} );
			const range = writer.createRangeOn( reference );
			editor.model.insertObject( embed, range, null, { setSelection: 'on' } );
		} );
	}
}

/** Replaces the selected embed with a link to the note or attachment it shows. */
class ConvertEmbedToLinkCommand extends Command {
	override refresh() {
		const embed = getSelectedContentEmbed( this.editor );

		this.isEnabled = !!embed && isEmbedConvertibleToLink( this.editor, embed );
	}

	override async execute() {
		const editor = this.editor;
		const embed = getSelectedContentEmbed( editor );
		const attachmentId = embed?.getAttribute( 'attachmentId' ) as string | undefined;
		const noteId = embed?.getAttribute( 'noteId' ) as string | undefined;
		const block = embed?.getAttribute( 'block' ) as string | undefined;
		if ( !embed || ( !attachmentId && !noteId ) ) {
			return;
		}

		const editorEl = editor.editing.view.getDomRoot();
		const component = glob.getComponentByEl<EditorComponent>( editorEl );
		const blockQuery = block ? `?block=${ encodeBlockParameter( block ) }` : '';
		const href = attachmentId
			? await component.getAttachmentHref( attachmentId )
			: `#root/${ noteId }${ blockQuery }`;

		// The embed can be removed while the host looks the link up.
		const root = embed.root;
		if ( !href || !root.is( 'rootElement' ) || root.rootName === '$graveyard' ) {
			return;
		}

		editor.model.change( writer => {
			const reference = writer.createElement( 'reference', { href } );
			const paragraph = writer.createElement( 'paragraph' );
			writer.append( reference, paragraph );
			writer.insert( paragraph, writer.createPositionBefore( embed ) );
			writer.remove( embed );
			writer.setSelection( reference, 'after' );
		} );
	}
}

/**
 * The reference link that `domElement` renders, and the attributes of an embed showing what it
 * points to, or `null`. Of the links to a part of a note, an embed shows only blocks.
 */
function getLinkToEmbed( editor: Editor, domElement: HTMLElement ) {
	const viewElement = editor.editing.view.domConverter.mapDomToView( domElement );
	const reference = viewElement?.is( 'element' )
		? editor.editing.mapper.toModelElement( viewElement )
		: undefined;
	if ( !reference?.is( 'element', 'reference' ) ) {
		return null;
	}

	const href = reference.getAttribute( 'href' );
	const attachmentId = getAttachmentId( href );
	if ( attachmentId ) {
		return { reference, embedded: { attachmentId } };
	}

	const embedded = getEmbeddedNote( href );
	return embedded ? { reference, embedded } : null;
}

/** The note that `href` points to, and its blocks, or `null` for a link to another part of it. */
function getEmbeddedNote( href: unknown ) {
	const noteId = getNoteId( href );
	if ( !noteId ) {
		return null;
	}

	const query = String( href ).split( '?' )[ 1 ];
	if ( !query ) {
		return { noteId };
	}

	const params = new URLSearchParams( query );
	const block = params.get( 'block' );
	const isBlockOnly = [ ...params.keys() ].every( key => key === 'block' );
	return isBlockOnly && block && parseBlockRange( block ) ? { noteId, block } : null;
}

/** The embed the selection is on or inside, or `null`. */
function getSelectedContentEmbed( editor: Editor ) {
	const selection = editor.model.document.selection;
	const selectedElement = selection.getSelectedElement();

	if ( selectedElement?.name === 'contentEmbed' ) {
		return selectedElement;
	}

	return selection.getFirstPosition()?.findAncestor( 'contentEmbed' ) ?? null;
}

/** The embed whose rendering contains `domElement`, or `null`. */
function getContentEmbedAt( editor: Editor, domElement: Element ) {
	const embedElement = domElement.closest<HTMLElement>( '.include-note' );
	const viewElement = embedElement
		&& editor.editing.view.domConverter.mapDomToView( embedElement );
	if ( !viewElement?.is( 'element' ) ) {
		return null;
	}

	return editor.editing.mapper.toModelElement( viewElement ) ?? null;
}

function isContentEmbed( node: ModelNode | ModelDocumentFragment | null ): node is ModelElement {
	return !!node?.is( 'element', 'contentEmbed' );
}

/** Whether the title of `embed` can be hidden: a Tiny or an Expandable one always shows it. */
function isEmbedTitleToggleable( embed: ModelElement ) {
	const boxSize = embed.getAttribute( 'boxSize' );
	return boxSize !== 'tiny' && boxSize !== 'expandable';
}

/** Whether the content of `embed` has an editable mode, which its content type opts in to. */
function isEmbedEditableToggleable( editor: Editor, embed: ModelElement ) {
	return !!getEmbedTools( editor, embed )?.hasEditableFlag;
}

/** Whether `embed` can have a caption. A Tiny embed has none. */
function isEmbedCaptionToggleable( editor: Editor, embed: ModelElement ) {
	return embed.getAttribute( 'boxSize' ) !== 'tiny'
		&& editor.model.schema.checkChild( embed, 'caption' );
}

/** Whether `embed` names a note or an attachment, which a link can then point to. */
function isEmbedConvertibleToLink( editor: Editor, embed: ModelElement ) {
	return ( !!embed.getAttribute( 'attachmentId' ) || !!embed.getAttribute( 'noteId' ) )
		&& editor.model.schema.isRegistered( 'reference' );
}

/** The caption of `embed`, or `null`. */
function getCaption( embed: ModelElement ) {
	return Array.from( embed.getChildren() )
		.find( ( child ): child is ModelElement => child.is( 'element', 'caption' ) ) ?? null;
}

/** Whether `element` is the `<figcaption>` of an embed. */
function isContentEmbedCaptionView( element: ViewElement ) {
	const parent = element.parent;
	return element.name === 'figcaption' && !!parent?.is( 'element' )
		&& parent.hasClass( 'include-note' );
}

/** The index of the content wrapper among the children of an embed's view, or `-1`. */
function getWrapperIndex( viewElement: ViewElement ) {
	return Array.from( viewElement.getChildren() )
		.findIndex( child => child.is( 'uiElement' ) && child.hasClass( 'include-note-wrapper' ) );
}

/** Adds `node`, when it is an embed, and every embed inside it to `embeds`. */
function addContentEmbeds(
	embeds: Set<ModelElement>,
	node: ModelNode | ModelDocumentFragment | null
) {
	if ( isContentEmbed( node ) ) {
		embeds.add( node );
	} else if ( node?.is( 'element' ) ) {
		for ( const descendant of node.getChildren() ) {
			addContentEmbeds( embeds, descendant );
		}
	}
}

/**
 * The `data-*` attributes naming what an embed shows: an attachment, or a note and the blocks of
 * it. An embed whose upload has not ended names nothing.
 */
function getEmbeddedEntityAttributes( element: ModelElement ): Record<string, string> {
	const attachmentId = element.getAttribute( 'attachmentId' ) as string | undefined;
	const noteId = element.getAttribute( 'noteId' ) as string | undefined;
	const block = element.getAttribute( 'block' ) as string | undefined;

	if ( attachmentId ) {
		return { 'data-attachment-id': attachmentId };
	}
	if ( !noteId ) {
		return {};
	}

	return block ? { 'data-note-id': noteId, 'data-block': block } : { 'data-note-id': noteId };
}

/** The `data-*` attributes of the flags that are on in `element`. */
function getFlagAttributes( element: ModelElement ): Record<string, string> {
	return Object.fromEntries( FLAG_ATTRIBUTES
		.filter( ( [ flag ] ) => element.getAttribute( flag ) )
		.map( ( [ , dataAttribute ] ) => [ dataAttribute, 'true' ] ) );
}

/** The flags that the `data-*` attributes of a saved embed turn on. */
function getFlagsOfView( viewElement: ViewElement ): Partial<Record<EmbedFlag, true>> {
	return Object.fromEntries( FLAG_ATTRIBUTES
		.filter( ( [ , dataAttribute ] ) => viewElement.getAttribute( dataAttribute ) === 'true' )
		.map( ( [ flag ] ) => [ flag, true ] ) );
}

/** Whether the content of the selected embed, whose buttons are `tools`, hides `name`. */
export function isToolbarItemHidden(
	tools: ContentEmbedToolProvider | null,
	name: ContentEmbedToolbarItem
) {
	return !!tools?.hiddenToolbarItems?.includes( name );
}

/**
 * Shows `button` while `command` is enabled, unless the content of the selected embed hides the
 * toolbar item `name`.
 */
function bindToolbarItemVisibility(
	editor: Editor, button: ButtonView, command: Command, name: ContentEmbedToolbarItem
) {
	button.bind( 'isVisible' ).to(
		command, 'isEnabled',
		editor.plugins.get( ContentEmbed ), 'selectedEmbedTools',
		( isEnabled, tools ) => isEnabled && !isToolbarItemHidden( tools, name )
	);
}

/** The buttons that the content of the selected embed adds to its toolbar, or `null`. */
function getSelectedEmbedTools( editor: Editor ): ContentEmbedToolProvider | null {
	return getEmbedTools( editor, getSelectedContentEmbed( editor ) );
}

/** The buttons that the content of `embed` adds to its toolbar, or `null`. */
function getEmbedTools(
	editor: Editor,
	embed: ModelElement | null
): ContentEmbedToolProvider | null {
	const domElement = getContentEmbedDom( editor, embed );
	if ( !domElement ) {
		return null;
	}

	const component: EditorComponent | undefined =
		glob.getComponentByEl<EditorComponent>( editor.editing.view.getDomRoot() );
	return component?.getContentEmbedTools?.( domElement ) ?? null;
}

/** Has the host open the context menu of the selected embed, below `anchor`. */
function openContentEmbedMenu( editor: Editor, anchor: HTMLElement | null ) {
	const domElement = getContentEmbedDom( editor, getSelectedContentEmbed( editor ) );
	if ( !anchor || !domElement ) {
		return;
	}

	const component = glob.getComponentByEl<EditorComponent>( editor.editing.view.getDomRoot() );
	component.openContentEmbedMenu?.( domElement, anchor );
}

/** The rendered `<figure>` of `embed`, or `null`. */
function getContentEmbedDom( editor: Editor, embed: ModelElement | null ): HTMLElement | null {
	const viewElement = embed && editor.editing.mapper.toViewElement( embed );
	const domElement = viewElement && editor.editing.view.domConverter.mapViewToDom( viewElement );
	return domElement instanceof HTMLElement ? domElement : null;
}

/** The title of an embed whose upload is under way: a spinner and the name of the file. */
function createUploadTitle( domDocument: Document, fileName: string ) {
	const title = domDocument.createElement( 'h4' );
	const label = domDocument.createElement( 'span' );
	const spinner = domDocument.createElement( 'span' );
	title.className = 'include-note-title';
	spinner.className = 'bx bx-loader-alt bx-spin';
	label.append( spinner, fileName );
	title.append( label );

	return title;
}

/** What each content wrapper shows, so that it is drawn again only when that changes. */
const shownContents = new WeakMap<HTMLElement, string>();

/**
 * Draws what an embed shows into its content wrapper: the file name while an upload is under
 * way, then the attachment or note.
 */
function showEmbeddedContent( editor: Editor, element: ModelElement, wrapper: HTMLElement ) {
	const uploadFileName = element.getAttribute( 'uploadFileName' ) as string | undefined;
	const shown = uploadFileName
		? `upload:${ uploadFileName }`
		: JSON.stringify( getEmbeddedEntityAttributes( element ) );
	const previous = shownContents.get( wrapper );
	if ( previous === shown ) {
		return;
	}
	shownContents.set( wrapper, shown );

	if ( uploadFileName ) {
		wrapper.replaceChildren( createUploadTitle( wrapper.ownerDocument, uploadFileName ) );
		return;
	}

	if ( previous?.startsWith( 'upload:' ) ) {
		wrapper.replaceChildren();
	}
	const boxSize = element.getAttribute( 'boxSize' ) as string | undefined;
	loadEmbeddedContent( editor, element, wrapper, boxSize );
}

/** Updates the `data-*` attribute of an embed's view to what it shows, and redraws it. */
function redrawEmbeddedEntity(
	editor: Editor,
	embed: ModelElement,
	conversionApi: DowncastConversionApi
) {
	const viewElement = conversionApi.mapper.toViewElement( embed );
	/* v8 ignore next 3 -- converted after the embed itself, so always mapped */
	if ( !viewElement ) {
		return;
	}

	const viewWriter = conversionApi.writer;
	viewWriter.removeAttribute( 'data-attachment-id', viewElement );
	viewWriter.removeAttribute( 'data-note-id', viewElement );
	viewWriter.removeAttribute( 'data-block', viewElement );
	for ( const [ key, value ] of Object.entries( getEmbeddedEntityAttributes( embed ) ) ) {
		viewWriter.setAttribute( key, value, viewElement );
	}

	const wrapper = getWrapperDom( editor, viewElement );
	if ( wrapper ) {
		showEmbeddedContent( editor, embed, wrapper );
	}
}

/** The content wrapper of a rendered embed, or `null` before the embed is rendered. */
function getWrapperDom( editor: Editor, viewElement: ViewElement ) {
	return editor.editing.view.domConverter.mapViewToDom( viewElement )
		?.querySelector<HTMLElement>( ':scope > .include-note-wrapper' ) ?? null;
}

/** Has the host render what an embed shows into its wrapper. */
function loadEmbeddedContent(
	editor: Editor,
	element: ModelElement,
	wrapper: HTMLElement,
	boxSize: string | undefined
) {
	const $wrapper = $( wrapper );
	const editorEl = editor.editing.view.getDomRoot();
	const component = glob.getComponentByEl<EditorComponent>( editorEl );
	const attachmentId = element.getAttribute( 'attachmentId' ) as string | undefined;
	const noteId = element.getAttribute( 'noteId' ) as string | undefined;

	if ( attachmentId ) {
		component.loadEmbeddedAttachment( attachmentId, $wrapper, boxSize );
	} else if ( noteId ) {
		const block = element.getAttribute( 'block' ) as string | undefined;
		component.loadEmbeddedNote( noteId, $wrapper, boxSize, block, newBlock => {
			setEmbedBlock( editor, element, wrapper, newBlock );
		} );
	}
}

/**
 * Points the embed at other blocks of its note, unless it has left the document. Its `wrapper`
 * keeps what it shows, the editor that holds those blocks.
 */
function setEmbedBlock( editor: Editor, embed: ModelElement, wrapper: HTMLElement, block: string ) {
	if ( editor.state === 'destroyed' || embed.root !== editor.model.document.getRoot() ) {
		return;
	}

	editor.model.enqueueChange( { isUndoable: false }, writer => {
		writer.setAttribute( 'block', block, embed );
		shownContents.set( wrapper, JSON.stringify( getEmbeddedEntityAttributes( embed ) ) );
	} );
}

/**
 * Re-renders the embedded note content of an already-rendered widget after its box size changed.
 *
 * The wrapper is a `UIElement` whose DOM is opaque to CKEditor, so we reach into it directly to
 * trigger the client-side render. The box size is passed explicitly because, at conversion time,
 * the updated `data-box-size` attribute may not yet be flushed to the DOM.
 *
 * On the initial insert the attribute converter runs before the widget has been rendered to the
 * DOM, so `mapViewToDom()` returns nothing and this is a no-op — the `UIElement` render callback
 * performs that first paint instead. It only does work on a subsequent, genuine box-size change.
 */
function reloadEmbeddedContent( editor: Editor, viewElement: ViewElement, modelElement: ModelElement, boxSize: string ) {
	const wrapperDom = getWrapperDom( editor, viewElement );

	if ( wrapperDom ) {
		loadEmbeddedContent( editor, modelElement, wrapperDom, boxSize );
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
		// A button of the title row selects the embed. Preventing the default keeps the focus
		// in the editor instead of the button, and the click still fires.
		if ( isTitleRowButton( evt.target ) ) {
			evt.preventDefault();
			selectContentEmbedWidget( domElement, editor );
			return;
		}

		// Interactive embedded content — links, form controls, and live widgets such as collections
		// (geo map, calendar, board, table) — needs the browser's native event handling to remain
		// usable, e.g. dragging a geo-map marker relies on the mousedown reaching Leaflet. Leave those
		// events completely alone: don't stop propagation, suppress the default, or steal selection.
		if ( isInteractiveTarget( evt.target, domElement ) ) {
			return;
		}

		evt.stopPropagation();

		// Suppress the browser's native caret on non-interactive areas. The widget's <figure> is
		// contenteditable=false inside an editable root, so the default mousedown action drops a caret
		// next to it that visibly moves as the user clicks around.
		evt.preventDefault();

		// This prevents rendering changed view selection thus preventing to changing DOM selection while inside a widget.
		//@ts-expect-error: We are accessing a private field.
		editor.editing.view._renderer.isFocused = false;

		// Select the widget so the toolbar can appear
		selectContentEmbedWidget( domElement, editor );
	}, { capture: true } );

	domElement.addEventListener( 'focus', ( evt: FocusEvent ) => {
		// The content of the embed, such as the editor of an included note, hears its own focus.
		if ( isInEmbedContent( evt.target ) ) {
			hackRendererFocus();
		} else {
			stopEventPropagationAndHackRendererFocus( evt );
		}

		// Content that takes the focus without a press, as a canvas drawing just added, selects
		// its widget as a press does, which shows its toolbar. The focus stays in the content.
		const modelElement = getContentEmbedAt( editor, domElement );
		const selection = editor.model.document.selection;
		if ( modelElement && selection.getSelectedElement() !== modelElement ) {
			editor.model.enqueueChange( { isUndoable: false }, writer => {
				writer.setSelection( modelElement, 'on' );
			} );
		}
	}, { capture: true } );

	// Prevents TAB handling or other editor keys listeners which might be executed on editors selection.
	// Listens in the bubble phase, so the embedded content handles its own keys first.
	domElement.addEventListener( 'keydown', stopEventPropagationAndHackRendererFocus );

	function stopEventPropagationAndHackRendererFocus( evt: Event ) {
		evt.stopPropagation();
		hackRendererFocus();
	}

	function hackRendererFocus() {
		// This prevents rendering changed view selection thus preventing to changing DOM selection while inside a widget.
        //@ts-expect-error: We are accessing a private field.
		editor.editing.view._renderer.isFocused = false;
	}
}

/** Sets `_renderer.isFocused` back to `view.document.isFocused`. */
function restoreRendererFocus( editor: Editor ) {
	const view = editor.editing.view;
	//@ts-expect-error: We are accessing a private field.
	view._renderer.isFocused = view.document.isFocused;
}

/** Whether `target` is in the content box of an embed, rather than in its title row. */
function isInEmbedContent( target: EventTarget | null ): boolean {
	return target instanceof Element && !!target.closest( '.include-note-content' );
}

/**
 * Whether a mousedown target needs the browser's native handling to keep working — so the widget's
 * event interception should step aside. Covers form controls, links and media (which need focus,
 * caret or their own controls) and, crucially, live embedded widgets: web views and collection views
 * (geo map, calendar, board, table) whose own drag/click handlers rely on the native event.
 *
 * Covers all of `.include-note-content` as well: the host covers it with `.include-note-backdrop`
 * until the content has the focus, and a press inside it keeps that focus out of the editor.
 *
 * The match is bounded to within `boundary` (the widget wrapper) so the editable editor root — an
 * ancestor with `contenteditable="true"` — is never mistaken for an interactive target.
 */
function isInteractiveTarget( target: EventTarget | null, boundary: HTMLElement ): boolean {
	if ( !( target instanceof Element ) ) {
		return false;
	}

	const match = target.closest(
		'.include-note-content, .rendered-collection, .note-detail-web-view, ' +
		'a, button, input, textarea, select, label, audio, video, ' +
		'[role="button"], [role="textbox"], [contenteditable]:not([contenteditable="false"])'
	);

	return !!match && boundary.contains( match );
}

/** Whether `target` is in a button of the title row that the host renders above the content. */
function isTitleRowButton( target: EventTarget | null ): boolean {
	return target instanceof Element && !!target.closest( '.include-note-title-row button' );
}

function selectContentEmbedWidget( domElement: HTMLElement, editor: Editor ) {
	const modelElement = getContentEmbedAt( editor, domElement );
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

declare module 'ckeditor5' {
	interface PluginsMap {
		[ ContentEmbed.pluginName ]: ContentEmbed;
	}

	interface CommandsMap {
		toggleContentEmbedCaption: ToggleContentEmbedCaptionCommand;
		toggleContentEmbedTitle: ToggleContentEmbedTitleCommand;
		toggleContentEmbedEditable: ToggleContentEmbedEditableCommand;
	}
}
