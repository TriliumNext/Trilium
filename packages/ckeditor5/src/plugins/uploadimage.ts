import type { StandaloneApi } from "@triliumnext/commons";
import {
	FileRepository,
	Plugin,
	type Editor,
	type FileLoader,
	type LocaleTranslate,
	type UploadAdapter
} from "ckeditor5";

export default class UploadimagePlugin extends Plugin {
	static get requires() {
		return [ FileRepository ];
	}

	static get pluginName() {
		return 'UploadimagePlugin';
	}

	init() {
		const editor = this.editor;
		const fileRepository = editor.plugins.get('FileRepository');
		fileRepository.createUploadAdapter = loader => new Adapter(loader, editor);
	}
}

const linkLoaders = new WeakSet<FileLoader>();

/** Makes the upload answer with a link to the attachment, and store a picture as uploaded. */
export function uploadAsLink(loader: FileLoader) {
	linkLoaders.add(loader);
}

export function isUploadAsLink(loader: FileLoader) {
	return linkLoaders.has(loader);
}

class Adapter implements UploadAdapter {
    private loader: FileLoader;
    private editor: Editor;
    private t: LocaleTranslate;
    private xhr?: XMLHttpRequest;
    private rejectLocal?: () => void;

	/**
	 * Creates a new adapter instance.
	 */
	constructor(loader: FileLoader, editor: Editor) {
		/**
		 * FileLoader instance to use during the upload.
		 */
		this.loader = loader;
		this.editor = editor;
		this.t = editor.t;
	}

	/**
	 * Starts the upload process.
	 *
	 * @see module:upload/filerepository~Adapter#upload
	 */
	upload() {
		return this.loader.file.then((file): Promise<unknown> => {
			if (!file) {
				throw "Missing file";
			}

			const localUpload = this.editor.config.get('attachmentUpload')?.getLocalUpload?.();
			if (localUpload) {
				return this._uploadLocally(localUpload, file);
			}

			return new Promise<File | null>((resolve, reject) => {
				this._initRequest(file).then(() => {
					this._initListeners(file, resolve, reject);
					this._sendRequest(file);
				}, reject);
			});
		}) as Promise<any>;
	}

	/**
	 * Aborts the upload process.
	 *
	 * @see module:upload/filerepository~Adapter#abort
	 * @returns {Promise}
	 */
	abort() {
		if (this.xhr) {
			this.xhr.abort();
		}
		this.rejectLocal?.();
	}

	/**
	 * Hands the file to the host's local server. A raw request with a body cannot reach it: the
	 * mobile app's native request bridges answer GET and HEAD only.
	 */
	private async _uploadLocally(localUpload: LocalUpload, file: File) {
		const genericError = this.t('Cannot upload file:') + ` ${file.name}.`;
		const { url, headers } = await this._getRequestTarget(file);
		const aborted = new Promise<never>((_, reject) => {
			this.rejectLocal = () => reject();
		});

		const upload = (async () => {
			let resp: Response;
			try {
				resp = await localUpload(url, { method: 'POST', headers, fields: {}, file });
			} catch {
				throw genericError;
			}

			const response = await resp.json().catch(() => null);
			if (!response?.uploaded) {
				throw `${genericError} ${describeUploadFailure(this.t, resp.status, response)}`.trim();
			}
			return { default: response.url };
		})();

		try {
			return await Promise.race([ upload, aborted ]);
		} finally {
			this.rejectLocal = undefined;
		}
	}

	/**
	 * Initializes the XMLHttpRequest object.
	 *
	 * @private
	 */
	_initRequest(file: File) {
		return this._getRequestTarget(file).then(({ url, headers }) => {
			const xhr = this.xhr = new XMLHttpRequest();

			xhr.open('POST', url, true);
			xhr.responseType = 'json';

			for (const headerName in headers) {
				xhr.setRequestHeader(headerName, headers[headerName]);
			}
		});
	}

