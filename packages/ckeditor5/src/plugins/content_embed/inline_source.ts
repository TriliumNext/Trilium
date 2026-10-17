import {
	Command,
	type DowncastConversionApi,
	type DowncastInsertEvent,
	type Editor,
	findOptimalInsertionRange,
	type Model,
	type ModelElement,
	Plugin,
	type UpcastConversionApi,
	type UpcastElementEvent,
	type ViewElement
} from 'ckeditor5';

import { SIZE_ATTRIBUTES } from '../resizable_widgets/resizable_widgets.js';
import {
	type BoxSizeValue,
	getDisplayModeAttributes,
	getDisplayModeOfView,
	INLINE_BOX_SIZES,
	toDisplayMode
} from './content_embed.js';

export const INSERT_INLINE_EMBED_COMMAND = 'insertInlineEmbed';

/**
 * The source of an embed that keeps its content in the note, as the host reads and changes it.
 * The editor's undo and other changes to the source reach the host through `subscribe()`.
 */
export interface InlineEmbedSource {
	/** The language that the source is written in, such as `mermaid`. */
	readonly language: string;
	getSource(): string;
	/** Replaces the source, as one step of the editor's undo. */
	setSource( source: string ): void;
	/** Calls `callback` when the source changes, until the returned function is called. */
	subscribe( callback: () => void ): () => void;
	isReadOnly(): boolean;
}

export interface InsertInlineEmbedOptions {
	language: string;
	source: string;
}

/** The flags of an embed and the `data-*` attributes they are saved as on the `<pre>`. */
const FLAG_ATTRIBUTES = [
	[ 'hideTitle', 'data-hide-title' ],
	[ 'editable', 'data-editable' ]
] as const;

/** The size attributes of an embed and the style properties they are saved as on the `<pre>`. */
const SIZE_PROPERTIES = [
	[ SIZE_ATTRIBUTES.width, '--include-note-width' ],
	[ SIZE_ATTRIBUTES.height, '--include-note-height' ]
] as const;

/**
 * Embeds whose content lives in the note, as `<pre><code class="language-…">` code blocks of the
 * languages in `contentEmbed.inlineLanguages`. The embed keeps the language and the source as
 * attributes, and is saved as the code block, with its box size, flags and size on the `<pre>`,
 * so that anything reading the note sees a plain code block.
 *
 * The content renders through the host's `loadInlineEmbed()`, which receives an
 * {@link InlineEmbedSource} rather than an ID.
 */
export default class ContentEmbedInlineSource extends Plugin {
	/** The listeners of each embed's source, by embed. */
	private readonly listeners = new WeakMap<ModelElement, Set<() => void>>();
	/** The embeds inserted by {@link INSERT_INLINE_EMBED_COMMAND}, whose content takes the focus. */
	private readonly focusedEmbeds = new WeakSet<ModelElement>();

	static get pluginName() {
		return 'ContentEmbedInlineSource' as const;
	}

	init() {
		const editor = this.editor;

		editor.commands.add( INSERT_INLINE_EMBED_COMMAND, new InsertInlineEmbedCommand( editor ) );

		editor.data.upcastDispatcher.on<UpcastElementEvent>(
			'element:code', ( _evt, data, api ) => this.upcast( data, api ), { priority: 'high' } );
		editor.data.downcastDispatcher.on<DowncastInsertEvent<ModelElement>>(
			'insert:contentEmbed', ( _evt, data, api ) => downcastData( editor.model, data.item, api ),
			{ priority: 'high' } );
		editor.editing.downcastDispatcher.on( 'attribute:source:contentEmbed', ( _evt, data ) => {
			for ( const listener of this.listeners.get( data.item as ModelElement ) ?? [] ) {
				listener();
			}
		} );
	}

	afterInit() {
		this.editor.model.schema.extend( 'contentEmbed', { allowAttributes: [ 'language', 'source' ] } );
	}

