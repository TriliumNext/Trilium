import { LOCALES as WEBSITE_LOCALES } from "../../apps/website/src/locales";
import { LOCALES as APP_LOCALES } from "../../packages/commons/src/lib/i18n";
import { getLanguageStats, type WeblateProject } from "./utils";

/**
 * Coverage above which a language must be offered, rather than sitting
 * translated but unreachable.
 */
const MINIMUM_COVERAGE_PERCENT = 50;

interface GatedProject {
    project: WeblateProject;
    /** Names the list a maintainer has to add the locale to, quoted in the failure. */
    listDescription: string;
    localeIds: string[];
}

const GATED_PROJECTS: GatedProject[] = [
    {
        project: "client",
        listDescription: "LOCALES in packages/commons/src/lib/i18n.ts",
        localeIds: APP_LOCALES.map(l => l.id)
    },
    {
        project: "website",
        listDescription: "LOCALES in apps/website/src/locales.ts",
        localeIds: WEBSITE_LOCALES.map(l => l.id)
    }
];

async function main() {
    const failures: string[] = [];

    for (const { project, listDescription, localeIds } of GATED_PROJECTS) {
        const languageStats = await getLanguageStats(project);
        for (const localeData of languageStats.results) {
            const localeId = localeData.language_code;
            const percentage = localeData.translated_percent;
            if (percentage <= MINIMUM_COVERAGE_PERCENT || localeIds.includes(localeId)) {
                continue;
            }

            failures.push(
                `❌ ${localeData.language.name} (${localeId}) is ${percentage}% translated `
                + `in '${project}', but is missing from ${listDescription}.`);
        }
    }

    if (failures.length > 0) {
        for (const failure of failures.toSorted((a, b) => a.localeCompare(b))) {
            console.error(failure);
        }
        console.error(`\n${failures.length} language(s) above `
            + `${MINIMUM_COVERAGE_PERCENT}% are translated but not offered.`);
        process.exit(1);
    }

    console.log("✅ Translation coverage check passed.");
}

main();
