import AbstractBeccaEntity from "./abstract_becca_entity.js";
import type { BlobRow, BlobContentLocation } from "@triliumnext/commons";

// TODO: Why this does not extend the abstract becca?
class BBlob extends AbstractBeccaEntity<BBlob> {
    static get entityName() {
        return "blobs";
    }
    static get primaryKeyName() {
        return "blobId";
    }
    static get hashedProperties() {
        return ["blobId", "content", "contentLocation"];
    }

    content!: string | Buffer;
    contentLength!: number;
    contentLocation!: BlobContentLocation;

    constructor(row: BlobRow) {
        super();
        this.updateFromRow(row);
    }

    updateFromRow(row: BlobRow): void {
        this.blobId = row.blobId;
        this.content = row.content;
        this.contentLength = row.contentLength;
        this.contentLocation = row.contentLocation;
        this.dateModified = row.dateModified;
        this.utcDateModified = row.utcDateModified;
    }

    getPojo() {
        return {
            blobId: this.blobId,
            content: this.content || null,
            contentLength: this.contentLength,
            contentLocation: this.contentLocation,
            dateModified: this.dateModified,
            utcDateModified: this.utcDateModified
        };
    }
}

export default BBlob;
