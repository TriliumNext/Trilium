import { mkdir, readdir, rm,  } from "fs/promises";
import { join } from "path";

import dataDirs from "../data_dir";

export interface ImportRecord {
    path: string;
    created: number;
}

const MAX_AGE = 30 * 60_000;

abstract class ImportStoreBase {

    private importStore: Map<string, ImportRecord> = new Map();

    get(id: string) {
        return this.importStore.get(id);
    }

    set(id: string, record: Omit<ImportRecord, "created">) {
        this.importStore.set(id, {
            ...record,
            created: Date.now()
        });
    }

    async remove(id: string) {
        const record = this.get(id);
        if (!record) return;

        this.onRecordRemoved(record);
        this.importStore.delete(id);
    }

    startCleanupTimer() {
        setInterval(async () => {
            const now = Date.now();

            for (const [id, record] of this.importStore.entries()) {
                if (now - record.created > MAX_AGE) {
                    await this.remove(id);
                }
            }
        }, 5 * 60_000);
    }

    public abstract onRecordRemoved(record: ImportRecord): Promise<void>;

}

class DiskImportStore extends ImportStoreBase {

    constructor(private _uploadDir: string) {
        super();
    }

    get uploadDir() {
        return this._uploadDir;
    }

    async init() {
        // Ensure the import directory exists.
        await mkdir(this._uploadDir, { recursive: true });

        // Delete all files at start-up.
        const files = await readdir(this._uploadDir);
        await Promise.all(files.map(async file => {
            try {
                await rm(join(this._uploadDir, file));
            } catch (e) {
                console.error(`Error while deleting import: ${file}`, e);
            }
        }));
    }

    public async onRecordRemoved(record: ImportRecord): Promise<void> {
        try {
            await rm(record.path);
        } catch (e) {
            console.error(`Unable to delete file from import store: ${record.path}.`, e);
        }
    }

}

const store = new DiskImportStore(join(dataDirs.TMP_DIR, "upload"));
store.init();
store.startCleanupTimer();
export default store;
