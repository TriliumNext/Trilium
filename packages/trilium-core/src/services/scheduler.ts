import type BNote from "../becca/entities/bnote.js";
import attributeService from "../services/attributes.js";
import config from "./config.js";
import * as cls from "./context.js";
import events from "./events.js";
import hiddenSubtreeService from "./hidden_subtree.js";
import { reconcileLanguageAfterDbInit } from "./i18n.js";
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
    // Whenever a database comes up, whichever way it got here. This used to be asked of the instance
    // at the moment the scheduler started, which is the wrong moment: an instance that starts in the
    // setup wizard has no database yet and answers no, and the one it goes on to open — restored
    // from a backup, or pulled from a sync server — then never gets checked at all. A restored
    // database is exactly the one that needs it, since it was written by an older version and knows
    // nothing of whatever has been added to the subtree since.
    //
    // Creating a new document checks the subtree itself, before importing the demo content, so on
    // that one path this runs a second time over a subtree that is already whole. It is the same
    // check that runs every seven hours below, and it finds nothing to do.
    console.log("Checking hidden subtree.");
    sqlInit.dbReady.then(async () => {
        // Reconciled first, because the titles the check may write have to be in the document's own
        // language: i18next cannot read the stored locale before there is a database to read it
        // from, so on every path that opens one after start it is still on the fallback "en". A
        // no-op on an ordinary boot, where this has already been done.
        await reconcileLanguageAfterDbInit();
        cls.getContext().init(() => hiddenSubtreeService.checkHiddenSubtree());
    });

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