	/** Has the host render the source of `embed` into `wrapper`. */
	load( embed: ModelElement, wrapper: HTMLElement, boxSize: string | undefined ) {
		const editor = this.editor;
		const component = glob.getComponentByEl<EditorComponent>( editor.editing.view.getDomRoot() );
		const isFocused = this.focusedEmbeds.delete( embed );
		component.loadInlineEmbed?.( this.getSource( embed ), $( wrapper ), boxSize, { isFocused } );
	}

	/** Marks `embed` for its content to take the focus once it renders. */
	focusOnLoad( embed: ModelElement ) {
		this.focusedEmbeds.add( embed );
	}

	private getSource( embed: ModelElement ): InlineEmbedSource {
		const editor = this.editor;
		const listeners = this.listeners;

		return {
			language: embed.getAttribute( 'language' ) as string,
			getSource: () => embed.getAttribute( 'source' ) as string | undefined ?? '',
			setSource: source => {
				const root = embed.root;
				if ( editor.state === 'destroyed' || !root.is( 'rootElement' )
					|| root.rootName === '$graveyard' || embed.getAttribute( 'source' ) === source ) {
					return;
				}
				editor.model.change( writer => writer.setAttribute( 'source', source, embed ) );
			},
			subscribe: callback => {
				let callbacks = listeners.get( embed );
				if ( !callbacks ) {
					callbacks = new Set();
					listeners.set( embed, callbacks );
				}
				callbacks.add( callback );
				return () => {
					callbacks.delete( callback );
				};
			},
			isReadOnly: () => editor.isReadOnly
		};
	}

	/** Turns a `<pre><code>` of an inline language into an embed of its source. */
	private upcast( data: UpcastElementEvent[ 'args' ][ 0 ], api: UpcastConversionApi ) {
		const code = data.viewItem;
		const pre = code.parent;
		const language = getInlineLanguage( this.editor, code );
		if ( !language || !pre?.is( 'element', 'pre' ) || !api.consumable.test( code, { name: true } ) ) {
			return;
		}

		const source = Array.from( code.getChildren() )
			.map( child => child.is( '$text' ) ? child.data : '' )
			.join( '' );
		const embed = api.writer.createElement( 'contentEmbed', {
			language,
			source,
			boxSize: getBoxSizeOfView( pre ),
			hideTitle: true,
			...getModeOfSavedView( pre, code ),
			...getFlagsOfView( pre ),
			...getSizesOfView( pre )
		} );
		if ( !api.safeInsert( embed, data.modelCursor ) ) {
			return;
		}

		api.consumable.consume( code, { name: true } );
		api.consumable.consume( pre, { name: true } );
		api.updateConversionResult( embed, data );
	}
}

/** Inserts an embed of a new source beside the block of the selection, editable, and focuses it. */
class InsertInlineEmbedCommand extends Command {
	override refresh() {
		const model = this.editor.model;
		const position = model.document.selection.getFirstPosition();
		this.isEnabled = !!position && model.schema.findAllowedParent( position, 'contentEmbed' ) !== null;
	}

	override execute( { language, source }: InsertInlineEmbedOptions ) {
		const editor = this.editor;
		const model = editor.model;

		model.change( writer => {
			const embed = writer.createElement( 'contentEmbed', {
				language,
				source,
				boxSize: 'medium',
				hideTitle: true,
				editable: true
			} );
			editor.plugins.get( ContentEmbedInlineSource ).focusOnLoad( embed );
			const selection = model.document.selection;
			model.insertObject( embed, findOptimalInsertionRange( selection, model ) );
			writer.setSelection( embed, 'on' );
		} );
	}
}

/** Whether `embed` keeps its content in the note rather than showing a note or attachment. */
export function isInlineSourceEmbed( embed: ModelElement ) {
	return !!embed.getAttribute( 'language' );
}

