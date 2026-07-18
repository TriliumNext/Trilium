export interface File {
    originalname: string;
    mimetype: string;
    buffer: string | Buffer | Uint8Array;
    /**
     * Filesystem path of the uploaded file when it was streamed to disk (server multer disk storage).
     * Lets a zip be read in place instead of buffering it; absent for the browser/WASM upload, which
     * only has `buffer`.
     */
    path?: string;
}
