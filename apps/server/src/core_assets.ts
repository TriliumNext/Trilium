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
 * Reads one of the LLM skill sheets, by the file name core's catalog gives, on
 * the same two paths as {@link loadCoreSchema}: copied under RESOURCE_DIR by the
 * build, resolved through the workspace symlink when running from source.
 *
 * Returns null rather than throwing — a missing sheet costs the model one tool
 * call, and is not worth failing a chat over.
 */
export function loadSkillSheet(file: string): string | null {
    // The name comes from core's own catalog, but it is interpolated into a path,
    // so anything that could climb out of the directory is refused outright.
    if (file.includes("/") || file.includes("\\") || file.includes("..")) {
        return null;
    }

    const productionPath = path.join(RESOURCE_DIR, "llm", "skills", file);
    try {
        if (fs.existsSync(productionPath)) {
            return fs.readFileSync(productionPath, "utf-8");
        }
        return fs.readFileSync(require.resolve(`@triliumnext/core/src/assets/llm/skills/${file}`), "utf-8");
    } catch {
        return null;
    }
}
