import appContext from "../components/app_context.js";
import { t } from "./i18n.js";
import toastService from "./toast.js";
import { openInAppHelpFromUrl } from "./utils.js";

/**
 * Thrown by `api.runOnBackend()` / `api.runAsyncOnBackendWithManualTransactionHandling()` when
 * backend scripting is disabled on the server. The bundle executor recognizes this so it can skip
 * its per-note error toast — the single deduplicated toast raised alongside it is enough.
 *
 * This lives in its own module (rather than in `frontend_script_api.ts`) so `entrypoints`/`bundle`
 * can import it as a value without eagerly pulling in the frontend script API's widget graph, which
 * triggers a circular-import initialization error.
 */
export class BackendScriptingDisabledError extends Error {
    constructor() {
        super("Backend script execution is disabled.");
        this.name = "BackendScriptingDisabledError";
    }
}

// The notes that attempted to run backend code while it was disabled, accumulated so the single
// deduplicated toast can list them all as reference links. Cleared when the toast is removed.
const attempts = new Set<string>();

/**
 * Shows the single deduplicated "backend scripting is disabled" toast, adding the given note to the
 * list of scripts that tried to run backend code. Safe to call from any backend-execution entry
 * point — a frontend `runOnBackend()` call, or executing a backend code note directly.
 */
export function showBackendScriptingDisabledToast(noteId: string) {
    attempts.add(noteId);
    toastService.showPersistent({
        id: "backend-scripting-disabled",
        icon: "bx bx-code-block",
        title: t("frontend_script_api.backend_scripting_disabled_title"),
        message: t("frontend_script_api.backend_scripting_disabled_message"),
        notesHeading: t("frontend_script_api.backend_scripting_disabled_notes_heading"),
        notes: [ ...attempts ],
        wide: true,
        timeout: 60_000,
        onRemove: () => attempts.clear(),
        buttons: [
            {
                text: t("frontend_script_api.backend_scripting_disabled_open_settings"),
                onClick: ({ dismissToast }) => {
                    appContext.triggerCommand("showOptions", { section: "_optionsSecurity" });
                    dismissToast();
                }
            },
            {
                text: t("frontend_script_api.backend_scripting_disabled_more_info"),
                onClick: ({ dismissToast }) => {
                    // openInAppHelpFromUrl takes the help note ID without the "_help_" prefix.
                    openInAppHelpFromUrl("fiHicjpHjIRJ");
                    dismissToast();
                }
            }
        ]
    });
}
