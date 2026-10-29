import {
	EXTENDED_CODE_BLOCK_CLASS, EXTENDED_CODE_BLOCK_DEFAULT_LANGUAGE
} from '@triliumnext/commons';
import {
	Command,
	type DowncastConversionApi,
	type DowncastInsertEvent,
	type Editor,
	findOptimalInsertionRange,
	type ModelElement,
	Plugin,
	type UpcastConversionApi,
	type UpcastElementEvent,
	type ViewElement
} from 'ckeditor5';

import { SIZE_ATTRIBUTES } from '../resizable_widgets/resizable_widgets.js';
import {
	type BoxSizeValue,
	getCodeViewAttributes,
	getCodeViewOfView,
	getDisplayModeAttributes,
	getDisplayModeOfView,
	INLINE_BOX_SIZES,
	toDisplayMode
} from './content_embed.js';

export const INSERT_INLINE_EMBED_COMMAND = 'insertInlineEmbed';

/**
 * The source of an embed that keeps its content in the note, as the host reads and changes it.
 * Changes to the source made outside the host reach it through `subscribe()`.
 */
export interface InlineEmbedSource {
	/** The language that the source is written in, such as `mermaid`. */
	readonly language: string;
	getSource(): string;
	/** Replaces the source. The host keeps the undo steps of its changes in `EmbedHistory`. */
	setSource( source: string ): void;
	/** Calls `callback` when the source changes, until the returned function is called. */
	subscribe( callback: () => void ): () => void;
	isReadOnly(): boolean;
}

export interface InsertInlineEmbedOptions {
	language: string;
	source: string;
	/** Medium by default. */
	boxSize?: BoxSizeValue;
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
 * Embeds whose content lives in the note, as `<pre><code class="language-…">` code blocks: the
 * diagrams of the languages in `contentEmbed.inlineLanguages`, and the extended code blocks, whose
 * `<pre>` has the `EXTENDED_CODE_BLOCK_CLASS` class. The embed keeps the language and the source as
 * attributes, and is saved as the code block, with its box size, flags and size on the `<pre>`,
 * so that anything reading the note sees a plain code block.
 *
 * The content renders through the host's `contentEmbed.loadInline()`, which receives an
 * {@link InlineEmbedSource} rather than an ID.
 */
export default class ContentEmbedInlineSource extends Plugin {
	/** The listeners of each embed's source, by embed. */
	private readonly listeners = new WeakMap<ModelElement, Set<() => void>>();
	/** The source of each embed, the same object each time the embed renders. */
	private readonly sources = new WeakMap<ModelElement, InlineEmbedSource>();
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
			'insert:contentEmbed', ( _evt, data, api ) => downcastData( editor, data.item, api ),
			{ priority: 'high' } );
		editor.editing.downcastDispatcher.on( 'attribute:source:contentEmbed', ( _evt, data ) => {
			for ( const listener of this.listeners.get( data.item as ModelElement ) ?? [] ) {
				listener();
			}
		} );

