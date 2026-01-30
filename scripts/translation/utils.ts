import { readFile, stat,writeFile } from "fs/promises";
import { join } from "path";

const scriptDir = __dirname;

export async function getLanguageStats(project: "readme" | "client") {
    const cacheFile = join(scriptDir, `.language-stats-${project}.json`);

    // Try to read from the cache.
    try {
        const cacheStats = await stat(cacheFile);
        const now = new Date();
        const oneDay = 24 * 60 * 60 * 1000; // milliseconds
        if (cacheStats.mtimeMs < now.getTime() + oneDay) {
            console.log("Reading language stats from cache.");
            return JSON.parse(await readFile(cacheFile, "utf-8"));
        }
    } catch (e) {
        if (!(e && typeof e === "object" && "code" in e && e.code === "ENOENT")) {
            throw e;
        }
    }

    // Make the request
    console.log("Reading language stats from Weblate API.");
    const request = await fetch(`https://hosted.weblate.org/api/components/trilium/${project}/translations/`);
    const stats = JSON.parse(await request.text());

    // Update the cache
    await writeFile(cacheFile, JSON.stringify(stats, null, 4));

    return stats;
}
