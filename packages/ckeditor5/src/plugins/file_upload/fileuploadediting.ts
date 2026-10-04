import {
	Clipboard,
	FileRepository,
	Notification,
	Plugin,
	type Editor,
	type FileLoader,
	type ModelItem,
	type ViewRange
} from 'ckeditor5';
import { getAttachmentId } from '../referencelink.js';
import FileUploadCommand, { isFocusUpload, isQuietUpload } from './fileuploadcommand';

/** A file attachment upload, announced by the `upload` event of `FileUploadEditing`. */
export interface FileUploadData {
	fileName: string;
	/** Reports the progress of the upload in `uploadedPercent`. */
	loader: FileLoader;
	/** Resolves when the upload ends, whether it succeeded or not. */
	done: Promise<void>;
}

export type FileUploadEvent = {
	name: 'upload';
	args: [ FileUploadData ];
};

export default class FileUploadEditing extends Plugin {

	static get requires() {
		return [ FileRepository, Notification, Clipboard ];
	}

	static get pluginName() {
		return 'FileUploadEditing';
	}

	init() {
		const editor = this.editor;
		const doc = editor.model.document;
		const conversion = editor.conversion;
		const fileRepository = editor.plugins.get( FileRepository );

		// Register fileUpload command.
		editor.commands.add( 'fileUpload', new FileUploadCommand( editor ) );

		// Register upcast converter for uploadId.
		conversion.for( 'upcast' )
			.attributeToAttribute( {
				view: {
					name: 'a',
					key: 'uploadId'
				},
				model: 'uploadId'
			} );

		this.listenTo( editor.editing.view.document, 'clipboardInput', ( evt, data ) => {
			// Skip if non-empty HTML data is included.
			// https://github.com/ckeditor/ckeditor5-upload/issues/68
			if ( isHtmlIncluded( data.dataTransfer ) ) {
				return;
			}

			const files: File[] = Array.from( data.dataTransfer.files );

			editor.model.change( writer => {
				// Set selection to paste target.
				if ( data.targetRanges ) {
					writer.setSelection( data.targetRanges.map( (viewRange: ViewRange) => editor.editing.mapper.toModelRange( viewRange ) ) );
				}

				if ( files.length ) {
					evt.stop();

					// Upload files after the selection has changed in order to ensure the command's state is refreshed.
					editor.model.enqueueChange(() => {
						editor.execute( 'fileUpload', { file: files } );
					} );
				}
			} );
		} );

		// Prevents from the browser redirecting to the dropped file.
		editor.editing.view.document.on( 'dragover', ( evt, data ) => {
			data.preventDefault();
		} );

		// Upload placeholder files that appeared in the model.
		doc.on( 'change', () => {
			const changes = doc.differ.getChanges( { includeChangesInGraveyard: true } );
			for ( const entry of changes ) {
				if ( entry.type == 'insert' ) {
					const item = entry.position.nodeAfter;
					/* v8 ignore next -- defensive: an "insert" differ change always reports the inserted node as position.nodeAfter, so `item` is never null here (the falsy branch is unreachable from any model operation). */
					if ( item ) {
						const isInGraveyard = entry.position.root.rootName == '$graveyard';
						for ( const file of getUploadPlaceholders( editor, item ) ) {
							// Check if the file element still has upload id.
							const uploadId = file.getAttribute( 'uploadId' ) as string | number;
							if ( !uploadId ) {
								continue;
							}

							// Check if the file is loaded on this client.
							const loader = fileRepository.loaders.get( uploadId );

							if ( !loader ) {
								continue;
							}

							if ( isInGraveyard ) {
								// If the file was inserted to the graveyard - abort the loading process.
								loader.abort();
							} else if ( loader.status == 'idle' ) {
								// If the file was inserted into content and has not been loaded yet, start loading it.
								this._readAndUpload( loader, file );
							}
						}
					}
				}
			}
		} );
	}

	_readAndUpload( loader: FileLoader, fileElement: ModelItem ) {
		const editor = this.editor;
		const model = editor.model;
		const t = editor.locale.t;
		const fileRepository = editor.plugins.get( FileRepository );
		const notification = editor.plugins.get( Notification );

		// The upload's changes are not undoable, so undo removes the inserted link instead.
		model.enqueueChange( { isUndoable: false }, writer => {
			writer.setAttribute( 'uploadStatus', 'reading', fileElement );
		} );

		const upload = loader.read()
			.then( () => {
				const promise = loader.upload();

				model.enqueueChange( { isUndoable: false }, writer => {
					writer.setAttribute( 'uploadStatus', 'uploading', fileElement );
				} );

				return promise;
			} )
			.then( data => {
				const attachmentId = getAttachmentId( data.default );
				// Before `attachmentId` is set: setting it makes the host render the embed.
				const isEmbed = fileElement.is( 'element', 'contentEmbed' );
				if ( attachmentId && isEmbed && isFocusUpload( loader ) ) {
					glob.getComponentByEl<EditorComponent>( editor.editing.view.getDomRoot() )
						.focusContentEmbed?.( attachmentId );
				}

				model.enqueueChange( { isUndoable: false }, writer => {
					if ( isEmbed ) {
						writer.setAttribute( 'attachmentId', attachmentId, fileElement );
					} else {
						writer.setAttribute( 'href', data.default, fileElement );
					}
				} );

				clean();
			} )
			.catch( error => {
				// If status is not 'error' nor 'aborted' - throw error, because it means that something else went wrong,
				// it might be a generic error, and it would be real pain to find what is going on.
				if ( loader.status !== 'error' && loader.status !== 'aborted' ) {
					throw error;
				}

				// Might be 'aborted'.
				if ( loader.status == 'error' && error ) {
					notification.showWarning( error, {
						title: t( 'Upload failed' ),
						namespace: 'upload'
					} );
				}

				clean();

				// Permanently remove file from insertion batch.
				model.enqueueChange( { isUndoable: false }, writer => {
					writer.remove( fileElement );
				} );
			} );

		if ( !isQuietUpload( loader ) ) {
			this.fire<FileUploadEvent>( 'upload', {
				fileName: String( fileElement.getAttribute( 'uploadFileName' ) ?? '' ),
				loader,
				done: Promise.allSettled( [ upload ] ).then( () => undefined )
			} );
		}

		return upload;

		function clean() {
			model.enqueueChange( { isUndoable: false }, writer => {
				writer.removeAttribute( 'uploadId', fileElement );
				writer.removeAttribute( 'uploadStatus', fileElement );
				writer.removeAttribute( 'uploadFileName', fileElement );
			} );

			fileRepository.destroyLoader( loader );
		}
	}
}

// Returns `true` if non-empty `text/html` is included in the data transfer.
//
// @param {module:clipboard/datatransfer~DataTransfer} dataTransfer
// @returns {Boolean}
export function isHtmlIncluded( dataTransfer: DataTransfer ) {
	return Array.from( dataTransfer.types ).includes( 'text/html' ) && dataTransfer.getData( 'text/html' ) !== '';
}

/** The links and embeds `FileUploadCommand` inserted, in `item` or inside it. */
function getUploadPlaceholders( editor: Editor, item: ModelItem ) {
	return Array.from( editor.model.createRangeOn( item ) )
		.map( value => value.item )
		.filter( node => node.is( 'element', 'reference' )
			|| node.is( 'element', 'contentEmbed' ) );
}
