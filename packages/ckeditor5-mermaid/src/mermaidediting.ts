/**
 * @module mermaid/mermaidediting
 */

import MermaidPreviewCommand from './commands/mermaidPreviewCommand.js';
import MermaidSourceViewCommand from './commands/mermaidSourceViewCommand.js';
import MermaidSplitViewCommand from './commands/mermaidSplitViewCommand.js';
import InsertMermaidCommand from './commands/insertMermaidCommand.js';
import { DowncastAttributeEvent, DowncastConversionApi, EditorConfig, ModelElement, EventInfo, ModelItem, ModelNode, Plugin, toWidget, uid, UpcastConversionApi, UpcastConversionData, ViewElement, ViewText, ViewUIElement } from 'ckeditor5';

import { debounce } from './utils.js';

// Time in milliseconds.
const DEBOUNCE_TIME = 300;

/* global window */

type DowncastConversionData = DowncastAttributeEvent["args"][0];

export default class MermaidEditing extends Plugin {

	private _config!: EditorConfig["mermaid"];
	private _mermaidPromise?: Promise<MermaidInstance>;
	private _renderGeneration = 0;

	/**
	 * @inheritDoc
	 */
	static get pluginName() {
		return 'MermaidEditing' as const;
	}

	/**
	 * @inheritDoc
	 */
	init() {
		this._registerCommands();
		this._defineConverters();
		this._config = this.editor.config.get("mermaid");
	}

	/**
	 * @inheritDoc
	 */
	afterInit() {
		this.editor.model.schema.register( 'mermaid', {
			allowAttributes: [ 'displayMode', 'source' ],
			allowWhere: '$block',
			isObject: true
		} );
	}

	/**
	 * @inheritDoc
	*/
	_registerCommands() {
		const editor = this.editor;

		editor.commands.add( 'mermaidPreviewCommand', new MermaidPreviewCommand( editor ) );
		editor.commands.add( 'mermaidSplitViewCommand', new MermaidSplitViewCommand( editor ) );
		editor.commands.add( 'mermaidSourceViewCommand', new MermaidSourceViewCommand( editor ) );
		editor.commands.add( 'insertMermaidCommand', new InsertMermaidCommand( editor ) );
	}

	/**
	 * Adds converters.
	 *
	 * @private
	 */
	_defineConverters() {
		const editor = this.editor;

		editor.data.downcastDispatcher.on( 'insert:mermaid', this._mermaidDataDowncast.bind( this ) );
		editor.editing.downcastDispatcher.on( 'insert:mermaid', this._mermaidDowncast.bind( this ) );
		editor.editing.downcastDispatcher.on( 'attribute:source:mermaid', this._sourceAttributeDowncast.bind( this ) );

		editor.data.upcastDispatcher.on( 'element:code', this._mermaidUpcast.bind( this ), { priority: 'high' } );

		editor.conversion.for( 'editingDowncast' ).attributeToAttribute( {
			model: {
				name: 'mermaid',
				key: 'displayMode'
			},
			view: modelAttributeValue => ( {
				key: 'class',
				value: 'ck-mermaid__' + modelAttributeValue + '-mode'
			} )
		} );
	}

	_mermaidDataDowncast( evt: EventInfo, data: DowncastConversionData, conversionApi: DowncastConversionApi ) {
		const model = this.editor.model;
		const { writer, mapper } = conversionApi;

		if ( !conversionApi.consumable.consume( data.item, 'insert' ) ) {
			return;
		}

		const targetViewPosition = mapper.toViewPosition( model.createPositionBefore( data.item as ModelItem ) );
		// For downcast we're using only language-mermaid class. We don't set class to `mermaid language-mermaid` as
		// multiple markdown converters that we have seen are using only `language-mermaid` class and not `mermaid` alone.
		const code = writer.createContainerElement( 'code', {
			class: 'language-mermaid'
		} ) as any;
		const pre = writer.createContainerElement( 'pre', {
			spellcheck: 'false'
		} ) as any;
		const sourceTextNode = writer.createText( data.item.getAttribute( 'source' ) as string);

		writer.insert( model.createPositionAt( code, 'end' ) as any, sourceTextNode );
		writer.insert( model.createPositionAt( pre, 'end' ) as any, code );
		writer.insert( targetViewPosition, pre );
		mapper.bindElements( data.item as ModelElement, code as ViewElement );
	}

