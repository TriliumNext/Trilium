import path from "path";
import { fileURLToPath } from "url";

const appDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "..");

export const repoRoot = path.resolve(appDir, "..", "..");
export const templatesDir = path.join(appDir, "templates");
export const outDir = path.join(appDir, "out");

/** The file name of the scene at `index`, numbered in listing order. */
export function sceneFileName(index, sceneId) {
    return `${String(index + 1).padStart(2, "0")}-${sceneId}.png`;
}
