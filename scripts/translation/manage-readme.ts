import { readFile, stat, writeFile,  } from "fs/promises";
import { join } from "path";

const scriptDir = __dirname;
const rootDir = join(scriptDir, "../..");
const docsDir = join(rootDir, "docs");

async function getLanguageStats() {
    const cacheFile = join(scriptDir, ".language-stats.json");

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
    const request = await fetch("https://hosted.weblate.org/api/components/trilium/readme/translations/");
    const stats = JSON.parse(await request.text());

    // Update the cache
    await writeFile(cacheFile, JSON.stringify(stats, null, 4));

    return stats;
}

async function rewriteLanguageBar(readme: string) {
    // Filter languages by their availability.
    const languageStats = await getLanguageStats();
    const languagesWithCoverage: any[] = languageStats.results.filter(language => language.translated_percent > 75);
    const languageLinks = languagesWithCoverage
        .map(language => `[${language.language.name}](./${language.filename})`)
        .toSorted((a, b) => a.localeCompare(b));

    readme = readme.replace(
        /<!-- LANGUAGE SWITCHER -->\r?\n.*$/m,
        `<!-- LANGUAGE SWITCHER -->\n${languageLinks.join(" | ")}`);
    return readme;
}

function rewriteRelativeLinks(readme: string) {
    readme = readme.replaceAll("./docs/", "./");
    readme = readme.replaceAll("./README.md", "../README.md");
    return readme;
}

/**
 * The base file is used by Weblate when generating new languages for the README file.
 * The problem is that translated READMEs reside in `/docs/` while the main README is in `/`, which breaks all relative links.
 * As such, we need to use a separate base file that is in `/docs` with the right relative paths.
 * The README in the repo root remains the true base file, but it's a two-step process which requires the execution of this script.
 */
async function main() {
    // Read the README at root level.
    const readmePath = join(rootDir, "README.md");
    let readme = await readFile(readmePath, "utf-8");

    // Update the README at root level.
    readme = await rewriteLanguageBar(readme);
    await writeFile(readmePath, readme);

    // Rewrite relative links for docs/README.md.
    readme = rewriteRelativeLinks(readme);
    const outputPath = join(docsDir, "README.md");
    await writeFile(outputPath, readme);
}

main();
