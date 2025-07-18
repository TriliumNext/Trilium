import AbstractBeccaEntity from "./abstract_becca_entity.js";
import type { BlobRow } from "@triliumnext/commons";

// TODO: Why this does not extend the abstract becca?
class BBlob extends AbstractBeccaEntity<BBlob> {
    static get entityName() {
        return "blobs";
    }
    static get primaryKeyName() {
        return "blobId";
    }
    static get hashedProperties() {
        return ["blobId", "content", "ocr_text"];
    }

    content!: string | Buffer;
    contentLength!: number;
    ocr_text?: string | null;

    constructor(row: BlobRow) {
        super();
        this.updateFromRow(row);
    }

    updateFromRow(row: BlobRow): void {
        this.blobId = row.blobId;
        this.content = row.content;
        this.contentLength = row.contentLength;
        this.ocr_text = row.ocr_text;
        this.dateModified = row.dateModified;
        this.utcDateModified = row.utcDateModified;
    }

    getPojo() {
        return {
            blobId: this.blobId,
            content: this.content || null,
            contentLength: this.contentLength,
            ocr_text: this.ocr_text || null,
            dateModified: this.dateModified,
            utcDateModified: this.utcDateModified
        };
    }
}

export default BBlob;
