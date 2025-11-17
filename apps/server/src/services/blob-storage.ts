import fs from "fs";
import path from "path";
import { randomUUID } from "crypto";
import dataDirs from "./data_dir.js";
import log from "./log.js";
import config from "./config.js";
import blob from "./blob.js";
import sql from "./sql.js";
import type { Blob } from "./blob-interface.js";
import { BlobContentLocation } from "@triliumnext/commons";

const EXTERNAL_BLOB_DIR = "external-blobs";

export class BlobStorageService {
    private externalBlobPath: string;
    private _hasExternalContentColumns: boolean | null = null;

    constructor() {
        this.externalBlobPath = path.join(dataDirs.TRILIUM_DATA_DIR, EXTERNAL_BLOB_DIR);
        this.ensureExternalBlobDir();
    }

    /**
     * Check if the external content columns (contentLocation, contentLength) exist in the blobs table.
     * This is cached for performance.
     * Returns false before migration 234 has been applied (aka when applying older migrations).
     */
    hasExternalContentColumns(): boolean {
        if (!this._hasExternalContentColumns) {
            // In most cases the columns will already exist, so we intentionally recheck
            // to see if the migration was applied after the first check.
            this._hasExternalContentColumns = !!sql.getValue(/*sql*/`
                SELECT 1 FROM pragma_table_info('blobs') WHERE name = 'contentLocation'
            `);
        }

        return this._hasExternalContentColumns;
    }

    private ensureExternalBlobDir(): void {
        if (!fs.existsSync(this.externalBlobPath)) {
            try {
                fs.mkdirSync(this.externalBlobPath, { recursive: true, mode: 0o700 });
                log.info(`Created external blob directory: ${this.externalBlobPath}`);
            } catch (error) {
                log.error(`Failed to create external blob directory: ${error}`);
                throw error;
            }
        }
    }

    /**
     * Store blob content externally and return the relative file path
     */
    saveExternal(blobId: string, content: string | Buffer): BlobContentLocation {
        const uuid = randomUUID();
        const partition = uuid.substring(0, 2);
        const relativePath = path.join(partition, `${uuid}.blob`);
        const absolutePath = path.join(this.externalBlobPath, relativePath);

        try {
            const dir = path.dirname(absolutePath);
            if (!fs.existsSync(dir)) {
                fs.mkdirSync(dir, { recursive: true, mode: 0o700 });
            }

            fs.writeFileSync(absolutePath, content, { mode: 0o600 });
            log.info(`Stored blob ${blobId} externally at: ${absolutePath}`);
            return `file://${relativePath}`;
        } catch (error) {
            log.error(`Failed to store blob ${blobId} externally: ${error}`);
            throw error;
        }
    }

    /**
     * Retrieve blob content from external storage
     */
    getExternal(relativePath: string): Buffer {
        const filePath = path.join(this.externalBlobPath, relativePath);
        try {
            return fs.readFileSync(filePath);
        } catch (error) {
            log.error(`Failed to retrieve blob from external storage ${filePath}: ${error}`);
            throw error;
        }
    }

    /**
     * Get the content of a blob row
     */
    getContent(row: Pick<Blob, "content" | "contentLocation">): string | Buffer | null {
        return row.contentLocation === "internal" ? row.content : this.getExternal(row.contentLocation.replace("file://", ""));
    }

    /**
     * Delete external blob file asynchronously for cleanup
     */
    deleteExternal(row: Pick<Blob, "contentLocation">): void {
        if (!row.contentLocation || row.contentLocation === "internal") {
            return;
        }

        const relativePath = row.contentLocation.replace("file://", "");
        const filePath = path.join(this.externalBlobPath, relativePath);

        try {
            fs.unlinkSync(filePath);
            log.info(`Deleted external blob file: ${filePath}`);
        } catch (error) {
            log.error(`Failed to delete external blob file ${filePath}: ${error}`);
            throw error;
        }
    }

    /**
     * Check if a blob should be stored externally based on size
     */
    shouldStoreExternally(content: string | Buffer): boolean {
        if (!config.ExternalBlobStorage.enabled) {
            return false;
        }

        return blob.getContentLength(content) > config.ExternalBlobStorage.thresholdBytes;
    }

    /**
     * Check if an external blob file exists
     */
    externalFileExists(contentLocation: BlobContentLocation): boolean {
        if (contentLocation === "internal" || !contentLocation.startsWith("file://")) {
            return false;
        }

        const relativePath = contentLocation.replace("file://", "");
        const filePath = path.join(this.externalBlobPath, relativePath);
        return fs.existsSync(filePath);
    }
}

export default new BlobStorageService();