/** Saves an embed of a source as `<pre><code class="language-…">`. */
function downcastData( model: Model, embed: ModelElement, api: DowncastConversionApi ) {
	if ( !isInlineSourceEmbed( embed ) || !api.consumable.consume( embed, 'insert' ) ) {
		return;
	}

	const { writer, mapper } = api;
	const preAttributes: Record<string, string> = {
		'data-box-size': embed.getAttribute( 'boxSize' ) as string,
		...getDisplayModeAttributes( embed )
	};
	for ( const [ flag, dataAttribute ] of FLAG_ATTRIBUTES ) {
		if ( embed.getAttribute( flag ) ) {
			preAttributes[ dataAttribute ] = 'true';
		}
	}

	const pre = writer.createContainerElement( 'pre', preAttributes );
	const code = writer.createContainerElement( 'code', {
		class: `language-${ embed.getAttribute( 'language' ) as string }`
	} );
	writer.insert( writer.createPositionAt( code, 0 ),
		writer.createText( embed.getAttribute( 'source' ) as string | undefined ?? '' ) );
	writer.insert( writer.createPositionAt( pre, 0 ), code );
	writer.insert( mapper.toViewPosition( model.createPositionBefore( embed ) ), pre );
	// `ResizableWidgets` writes the size attributes on the `<pre>` through this mapping.
	mapper.bindElements( embed, pre );
}

/** The inline language of `code`, when it is one in `contentEmbed.inlineLanguages`. */
function getInlineLanguage( editor: Editor, code: ViewElement ) {
	const languages = editor.config.get( 'contentEmbed.inlineLanguages' ) ?? [];
	for ( const className of code.getClassNames() ) {
		const language = className.startsWith( 'language-' ) && className.slice( 'language-'.length );
		if ( language && languages.includes( language ) ) {
			return language;
		}
	}
	return null;
}

/**
 * The display mode of a saved embed. A diagram of the old Mermaid plugin, or any code block saved
 * elsewhere, has no box size: it opens editable, in the mode the old plugin kept on the `<code>`,
 * or split.
 */
function getModeOfSavedView( pre: ViewElement, code: ViewElement ) {
	if ( pre.hasAttribute( 'data-box-size' ) ) {
		return getDisplayModeOfView( pre );
	}

	const mode = toDisplayMode( code.getAttribute( 'data-trilium-display-mode' ) );
	return { displayMode: mode ?? 'split', editable: true };
}

/** The box size of a saved embed, Medium when it has none or one that needs a title. */
function getBoxSizeOfView( pre: ViewElement ): BoxSizeValue {
	const boxSize = INLINE_BOX_SIZES.find( size => size === pre.getAttribute( 'data-box-size' ) );
	return boxSize ?? 'medium';
}

function getFlagsOfView( pre: ViewElement ) {
	return Object.fromEntries( FLAG_ATTRIBUTES
		.filter( ( [ , dataAttribute ] ) => pre.getAttribute( dataAttribute ) === 'true' )
		.map( ( [ flag ] ) => [ flag, true ] ) );
}

function getSizesOfView( pre: ViewElement ) {
	return Object.fromEntries( SIZE_PROPERTIES
		.map( ( [ attribute, property ] ) => [ attribute, pre.getStyle( property ) ] )
		.filter( ( [ , value ] ) => value ) );
}

declare module 'ckeditor5' {
	interface PluginsMap {
		[ ContentEmbedInlineSource.pluginName ]: ContentEmbedInlineSource;
	}

	interface EditorConfig {
		contentEmbed?: {
			/**
			 * The languages whose `<pre><code class="language-…">` code blocks show as embeds of
			 * their source, rendered by the host's `loadInlineEmbed()`.
			 */
			inlineLanguages?: string[];
			/**
			 * Renders the `source` of an inline language into `container`, outside an embed, as
			 * the AI assistant previews a response.
			 */
			renderInlinePreview?: ( language: string, source: string, container: HTMLElement ) => void;
		};
	}
}
