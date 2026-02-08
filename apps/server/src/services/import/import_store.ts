import { mkdir, readdir, rm,  } from "fs/promises";
import { join } from "path";

import dataDirs from "../data_dir";

export interface ImportRecord {
    path: string;
}

abstract class ImportStoreBase {

    private importStore: Record<string, ImportRecord> = {};

    get(id: string) {
        return this.importStore[id];
    }

    set(id: string, record: ImportRecord) {
        this.importStore[id] = record;
    }

    public abstract remove(id: string): Promise<void>;

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

        const files = await readdir(this._uploadDir);
        await Promise.all(files.map(async file => {
            try {
                await rm(join(this._uploadDir, file));
            } catch (e) {
                console.error(`Error while deleting import: ${file}`, e);
            }
        }));
    }

    public async remove(id: string): Promise<void> {
        const record = this.get(id);
        if (!record) return;

        try {
            await rm(record.path);
        } catch (e) {
            console.error(`Unable to delete file from import store: ${id}.`, e);
        }
    }

}

const store = new DiskImportStore(join(dataDirs.TMP_DIR, "upload"));
store.init();
export default store;
