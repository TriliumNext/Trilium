import type BNote from "../becca/entities/bnote.js";
import attributeService from "../services/attributes.js";
import config from "./config.js";
import * as cls from "./context.js";
import events from "./events.js";
import hiddenSubtreeService from "./hidden_subtree.js";
import { getLog } from "./log.js";
import options from "./options.js";
import protected_session from "./protected_session.js";
import scriptService from "./script.js";
import { isScriptingEnabled } from "./scripting_guard.js";
import sqlInit from "./sql_init.js";
import ws from "./ws.js";

function getRunAtHours(note: BNote): number[] {
    try {
        return note.getLabelValues("runAtHour").map((hour) => parseInt(hour));
    } catch (e: any) {
        getLog().error(`Could not parse runAtHour for note ${note.noteId}: ${e.message}`);

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

export function startScheduler() {
    // If the database is already initialized, we need to check the hidden subtree. Otherwise, hidden subtree
    // is also checked before importing the demo.zip, so no need to do it again.
    if (sqlInit.isDbInitialized()) {
        console.log("Checking hidden subtree.");
        sqlInit.dbReady.then(() => cls.getContext().init(() => hiddenSubtreeService.checkHiddenSubtree()));
    }

    // Periodic checks.
    sqlInit.dbReady.then(() => {
        if (!process.env.TRILIUM_SAFE_MODE && isScriptingEnabled()) {
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
        }

        // Internal maintenance - always runs regardless of scripting setting
        setInterval(
            cls.wrap(() => hiddenSubtreeService.checkHiddenSubtree()),
            7 * 3600 * 1000
        );

        setInterval(
            cls.wrap(() => checkProtectedSessionExpiration()),
            30000
        );
    });
}

function checkProtectedSessionExpiration() {
    const protectedSessionTimeout = options.getOptionInt("protectedSessionTimeout");
    const lastProtectedSessionOperationDate = protected_session.getLastProtectedSessionOperationDate();
    if (protected_session.isProtectedSessionAvailable() && lastProtectedSessionOperationDate && Date.now() - lastProtectedSessionOperationDate > protectedSessionTimeout * 1000) {
        protected_session.resetDataKey();
        // Mirror logoutFromProtectedSession(): without this event, becca — and the flat-text
        // search index derived from it — would keep the decrypted titles in memory, letting
        // title-word searches match protected notes after the session ended.
        events.emit(events.LEAVE_PROTECTED_SESSION);
        getLog().info("Expiring protected session");
        ws.reloadFrontend("leaving protected session");
    }
}
