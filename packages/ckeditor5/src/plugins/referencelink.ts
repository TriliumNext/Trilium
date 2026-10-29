import {
	ClickObserver, Command, type Editor, LinkEditing, ModelElement, ModelLivePosition, Plugin, toWidget,
	type ViewDocumentClickEvent, ViewElement, viewToModelPositionOutsideModelElement, Widget
} from "ckeditor5";

export default class ReferenceLink extends Plugin {
	static get requires() {
		return [ ReferenceLinkEditing ];
	}
}

class ReferenceLinkCommand extends Command {

	/**
	 * Inserts a reference to `href` at the selection, or in place of the `replace` reference.
	 */
	override execute({ href, replace }: { href: string; replace?: ModelElement }) {
		if (!href?.trim()) {
			return;
		}

		const editor = this.editor;

		if (replace) {
			getReferenceTitle(editor, href).then(title => {
				const root = replace.root;
				if (!root.is('rootElement') || root.rootName === '$graveyard') {
					return;
				}

				editor.model.change(writer => {
					const reference = writer.createElement('reference', referenceAttributes(href, title));
					writer.insert(reference, writer.createPositionBefore(replace));
					writer.remove(replace);
					writer.setSelection(reference, 'on');
				});
			});
			return;
		}

		const selectionPosition = editor.model.document.selection.getFirstPosition();
		if (!selectionPosition) {
			return;
		}

		// Fetching the title can be a network round trip (froca cache miss), and the
		// user keeps typing while we wait. Anchor the insertion at the position
		// captured here rather than wherever the caret ends up at resolve time (#10663).
		const insertionPosition = ModelLivePosition.fromPosition(selectionPosition, 'toPrevious');

		// make sure the referenced note is in cache before adding the reference element
		getReferenceTitle(editor, href).then(title => {
			if (insertionPosition.root.rootName === '$graveyard') {
				// The context the user picked in was deleted while the title loaded.
				return;
			}

			const currentSelection = editor.model.document.selection;
			const selectionUntouched = currentSelection.isCollapsed
				&& (currentSelection.getFirstPosition()?.isEqual(insertionPosition) ?? false);

			editor.model.change(writer => {
				const placeholder = writer.createElement('reference', referenceAttributes(href, title));

				// ... and insert it into the document.
				editor.model.insertContent(placeholder, insertionPosition);

				// Put the selection on the inserted element, but only if the user hasn't
				// moved on while we were waiting for the title.
				if (selectionUntouched) {
					writer.setSelection(placeholder, 'after');
				}
			});
		}).finally(() => {
			insertionPosition.detach();
		});
	}

	override refresh() {
		const model = this.editor.model;
		const selection = model.document.selection;
        this.isEnabled = selection.focus !== null && model.schema.checkChild(selection.focus.parent as ModelElement, 'reference');
	}
}

/** An attachment that changed, as `ReferenceLinkEditing#updateAttachmentLinks` takes it. */
export interface AttachmentLinkChange {
	attachmentId: string;
	isDeleted: boolean;
}

export class ReferenceLinkEditing extends Plugin {
	static get requires() {
		return [ Widget, LinkEditing ];
	}

	static get pluginName() {
		return 'ReferenceLinkEditing' as const;
	}

	/** The title the data downcast last wrote for each reference. */
	private readonly _savedTitles = new WeakMap<ModelElement, string>();

	/** The title `getReferenceTitleSync()` read when the editing downcast drew each reference. */
	private readonly _drawnTitles = new WeakMap<ModelElement, string>();

	/**
	 * Redraws the reference links to the notes in `noteIds` whose title changed since they were
	 * drawn. Finds the links in the editing DOM rather than walking the model.
	 */
	refreshNoteLinks( noteIds: Iterable<string> ) {
		const editor = this.editor;
		const ids = new Set( noteIds );
		const domRoot = editor.editing.view.getDomRoot();
		if ( !ids.size || !domRoot ) {
			return;
		}

		const changedLinks: ModelElement[] = [];
		for ( const anchor of domRoot.querySelectorAll<HTMLAnchorElement>( 'a.reference-link' ) ) {
			if ( !ids.has( getNoteId( anchor.getAttribute( 'href' ) ) ?? '' ) ) {
				continue;
			}

			const reference = this._getReference( anchor );
			if ( !reference ) {
				continue;
			}

			const href = String( reference.getAttribute( 'href' ) ?? '' );
			const storedTitle = reference.getAttribute( 'storedTitle' ) as string | undefined;
			const title = getReferenceTitleSync( editor, href, storedTitle );
			if ( this._drawnTitles.get( reference ) !== title ) {
				changedLinks.push( reference );
			}
		}

		for ( const link of changedLinks ) {
			editor.editing.reconvertItem( link );
		}
	}

