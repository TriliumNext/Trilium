export interface Blob {
    blobId: string;
    content: string | Buffer | null;
    contentLocation: string;
    contentLength: number;
    utcDateModified: string;
}