		// The host writes edited sources after a delay: write them before the clipboard reads them.
		for ( const event of [ 'copy', 'cut', 'dragstart' ] as const ) {
			this.listenTo( editor.editing.view.document, event, () => {
				editor.config.get( 'contentEmbed' )?.flushInline?.();
			}, { priority: 'highest' } );
		}
	}

	afterInit() {
		this.editor.model.schema.extend( 'contentEmbed', { allowAttributes: [ 'language', 'source' ] } );
	}

	/** Has the host render the source of `embed` into `wrapper`. */
	load( embed: ModelElement, wrapper: HTMLElement, boxSize: string | undefined ) {
		const editor = this.editor;
		const isFocused = this.focusedEmbeds.delete( embed );
		editor.config.get( 'contentEmbed' )?.loadInline?.( this.getSource( embed ), wrapper, boxSize, { isFocused } );
	}

	/** Marks `embed` for its content to take the focus once it renders. */
	focusOnLoad( embed: ModelElement ) {
		this.focusedEmbeds.add( embed );
	}

	private getSource( embed: ModelElement ): InlineEmbedSource {
		let source = this.sources.get( embed );
		if ( !source ) {
			source = this.createSource( embed );
			this.sources.set( embed, source );
		}
		return source;
	}

	private createSource( embed: ModelElement ): InlineEmbedSource {
		const editor = this.editor;
		const listeners = this.listeners;

		return {
			get language() {
				return embed.getAttribute( 'language' ) as string;
			},
			getSource: () => embed.getAttribute( 'source' ) as string | undefined ?? '',
			setSource: source => {
				const root = embed.root;
				if ( editor.state === 'destroyed' || !root.is( 'rootElement' )
					|| root.rootName === '$graveyard' || embed.getAttribute( 'source' ) === source ) {
					return;
				}
				editor.model.enqueueChange( { isUndoable: false }, writer => {
					writer.setAttribute( 'source', source, embed );
				} );
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

	/**
	 * Turns a `<pre><code>` of an inline language, or of an extended code block, into an embed of
	 * its source.
	 */
	private upcast( data: UpcastElementEvent[ 'args' ][ 0 ], api: UpcastConversionApi ) {
		const code = data.viewItem;
		const pre = code.parent;
		if ( !pre?.is( 'element', 'pre' ) || !api.consumable.test( code, { name: true } ) ) {
			return;
		}

		const codeLanguage = getCodeLanguage( code );
		const isDiagram = !!codeLanguage && getInlineLanguages( this.editor ).includes( codeLanguage );
		const isCodeBlock = !isDiagram && pre.hasClass( EXTENDED_CODE_BLOCK_CLASS );
		if ( !isDiagram && !isCodeBlock ) {
			return;
		}

		const source = getViewText( code );
		const embed = api.writer.createElement( 'contentEmbed', {
			language: codeLanguage ?? EXTENDED_CODE_BLOCK_DEFAULT_LANGUAGE,
			source,
			boxSize: getBoxSizeOfView( pre, isCodeBlock ? 'full' : 'medium' ),
			hideTitle: true,
			...( isCodeBlock ? getCodeBlockModeOfView( pre ) : getModeOfSavedView( pre, code ) ),
			...getFlagsOfView( pre ),
			...getSizesOfView( pre ),
			...getCodeViewOfView( pre )
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

	override execute( { language, source, boxSize = 'medium' }: InsertInlineEmbedOptions ) {
		const editor = this.editor;
		const model = editor.model;

		model.change( writer => {
			const embed = writer.createElement( 'contentEmbed', {
				language,
				source,
				boxSize,
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

/** Whether `embed` is an extended code block: an inline embed of a language that is no diagram. */
export function isExtendedCodeBlock( editor: Editor, embed: ModelElement ) {
	const language = embed.getAttribute( 'language' );
	return typeof language === 'string' && !getInlineLanguages( editor ).includes( language );
}

/** Saves an embed of a source as `<pre><code class="language-…">`. */
function downcastData( editor: Editor, embed: ModelElement, api: DowncastConversionApi ) {
	if ( !isInlineSourceEmbed( embed ) || !api.consumable.consume( embed, 'insert' ) ) {
		return;
	}

	const { writer, mapper } = api;
	const preAttributes: Record<string, string> = {
		...( isExtendedCodeBlock( editor, embed ) ? { class: EXTENDED_CODE_BLOCK_CLASS } : {} ),
		'data-box-size': embed.getAttribute( 'boxSize' ) as string,
		...getDisplayModeAttributes( embed )
	};
	for ( const [ flag, dataAttribute ] of FLAG_ATTRIBUTES ) {
		if ( embed.getAttribute( flag ) ) {
			preAttributes[ dataAttribute ] = 'true';
		}
	}

	const pre = writer.createContainerElement( 'pre', {
		...preAttributes,
		...getCodeViewAttributes( embed )
	} );
	const code = writer.createContainerElement( 'code', {
		class: `language-${ embed.getAttribute( 'language' ) as string }`
	} );
	writer.insert( writer.createPositionAt( code, 0 ),
		writer.createText( embed.getAttribute( 'source' ) as string | undefined ?? '' ) );
	writer.insert( writer.createPositionAt( pre, 0 ), code );
	writer.insert( mapper.toViewPosition( editor.model.createPositionBefore( embed ) ), pre );
	// `ResizableWidgets` writes the size attributes on the `<pre>` through this mapping.
	mapper.bindElements( embed, pre );
}

/**
 * The text of `element`, with a `<br>` as a line break. A code block pasted from a page can hold
 * its highlighting as `<span>` elements.
 */
function getViewText( element: ViewElement ): string {
	return Array.from( element.getChildren() )
		.map( child => {
			if ( child.is( '$text' ) ) {
				return child.data;
			}
			return child.is( 'element', 'br' ) ? '\n' : getViewText( child as ViewElement );
		} )
		.join( '' );
}

/** The languages of the diagrams that the host renders, from `contentEmbed.inlineLanguages`. */
function getInlineLanguages( editor: Editor ): string[] {
	return editor.config.get( 'contentEmbed.inlineLanguages' ) ?? [];
}

/** The language that the `language-…` class of `code` names, or `null`. */
function getCodeLanguage( code: ViewElement ) {
	for ( const className of code.getClassNames() ) {
		if ( className.startsWith( 'language-' ) ) {
			return className.slice( 'language-'.length );
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

/**
 * The display mode and Editable flag of an extended code block. A code block saved without the
 * settings of an embed opens editable, as a code block of the text note is.
 */
function getCodeBlockModeOfView( pre: ViewElement ) {
	return pre.hasAttribute( 'data-box-size' ) ? getDisplayModeOfView( pre ) : { editable: true };
}

/** The box size of a saved embed, `fallback` when it has none or one that needs a title. */
function getBoxSizeOfView( pre: ViewElement, fallback: BoxSizeValue ): BoxSizeValue {
	const boxSize = INLINE_BOX_SIZES.find( size => size === pre.getAttribute( 'data-box-size' ) );
	return boxSize ?? fallback;
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

}