	/**
	 * Redraws the links and embeds of changed attachments, so they show the current state, and
	 * removes those of deleted ones.
	 */
	updateAttachmentLinks( changes: AttachmentLinkChange[] ) {
		const editor = this.editor;
		const isDeletedById = new Map(
			changes.map( change => [ change.attachmentId, change.isDeleted ] )
		);
		const changedLinks: ModelElement[] = [];
		const deletedLinks: ModelElement[] = [];

		for ( const root of editor.model.document.getRoots() ) {
			for ( const { item } of editor.model.createRangeIn( root ) ) {
				let attachmentId: unknown;
				if ( item.is( 'element', 'reference' ) ) {
					attachmentId = getAttachmentId( item.getAttribute( 'href' ) );
				} else if ( item.is( 'element', 'contentEmbed' ) ) {
					attachmentId = item.getAttribute( 'attachmentId' );
				} else {
					continue;
				}

				const isDeleted = typeof attachmentId === 'string'
					? isDeletedById.get( attachmentId )
					: undefined;
				if ( isDeleted !== undefined ) {
					( isDeleted ? deletedLinks : changedLinks ).push( item );
				}
			}
		}

		for ( const link of changedLinks ) {
			editor.editing.reconvertItem( link );
		}

		if ( deletedLinks.length ) {
			// The attachment changed outside this editor, so undo does not bring its link back.
			editor.model.enqueueChange( { isUndoable: false }, writer => {
				for ( const link of deletedLinks ) {
					writer.remove( link );
				}
			} );
		}
	}

	init() {
		this._defineSchema();
		this._defineConverters();

		this.editor.commands.add( 'referenceLink', new ReferenceLinkCommand( this.editor ) );

		this.editor.editing.mapper.on(
			'viewToModelPosition',
			viewToModelPositionOutsideModelElement( this.editor.model,
					viewElement => viewElement.hasClass( 'reference-link' ) )
		);

        this.editor.plugins.get("LinkEditing")._registerLinkOpener(() => {
            // Prevent reference links from being opened in a new browser tab.
            // This works even if the link is not a reference link, since it is handled by Trilium.
            return true;
        });

		const view = this.editor.editing.view;
		view.addObserver( ClickObserver );
		this.listenTo<ViewDocumentClickEvent>( view.document, 'click', ( _evt, data ) => {
			this._fixMissingReference( data.domTarget );
		} );
	}

	/**
	 * Asks the editor component to fix the reference link around `domTarget` when
	 * `loadReferenceLinkTitle()` rendered it as one to a missing note.
	 */
	private _fixMissingReference( domTarget: HTMLElement | undefined ) {
		const editor = this.editor;
		const anchor = domTarget?.closest<HTMLAnchorElement>( 'a.reference-link' );
		if ( editor.isReadOnly || !anchor?.querySelector( '.reference-link-missing' ) ) {
			return;
		}

		const reference = this._getReference( anchor );
		if ( !reference ) {
			return;
		}

		const storedTitle = String( reference.getAttribute( 'storedTitle' ) ?? '' );
		editor.config.get( 'referenceLink' )?.fixLink?.( storedTitle, href => {
			editor.execute( 'referenceLink', { href, replace: reference } );
			editor.editing.view.focus();
		} );
	}

	/** The `reference` the editing view draws as `anchor`, or `undefined` for any other link. */
	private _getReference( anchor: HTMLAnchorElement ) {
		const editor = this.editor;
		const viewElement = editor.editing.view.domConverter.mapDomToView( anchor );
		const reference = viewElement?.is( 'element' )
			? editor.editing.mapper.toModelElement( viewElement )
			: undefined;
		return reference?.is( 'element', 'reference' ) ? reference : undefined;
	}

	_defineSchema() {
		const schema = this.editor.model.schema;

		schema.register( 'reference', {
			// Allow wherever a text is allowed:
			allowWhere: '$text',

			isInline: true,

			// The inline widget is self-contained, so it cannot be split by the caret, and it can be selected:
			isObject: true,

			// `storedTitle` is the title the loaded content holds, shown when the note is missing.
			allowAttributes: [ 'href', 'storedTitle', 'uploadId', 'uploadStatus', 'uploadFileName' ]
		} );
	}

