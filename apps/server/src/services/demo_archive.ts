import fs from "fs";
import path from "path";

/**
 * Reads the demo archive imported into a fresh database, preferring a localized variant
 * (`demo-<locale>.zip`, e.g. `demo-ru.zip` for Russian) when one exists next to the default
 * English `demo.zip` in the given resource directory. Locales without a translated archive
 * transparently fall back to the English demo, as do missing/empty locale values.
 */
export function readDemoArchive(resourceDir: string, locale?: string): Buffer {
    const dbDir = path.join(resourceDir, "db");
    if (locale) {
        const localizedPath = path.join(dbDir, `demo-${locale}.zip`);
        if (fs.existsSync(localizedPath)) {
            return fs.readFileSync(localizedPath);
        }
    }
    return fs.readFileSync(path.join(dbDir, "demo.zip"));
}
