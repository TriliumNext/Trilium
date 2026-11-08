export interface File {
    originalname: string;
    mimetype: string;
    /**
     * The file's bytes. Unset for a zip import that arrives as `path` or `blob`; call
     * {@link loadUploadedBytes} before reading it on any path that does not read the zip in place.
     */
    buffer: string | Buffer | Uint8Array;
    /**
     * Filesystem path of the uploaded file when it was streamed to disk (server multer disk storage).
     * Lets a zip be read in place instead of buffering it.
     */
    path?: string;
    /** The file as the page picked it (browser/WASM), which lets a zip be read in place. */
    blob?: Blob;
}

/** Reads a `blob`-backed upload into `buffer`, for the importers that need the whole file. */
export async function loadUploadedBytes(file: File): Promise<void> {
    if (file.buffer === undefined && file.blob) {
        file.buffer = new Uint8Array(await file.blob.arrayBuffer());
    }
}
