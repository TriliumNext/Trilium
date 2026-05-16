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

/**
 * Resolves the path to the integration test database fixture, with the same
 * production-bundled vs. dev/test fallback as loadCoreSchema().
 *
 * Returns a real on-disk path so callers can either feed it into
 * fs.readFileSync() (to load as a buffer for an in-memory connection) or
 * pass it directly to better-sqlite3's `new Database(path)` constructor
 * (for a separate file-backed read-only connection like share uses).
 *
 * Only meaningful when TRILIUM_INTEGRATION_TEST is set; production code
 * paths that call this should be gated by that env var.
 */
export function getIntegrationTestDbPath(): string {
    const productionPath = path.join(RESOURCE_DIR, "test", "document.db");
    if (fs.existsSync(productionPath)) {
        return productionPath;
    }
    return require.resolve("@triliumnext/core/src/test/fixtures/document.db");
}
