import { LOCALES } from "../../packages/commons/src/lib/i18n";
import { getLanguageStats } from "./utils";

async function main() {
    const project = "client";
    const languageStats = await getLanguageStats(project);
    const localesWithCoverage = languageStats.results
        .filter(language => language.translated_percent > 50)

    for (const localeData of localesWithCoverage) {
        const { language_code: localeId, translated_percent: percentage, language } = localeData;
        const locale = LOCALES.find(l => l.id === localeId);
        if (!locale) {
            console.error(`❌ Language ${language.name} (${localeId}) has a coverage of ${percentage}% in '${project}', but it is not supported by the application.`);
            process.exit(1);
        }
    }

    console.log("✅ Translation coverage check passed.");
}

main();
