export interface File {
    originalname: string;
    mimetype: string;
    buffer: string | Buffer | Uint8Array;
}
