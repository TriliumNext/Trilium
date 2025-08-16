import fs from "fs";
import path from "path";
import dataDirs from "./data_dir.js";
import log from "./log.js";
import config from "./config.js";
import blob from "./blob.js";
import type { Blob } from "./blob-interface.js";

const EXTERNAL_BLOB_DIR = "external-blobs";

export class BlobStorageService {
    private externalBlobPath: string;

    constructor() {
        this.externalBlobPath = path.join(dataDirs.TRILIUM_DATA_DIR, EXTERNAL_BLOB_DIR);
        this.ensureExternalBlobDir();
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
     * Store blob content externally and return the file path
     */
    saveExternal(blobId: string, content: string | Buffer): string {
        const partition = blobId.substring(0, 2);
        const filePath = path.join(this.externalBlobPath, partition, `${blobId}.blob`);

        try {
            const dir = path.dirname(filePath);
            if (!fs.existsSync(dir)) {
                fs.mkdirSync(dir, { recursive: true, mode: 0o700 });
            }

            fs.writeFileSync(filePath, content, { mode: 0o600 });
            log.info(`Stored blob ${blobId} externally at: ${filePath}`);
            return filePath;
        } catch (error) {
            log.error(`Failed to store blob ${blobId} externally: ${error}`);
            throw error;
        }
    }

    /**
     * Retrieve blob content from external storage
     */
    getExternal(filePath: string): Buffer {
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
    deleteExternal(filePath: string): void {
        fs.unlink(filePath, (error) => {
            if (error) {
                log.error(`Failed to delete external blob file ${filePath}: ${error}`);
            } else {
                log.info(`Deleted external blob file: ${filePath}`);
            }
        });
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
}

export default new BlobStorageService();