	/**
	 * The relative URL of the upload route for the note `getNoteId` names, and the request headers.
	 * Rejects when the editor names no note to attach `file` to.
	 */
	private async _getRequestTarget(file: File) {
		const config = this.editor.config;
		const noteId = config.get('getNoteId')?.();
		if (!noteId) {
			throw this.t('Cannot upload file:') + ` ${file.name}.`;
		}

		const headers = await config.get('attachmentUpload')?.getHeaders?.() ?? {};
		const query = isUploadAsLink(this.loader) ? "?link=true" : "";

		// this must be a relative path
		return { url: `api/notes/${noteId}/attachments/upload${query}`, headers };
	}

	/**
	 * Initializes XMLHttpRequest listeners.
	 *
	 * @private
	 * @param resolve Callback function to be called when the request is successful.
	 * @param reject Callback function to be called when the request cannot be completed.
	 */
	_initListeners(file: File, resolve: (value: File | PromiseLike<File | null> | null) => void, reject: (reason?: any) => void) {
		const xhr = this.xhr;
        /* v8 ignore next 4 -- unreachable: _initListeners runs only after _initRequest() resolves, which always assigns this.xhr */
        if (!xhr) {
            reject("Missing XHR");
            return;
        }

		const loader = this.loader;
		const t = this.t;
		const genericError = t('Cannot upload file:') + ` ${file.name}.`;

		xhr.addEventListener('error', () => reject(genericError));
		xhr.addEventListener('abort', () => reject());
		xhr.addEventListener('load', () => {
			const response = xhr.response;

			if (!response || !response.uploaded) {
				return reject(`${genericError} ${describeUploadFailure(t, xhr.status, response)}`.trim());
			}

			resolve({
				default: response.url
			} as unknown as File);
		});

		// Upload progress when it's supported.
		/* v8 ignore next -- legacy: a live browser XMLHttpRequest always exposes `upload`, so the no-progress-support branch is unreachable */
		if (xhr.upload) {
			xhr.upload.addEventListener('progress', evt => {
				if (evt.lengthComputable) {
					loader.uploadTotal = evt.total;
					loader.uploaded = evt.loaded;
				}
			});
		}
	}

	/**
	 * Prepares the data and sends the request.
	 *
	 * @private
	 */
	_sendRequest(file: File) {
		const data = new FormData();
		data.append('upload', file);
		this.xhr?.send(data);
	}
}

/**
 * Explains why an upload the server answered did not produce an attachment.
 *
 * The response is parsed as JSON, so anything that rejects the request before it reaches Trilium —
 * a reverse proxy enforcing its own body-size limit, most commonly — leaves nothing to quote and
 * only the status code says what happened. Reporting it beats the bare "cannot upload" that used
 * to be the only thing such a failure produced (#10859).
 *
 * @param status the HTTP status of the response.
 * @param response the parsed response body, `null` when it was not JSON.
 * @returns a sentence to append to the generic error, or an empty string when there is nothing to
 *          add.
 */
function describeUploadFailure(t: LocaleTranslate, status: number, response: { error?: { message?: string } } | null): string {
	const serverMessage = response?.error?.message;
	if (serverMessage) {
		return serverMessage;
	}

	if (status === 413) {
		return t('The file is too large to be uploaded (HTTP 413). If Trilium is behind a reverse proxy, raise its request body size limit.');
	}

	if (status) {
		return t('The server responded with HTTP %0.', String(status));
	}

	return '';
}

type LocalUpload = NonNullable<StandaloneApi["localUpload"]>;

/** The services the host provides for uploading attachments, through the `attachmentUpload` config entry. */
export interface AttachmentUploadHost {
	/** The headers of an upload request. */
	getHeaders(): Promise<Record<string, string>>;
	/**
	 * The host's in-page upload to its local server, when it has one. Uploads go through it
	 * because a raw request with a body cannot reach that server from every platform.
	 */
	getLocalUpload(): LocalUpload | undefined;
	/** The box size a new embed of an uploaded file starts at, from its media type and size. */
	getEmbedBoxSize(mime: string, size: number): string;
}

declare module "ckeditor5" {
	interface EditorConfig {
		/** The ID of the note the editor holds, which uploads attach to and anchor links point to. */
		getNoteId?(): string | undefined;
		attachmentUpload?: Partial<AttachmentUploadHost>;
	}
}
