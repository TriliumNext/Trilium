import anonymizationService from "./services/anonymization.js";
import sqlInit from "./services/sql_init.js";
await import("@triliumnext/core");

sqlInit.dbReady.then(async () => {
    try {
        console.log("Starting anonymization...");

        const resp = await anonymizationService.createAnonymizedCopy("full");

        if (resp.success) {
            console.log(`Anonymized file has been saved to: ${resp.anonymizedFilePath}`);

            process.exit(0);
        } else {
            console.log("Anonymization failed.");
        }
    } catch (e: any) {
        console.error(e.message, e.stack);
    }

    process.exit(1);
});
