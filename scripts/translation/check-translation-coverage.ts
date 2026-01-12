import { LOCALES } from "../../packages/commons/src/lib/i18n";
import { getLanguageStats } from "./utils";

async function main() {
    const languageStats = await getLanguageStats("client");
    const localeIdsWithCoverage = languageStats.results
        .filter(language => language.translated_percent > 50)
        .map(language => language.language_code);

    for (const localeId of localeIdsWithCoverage) {
        const locale = LOCALES.find(l => l.id === localeId);
        if (!locale) {
            console.error(`Locale not found for id: ${localeId}`);
            process.exit(1);
        }
    }

    console.log("Translation coverage check passed.");
}

main();