	_defineConverters() {
		const editor = this.editor;
		const conversion = editor.conversion;

		conversion.for( 'upcast' ).elementToElement( {
			view: {
				name: 'a',
				classes: [ 'reference-link' ]
			},
			model: ( viewElement, { writer: modelWriter } ) => {
				const href = viewElement.getAttribute('href');
				const storedTitle = getText( viewElement );

				return modelWriter.createElement( 'reference', referenceAttributes( href, storedTitle ) );
			}
		} );

		conversion.for( 'editingDowncast' ).elementToElement( {
			// Redraws a placeholder when its upload sets `href` and clears `uploadFileName`.
			model: { name: 'reference', attributes: [ 'href', 'uploadFileName' ] },
			view: ( modelItem, { writer: viewWriter } ) => {
				const href = modelItem.getAttribute('href') as string;
				const storedTitle = modelItem.getAttribute('storedTitle') as string | undefined;
				const uploadFileName = String(modelItem.getAttribute('uploadFileName') ?? '');
				const drawnTitle = getReferenceTitleSync( editor, href, storedTitle );
				this._drawnTitles.set( modelItem, drawnTitle );

				const referenceLinkView = viewWriter.createContainerElement( 'a', {
						href,
						class: 'reference-link'
					},
					{
						renderUnsafeAttributes: [ 'href' ]
					} );

				const noteTitleView = viewWriter.createUIElement('span', {}, function( domDocument ) {
					const domElement = this.toDomElement( domDocument );

					if (uploadFileName) {
						const spinner = domDocument.createElement("span");
						spinner.className = "bx bx-loader-alt bx-spin";
						domElement.append(spinner, uploadFileName);
						return domElement;
					}

					const renderTitle = editor.config.get( 'referenceLink' )?.renderTitle;
					if ( renderTitle ) {
						renderTitle( domElement, href, storedTitle );
					} else {
						domElement.textContent = getReferenceTitleSync( editor, href, storedTitle );
					}

					return domElement;
				});

				viewWriter.insert( viewWriter.createPositionAt( referenceLinkView, 0 ), noteTitleView );

				// Enable widget handling on a reference element inside the editing view.
				return toWidget( referenceLinkView, viewWriter );
			}
		} );

		conversion.for( 'dataDowncast' ).elementToElement( {
			model: 'reference',
			view: ( modelItem, { writer: viewWriter } ) => {
				const href = modelItem.getAttribute('href') as string;

				const referenceLinkView = viewWriter.createContainerElement( 'a', {
					href: href,
					class: 'reference-link'
				} );

				// A note deleted while the editor is open keeps the title saved last, not the loaded one.
				const storedTitle = this._savedTitles.get( modelItem )
					?? modelItem.getAttribute('storedTitle') as string | undefined;
				const title = getReferenceTitleSync(editor, href, storedTitle);
				this._savedTitles.set( modelItem, title );

				const innerText = viewWriter.createText(title);
				viewWriter.insert(viewWriter.createPositionAt(referenceLinkView, 0), innerText);

				return referenceLinkView;
			}
		} );
	}
}

/**
 * The title of the note or attachment `href` points to, as `referenceLink.getTitle` resolves it.
 * Without that config entry, the title is `href` itself.
 */
export function getReferenceTitle( editor: Editor, href: string ): Promise<string> {
	const getTitle = editor.config.get( 'referenceLink' )?.getTitle;
	return getTitle ? getTitle( href ) : Promise.resolve( href );
}

/**
 * The title of the note or attachment `href` points to, as `referenceLink.getTitleSync` reads
 * it. Without that config entry, the title is `storedTitle`, or else `href`.
 */
export function getReferenceTitleSync( editor: Editor, href: string, storedTitle?: string ): string {
	const getTitleSync = editor.config.get( 'referenceLink' )?.getTitleSync;
	return getTitleSync ? getTitleSync( href, storedTitle ) : storedTitle ?? href;
}

/** The attributes of a `reference` to `href`, with `storedTitle` when there is one to keep. */
export function referenceAttributes( href: string | undefined, storedTitle: string | undefined ) {
	return storedTitle ? { href, storedTitle } : { href };
}

/** The text inside `element` and its descendants. */
function getText( element: ViewElement ): string {
	let text = '';
	for ( const child of element.getChildren() ) {
		text += child.is( '$text' ) ? child.data : getText( child as ViewElement );
	}
	return text;
}

/** The attachment a reference link points to, or `null` for a link to a note. */
export function getAttachmentId( href: unknown ) {
	const query = typeof href === 'string' ? href.split( '?' )[ 1 ] : undefined;
	return query ? new URLSearchParams( query ).get( 'attachmentId' ) : null;
}

/**
 * The note a reference link points to, the last segment of its note path. For a link to an
 * attachment, the note that owns it.
 */
export function getNoteId( href: unknown ) {
	const notePath = typeof href === 'string' ? href.split( '?' )[ 0 ].replace( /^#/, '' ) : '';
	return notePath.split( '/' ).at( -1 ) || null;
}

declare module "ckeditor5" {
	interface PluginsMap {
		[ReferenceLinkEditing.pluginName]: ReferenceLinkEditing;
	}

	interface EditorConfig {
		referenceLink?: {
			/** Resolves the title of the note or attachment `href` points to, loading it if needed. */
			getTitle?( href: string ): Promise<string>;
			/**
			 * The title of the note or attachment `href` points to, from what is already loaded.
			 * `storedTitle` is the title the saved content holds, for a note that is not loaded.
			 */
			getTitleSync?( href: string, storedTitle?: string ): string;
			/**
			 * Fills `element` with the label of the link to `href`, which the host can load.
			 * Without it, the link shows what `getTitleSync()` reads.
			 */
			renderTitle?( element: HTMLElement, href: string, storedTitle?: string ): void;
			/**
			 * Lets the user pick the note a reference link to a missing note should point at
			 * instead, starting from `storedTitle`, and calls `fix()` with the new href.
			 */
			fixLink?( storedTitle: string, fix: ( href: string ) => void ): void;
		};
	}
}
