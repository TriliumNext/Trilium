import { protected_session } from "@triliumnext/core";

import type BNote from "../becca/entities/bnote.js";
import attributeService from "../services/attributes.js";
import cls from "./cls.js";
import config from "./config.js";
import hiddenSubtreeService from "./hidden_subtree.js";
import log from "./log.js";
import options from "./options.js";
import scriptService from "./script.js";
import sqlInit from "./sql_init.js";
import ws from "./ws.js";

function getRunAtHours(note: BNote): number[] {
    try {
        return note.getLabelValues("runAtHour").map((hour) => parseInt(hour));
    } catch (e: any) {
        log.error(`Could not parse runAtHour for note ${note.noteId}: ${e.message}`);

        return [];
    }
}

function runNotesWithLabel(runAttrValue: string) {
    const instanceName = config.General.instanceName;
    const currentHours = new Date().getHours();
    const notes = attributeService.getNotesWithLabel("run", runAttrValue);

    for (const note of notes) {
        const runOnInstances = note.getLabelValues("runOnInstance");
        const runAtHours = getRunAtHours(note);

        if ((runOnInstances.length === 0 || runOnInstances.includes(instanceName)) && (runAtHours.length === 0 || runAtHours.includes(currentHours))) {
            scriptService.executeNoteNoException(note, { originEntity: note });
        }
    }
}

// If the database is already initialized, we need to check the hidden subtree. Otherwise, hidden subtree
// is also checked before importing the demo.zip, so no need to do it again.
if (sqlInit.isDbInitialized()) {
    console.log("Checking hidden subtree.");
    sqlInit.dbReady.then(() => cls.init(() => hiddenSubtreeService.checkHiddenSubtree()));
}

// Periodic checks.
sqlInit.dbReady.then(() => {
    if (!process.env.TRILIUM_SAFE_MODE) {
        setTimeout(
            cls.wrap(() => runNotesWithLabel("backendStartup")),
            10 * 1000
        );

        setInterval(
            cls.wrap(() => runNotesWithLabel("hourly")),
            3600 * 1000
        );

        setInterval(
            cls.wrap(() => runNotesWithLabel("daily")),
            24 * 3600 * 1000
        );

        setInterval(
            cls.wrap(() => hiddenSubtreeService.checkHiddenSubtree()),
            7 * 3600 * 1000
        );
    }

    setInterval(() => checkProtectedSessionExpiration(), 30000);
});

function checkProtectedSessionExpiration() {
    const protectedSessionTimeout = options.getOptionInt("protectedSessionTimeout");
    const lastProtectedSessionOperationDate = protected_session.getLastProtectedSessionOperationDate();
    if (protected_session.isProtectedSessionAvailable() && lastProtectedSessionOperationDate && Date.now() - lastProtectedSessionOperationDate > protectedSessionTimeout * 1000) {
        protected_session.resetDataKey();
        log.info("Expiring protected session");
        ws.reloadFrontend("leaving protected session");
    }
}
