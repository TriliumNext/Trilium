import { LOCALES as WEBSITE_LOCALES } from "../../apps/website/src/locales.ts";
import { LOCALES as APP_LOCALES } from "../../packages/commons/src/lib/i18n.ts";
import {
    findUnofferedLanguages, getLanguageStats, type OfferedLocale, type WeblateProject
} from "./utils.mts";

/**
 * Coverage above which a language must be offered, rather than sitting
 * translated but unreachable.
 */
const MINIMUM_COVERAGE_PERCENT = 50;

interface GatedProject {
    project: WeblateProject;
    /** Names the list a maintainer has to add the locale to, quoted in the failure. */
    listDescription: string;
    locales: OfferedLocale[];
}

const GATED_PROJECTS: GatedProject[] = [
    {
        project: "client",
        listDescription: "LOCALES in packages/commons/src/lib/i18n.ts",
        locales: APP_LOCALES
    },
    {
        project: "website",
        listDescription: "LOCALES in apps/website/src/locales.ts",
        locales: WEBSITE_LOCALES
    }
];

async function main() {
    const failures: string[] = [];

    for (const { project, listDescription, locales } of GATED_PROJECTS) {
        const languageStats = await getLanguageStats(project);
        const unoffered = findUnofferedLanguages(
            languageStats.results, locales, MINIMUM_COVERAGE_PERCENT);
        for (const localeData of unoffered) {
            const localeId = localeData.language_code;
            const reason = locales.some(l => l.id === localeId)
                ? `is marked \`contentOnly\` in ${listDescription}`
                : `is missing from ${listDescription}`;
            const percentage = localeData.translated_percent;
            failures.push(
                `❌ ${localeData.language.name} (${localeId}) is ${percentage}% translated `
                + `in '${project}', but ${reason}.`);
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
