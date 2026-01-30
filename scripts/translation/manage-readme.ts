import { readFile, writeFile } from "fs/promises";
import { join } from "path";

import { getLanguageStats } from "./utils";

const scriptDir = __dirname;
const rootDir = join(scriptDir, "../..");
const docsDir = join(rootDir, "docs");

async function rewriteLanguageBar(readme: string) {
    // Filter languages by their availability.
    const languageStats = await getLanguageStats("readme");
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
