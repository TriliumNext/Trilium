import server from "./server.js";
import protectedSessionHolder from "./protected_session_holder.js";
import toastService from "./toast.js";
import type { ToastOptionsWithRequiredId } from "./toast.js";
import ws from "./ws.js";
import appContext from "../components/app_context.js";
import froca from "./froca.js";
import utils from "./utils.js";
import options from "./options.js";
import { t } from "./i18n.js";

let protectedSessionDeferred: JQuery.Deferred<any, any, any> | null = null;

// TODO: Deduplicate with server when possible.
interface Response {
    success: boolean;
}

interface Message {
    taskId: string;
    data: {
        protect: boolean;
    };
}

async function leaveProtectedSession() {
    if (protectedSessionHolder.isProtectedSessionAvailable()) {
        await protectedSessionHolder.resetProtectedSession();
    }
}

/** returned promise resolves with true if new protected session was established, false if no action was necessary */
function enterProtectedSession() {
    const dfd = $.Deferred();

    if (!options.is("isPasswordSet")) {
        appContext.triggerCommand("showPasswordNotSet");
        return dfd;
    }

    if (protectedSessionHolder.isProtectedSessionAvailable()) {
        dfd.resolve(false);
    } else {
        // using deferred instead of promise because it allows resolving from the outside
        protectedSessionDeferred = dfd;

        appContext.triggerCommand("showProtectedSessionPasswordDialog");
    }

    return dfd.promise();
}

async function reloadData() {
    const allNoteIds = Object.keys(froca.notes);

    await froca.loadInitialTree();

    // make sure that all notes used in the application are loaded, including the ones not shown in the tree
    await froca.reloadNotes(allNoteIds);
}

async function setupProtectedSession(password: string) {
    const response = await server.post<Response>("login/protected", { password: password });

    if (!response.success) {
        toastService.showError(t("protected_session.wrong_password"), 3000);
        return;
    }

    protectedSessionHolder.enableProtectedSession();
}

ws.subscribeToMessages(async (message) => {
    if (message.type === "protectedSessionLogin") {
        await reloadData();

        await appContext.triggerEvent("frocaReloaded", {});

        appContext.triggerEvent("protectedSessionStarted", {});

        appContext.triggerCommand("closeProtectedSessionPasswordDialog");

        if (protectedSessionDeferred !== null) {
            protectedSessionDeferred.resolve(true);
            protectedSessionDeferred = null;
        }

        toastService.showMessage(t("protected_session.started"));
    } else if (message.type === "protectedSessionLogout") {
        utils.reloadFrontendApp(`Protected session logout`);
    }
});

async function protectNote(noteId: string, protect: boolean, includingSubtree: boolean) {
    await enterProtectedSession();

    await server.put(`notes/${noteId}/protect/${protect ? 1 : 0}?subtree=${includingSubtree ? 1 : 0}`);
}

function makeToast(message: Message, title: string, text: string): ToastOptionsWithRequiredId {
    return {
        id: message.taskId,
        title,
        message: text,
        icon: message.data.protect ? "check-shield" : "shield"
    };
}

ws.subscribeToMessages(async (message) => {
    if (!("taskType" in message) || message.taskType !== "protectNotes") {
        return;
    }

    const isProtecting = message.data?.protect;
    const title = isProtecting ? t("protected_session.protecting-title") : t("protected_session.unprotecting-title");

    if (message.type === "taskError") {
        toastService.closePersistent(message.taskId);
        toastService.showError(message.message);
    } else if (message.type === "taskProgressCount") {
        const count = message.progressCount;
        const text = isProtecting ? t("protected_session.protecting-in-progress", { count }) : t("protected_session.unprotecting-in-progress-count", { count });
        toastService.showPersistent(makeToast(message, title, text));
    } else if (message.type === "taskSucceeded") {
        const text = isProtecting ? t("protected_session.protecting-finished-successfully") : t("protected_session.unprotecting-finished-successfully");
        const toast = makeToast(message, title, text);
        toast.timeout = 3000;

        toastService.showPersistent(toast);
    }
});

export default {
    protectNote,
    enterProtectedSession,
    leaveProtectedSession,
    setupProtectedSession
};
