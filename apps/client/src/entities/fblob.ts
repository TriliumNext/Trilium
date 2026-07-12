export interface FBlobRow {
    blobId: string;
    content: string;
    contentLength: number;
    dateModified: string;
    utcDateModified: string;
    /** `true` when the blob's content was withheld by the sync server because it exceeded this
     *  device's blob size limit (mobile). The content is empty; show an "open on server" placeholder. */
    isStubbed?: boolean;
}

export default class FBlob {
    blobId: string;
    /**
     * can either contain the whole content (in e.g. string notes), only part (large text notes) or nothing at all (binary notes, images)
     */
    content: string;
    contentLength: number;
    dateModified: string;
    utcDateModified: string;
    /** `true` when this blob is a sync stub (content withheld by the server due to the device's blob
     *  size limit). See {@link FBlobRow.isStubbed}. */
    isStubbed: boolean;

    constructor(row: FBlobRow) {
        this.blobId = row.blobId;
        this.content = row.content;
        this.contentLength = row.contentLength;
        this.dateModified = row.dateModified;
        this.utcDateModified = row.utcDateModified;
        this.isStubbed = row.isStubbed ?? false;
    }

    /**
     * @throws Error in case of invalid JSON
     */
    getJsonContent<T>(): T | null {
        if (!this.content || !this.content.trim()) {
            return null;
        }

        return JSON.parse(this.content);
    }

    getJsonContentSafely(): unknown | null {
        try {
            return this.getJsonContent();
        } catch (e) {
            return null;
        }
    }
}
