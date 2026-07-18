import fs from "fs";
import path from "path";

import { RESOURCE_DIR } from "./services/resource_dir.js";

/**
 * Reads schema.sql, falling back gracefully between bundled-production and
 * source/dev modes.
 *
 * In bundled production (Docker, packaged desktop), the build script copies
 * trilium-core's schema.sql into dist/assets/, which resolves to
 * RESOURCE_DIR/schema.sql at runtime. The bundle has no @triliumnext/core
 * package on disk, so require.resolve would fail with MODULE_NOT_FOUND.
 *
 * In dev/test (running source via tsx), the file isn't copied anywhere; the
 * workspace symlink in node_modules makes require.resolve work.
 */
export function loadCoreSchema(): string {
    const productionPath = path.join(RESOURCE_DIR, "schema.sql");
    if (fs.existsSync(productionPath)) {
        return fs.readFileSync(productionPath, "utf-8");
    }
    return fs.readFileSync(require.resolve("@triliumnext/core/src/assets/schema.sql"), "utf-8");
}