	_mermaidDowncast( evt: EventInfo, data: DowncastConversionData, conversionApi: DowncastConversionApi ) {
		const { writer, mapper, consumable } = conversionApi;
		const { editor } = this;
		const { model, t } = editor;
		const that = this;

		if ( !consumable.consume( data.item, 'insert' ) ) {
			return;
		}

		const targetViewPosition = mapper.toViewPosition( model.createPositionBefore( data.item as ModelItem ) );

		const wrapperAttributes = {
			class: [ 'ck-mermaid__wrapper' ]
		};
		const textareaAttributes = {
			class: [ 'ck-mermaid__editing-view' ],
			placeholder: t( 'Insert mermaid source code' ),
			'data-cke-ignore-events': true
		};

		const wrapper = writer.createContainerElement( 'div', wrapperAttributes );
		const editingContainer = writer.createUIElement( 'textarea', textareaAttributes, createEditingTextarea );
		const previewContainer = writer.createUIElement( 'div', { class: [ 'ck-mermaid__preview' ] }, createMermaidPreview );

		//@ts-expect-error
		writer.insert( writer.createPositionAt( wrapper, 'start' ), previewContainer );
		//@ts-expect-error
		writer.insert( writer.createPositionAt( wrapper, 'start' ), editingContainer );

		writer.insert( targetViewPosition, wrapper );

		mapper.bindElements( data.item as ModelElement, wrapper );

		return toWidget( wrapper, writer, {
			label: t( 'Mermaid widget' ),
			hasSelectionHandle: true
		} );

		function createEditingTextarea(this: ViewUIElement, domDocument: Document ) {
			const domElement = this.toDomElement( domDocument ) as HTMLElement as HTMLInputElement;

			domElement.value = data.item.getAttribute( 'source' ) as string;

			const debouncedListener = debounce( event => {
				editor.model.change( writer => {
					writer.setAttribute( 'source', event.target.value, data.item as ModelNode );
				} );
			}, DEBOUNCE_TIME );

			domElement.addEventListener( 'input', debouncedListener );

			/* Workaround for internal #1544 */
			domElement.addEventListener( 'focus', () => {
				const model = editor.model;
				const selectedElement = model.document.selection.getSelectedElement();

				// Move the selection onto the mermaid widget if it's currently not selected.
				if ( selectedElement !== data.item ) {
					model.change( writer => writer.setSelection( data.item as ModelNode, 'on' ) );
				}
			}, true );

			return domElement;
		}

		function createMermaidPreview(this: ViewUIElement,  domDocument: Document ) {
			const mermaidSource = data.item.getAttribute( 'source' ) as string;
			const domElement = this.toDomElement( domDocument );

			that._renderMermaid( domElement, mermaidSource );

			return domElement;
		}
	}

	_sourceAttributeDowncast( evt: EventInfo, data: DowncastConversionData, conversionApi: DowncastConversionApi ) {
		// @todo: test whether the attribute was consumed.
		const newSource = data.attributeNewValue as string;
		const domConverter = this.editor.editing.view.domConverter;

		if ( newSource ) {
			const mermaidView = conversionApi.mapper.toViewElement( data.item as ModelElement );
			if (!mermaidView) {
				return;
			}

			for ( const _child of mermaidView.getChildren() ) {
				const child = _child as ViewElement;
				if ( child.name === 'textarea' && child.hasClass( 'ck-mermaid__editing-view' ) ) {
					// Text & HTMLElement & ModelNode & DocumentFragment
					const domEditingTextarea = domConverter.viewToDom(child) as HTMLElement as HTMLInputElement;

					if ( domEditingTextarea.value != newSource ) {
						domEditingTextarea.value = newSource;
					}
				} else if ( child.name === 'div' && child.hasClass( 'ck-mermaid__preview' ) ) {
					// @todo: we could optimize this and not refresh mermaid if widget is in source mode.
					const domPreviewWrapper = domConverter.viewToDom(child);

					if ( domPreviewWrapper ) {
						this._renderMermaid( domPreviewWrapper, newSource );
					}
				}
			}
		}
	}

	_mermaidUpcast( evt: EventInfo, data: UpcastConversionData, conversionApi: UpcastConversionApi ) {
		const viewCodeElement = data.viewItem as ViewElement;
		const hasPreElementParent = !viewCodeElement.parent || !viewCodeElement.parent.is( 'element', 'pre' );
		const hasCodeAncestors = data.modelCursor.findAncestor( 'code' );
		const { consumable, writer } = conversionApi;

		if ( !viewCodeElement.hasClass( 'language-mermaid' ) || hasPreElementParent || hasCodeAncestors ) {
			return;
		}

		if ( !consumable.test( viewCodeElement, { name: true } ) ) {
			return;
		}
		const mermaidSource = Array.from( viewCodeElement.getChildren() )
			.filter( item => item.is( '$text' ) )
			.map( item => (item as ViewText).data )
			.join( '' );

		const mermaidElement = writer.createElement( 'mermaid', {
			source: mermaidSource,
			displayMode: 'split'
		} );

		// Let's try to insert mermaid element.
		if ( !conversionApi.safeInsert( mermaidElement, data.modelCursor ) ) {
			return;
		}

		consumable.consume( viewCodeElement, { name: true } );

		conversionApi.updateConversionResult( mermaidElement, data );
	}

	/**
	 * Renders Mermaid (a parsed `source`) in a given `domElement`.
	 */
	async _renderMermaid( domElement: HTMLElement, source: string ) {
		if ( !this._mermaidPromise && typeof this._config?.lazyLoad === 'function' ) {
			this._mermaidPromise = Promise.resolve( this._config.lazyLoad() ).then( instance => {
				instance.initialize( this._config?.config ?? {} );
				return instance;
			} );
		}

		const mermaid = await this._mermaidPromise;

		if ( !mermaid ) {
			return;
		}

		const generation = ++this._renderGeneration;
		const id = `ck-mermaid-${ uid() }`;

		try {
			const { svg } = await mermaid.render( id, source );

			if ( generation === this._renderGeneration ) {
				domElement.innerHTML = svg;
			}
		} catch ( err: any ) {
			if ( generation === this._renderGeneration ) {
				domElement.innerText = err.message;
			}
			document.getElementById( id )?.remove();
		}
	}
}
