export interface Blob {
    blobId: string;
    content: string | Buffer;
    textRepresentation?: string | null;
    utcDateModified: string;
}
