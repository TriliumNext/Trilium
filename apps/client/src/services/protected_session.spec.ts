import type { WebSocketMessage } from "@triliumnext/commons";
import { beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

// `protected_session.ts` registers two ws.subscribeToMessages handlers at
// import time. The setup.ts global ws mock simply drops the callbacks, so we
// override ws.js for this spec to CAPTURE them (hoisted so the factory runs
// before any transitive load of the module under test). protected_session only
// consumes `subscribeToMessages`; nothing else in its graph needs ws at load.
const { messageHandlers } = vi.hoisted(() => ({
    messageHandlers: [] as ((message: any) => Promise<void> | void)[]
}));

vi.mock("./ws.js", () => ({
    default: {
        subscribeToMessages(cb: (message: any) => Promise<void> | void) {
            messageHandlers.push(cb);
        },
        waitForMaxKnownEntityChangeId: async () => {}
    }
}));

// i18next is never `.init()`ed in this unit-test environment, so the real
// `t()` returns `undefined`, erasing the toast text/title. Mock `t` with a
// deterministic key-based serializer so we can assert which translation KEY
// (and the `count` interpolation) the source selected for each branch -- the
// structure/args, never a human-readable translated string.
vi.mock("./i18n.js", () => ({
    t: (key: string, opts?: Record<string, unknown>) =>
        opts && "count" in opts ? `${key}:count=${opts.count}` : key
}));

import appContext from "../components/app_context.js";
import froca from "./froca.js";
import options from "./options.js";
import protectedSessionHolder from "./protected_session_holder.js";
import server from "./server.js";
import toastService from "./toast.js";
import type { ToastOptionsWithRequiredId } from "./toast.js";
import utils from "./utils.js";

let protectedSession: typeof import("./protected_session.js").default;

function dispatch(message: any) {
    // Both handlers are invoked for every message in production.
    return Promise.all(messageHandlers.map((h) => h(message as WebSocketMessage)));
}

beforeAll(async () => {
    protectedSession = (await import("./protected_session.js")).default;
});

beforeEach(() => {
    vi.restoreAllMocks();
    glob.isProtectedSessionAvailable = false;
});

describe("enterProtectedSession", () => {
    it("triggers showPasswordNotSet and returns a deferred when no password is set", () => {
        options.is = vi.fn(() => false) as typeof options.is;
        const triggerCommand = vi.spyOn(appContext, "triggerCommand").mockReturnValue(undefined as any);

        const result = protectedSession.enterProtectedSession();

        expect(options.is).toHaveBeenCalledWith("isPasswordSet");
        expect(triggerCommand).toHaveBeenCalledWith("showPasswordNotSet");
        // returns the RAW deferred (not dfd.promise()) in this branch: a jQuery
        // Deferred is externally resolvable, so it exposes `.resolve`, whereas a
        // `.promise()` object does not. `.promise` exists on both, so it cannot
        // distinguish the two branches.
        expect(typeof (result as any).resolve).toBe("function");
        expect(typeof (result as any).promise).toBe("function");
    });

    it("resolves false immediately when a protected session is already available", async () => {
        options.is = vi.fn(() => true) as typeof options.is;
        protectedSessionHolder.isProtectedSessionAvailable = vi.fn(() => true);
        const triggerCommand = vi.spyOn(appContext, "triggerCommand").mockReturnValue(undefined as any);

        const result = await protectedSession.enterProtectedSession();

        expect(result).toBe(false);
        expect(triggerCommand).not.toHaveBeenCalledWith("showProtectedSessionPasswordDialog");
    });

    it("shows the password dialog and keeps the deferred pending when no session is available", () => {
        options.is = vi.fn(() => true) as typeof options.is;
        protectedSessionHolder.isProtectedSessionAvailable = vi.fn(() => false);
        const triggerCommand = vi.spyOn(appContext, "triggerCommand").mockReturnValue(undefined as any);

        let settled = false;
        const promise = protectedSession.enterProtectedSession() as unknown as Promise<boolean>;
        promise.then(() => {
            settled = true;
        });

        expect(triggerCommand).toHaveBeenCalledWith("showProtectedSessionPasswordDialog");
        expect(settled).toBe(false);
    });
});

describe("leaveProtectedSession", () => {
    it("resets the protected session when one is available", async () => {
        protectedSessionHolder.isProtectedSessionAvailable = vi.fn(() => true);
        protectedSessionHolder.resetProtectedSession = vi.fn(async () => {});

        await protectedSession.leaveProtectedSession();

        expect(protectedSessionHolder.resetProtectedSession).toHaveBeenCalled();
    });

    it("does nothing when no protected session is available", async () => {
        protectedSessionHolder.isProtectedSessionAvailable = vi.fn(() => false);
        protectedSessionHolder.resetProtectedSession = vi.fn(async () => {});

        await protectedSession.leaveProtectedSession();

        expect(protectedSessionHolder.resetProtectedSession).not.toHaveBeenCalled();
    });
});

describe("setupProtectedSession", () => {
    it("enables the protected session on a successful login", async () => {
        server.post = vi.fn(async () => ({ success: true })) as typeof server.post;
        protectedSessionHolder.enableProtectedSession = vi.fn();

        await protectedSession.setupProtectedSession("secret");

        expect(server.post).toHaveBeenCalledWith("login/protected", { password: "secret" });
        expect(protectedSessionHolder.enableProtectedSession).toHaveBeenCalled();
    });

    it("shows an error and aborts on a failed login", async () => {
        server.post = vi.fn(async () => ({ success: false })) as typeof server.post;
        protectedSessionHolder.enableProtectedSession = vi.fn();
        const showError = vi.spyOn(toastService, "showError").mockReturnValue(undefined as any);

        await protectedSession.setupProtectedSession("wrong");

        expect(showError).toHaveBeenCalled();
        expect(protectedSessionHolder.enableProtectedSession).not.toHaveBeenCalled();
    });
});

describe("protectNote", () => {
    it("enters the session and PUTs the protect endpoint with subtree flags", async () => {
        options.is = vi.fn(() => true) as typeof options.is;
        protectedSessionHolder.isProtectedSessionAvailable = vi.fn(() => true);
        vi.spyOn(appContext, "triggerCommand").mockReturnValue(undefined as any);
        server.put = vi.fn(async () => ({})) as typeof server.put;

        await protectedSession.protectNote("note123", true, true);
        expect(server.put).toHaveBeenCalledWith("notes/note123/protect/1?subtree=1");

        await protectedSession.protectNote("note456", false, false);
        expect(server.put).toHaveBeenCalledWith("notes/note456/protect/0?subtree=0");
    });
});

describe("protectedSessionLogin / logout ws handler", () => {
    it("reloads data, fires events, resolves a pending deferred, and shows a message on login", async () => {
        // Build a note so reloadData has something to gather/reload.
        const note = froca.notes;
        froca.loadInitialTree = vi.fn(async () => ({}) as any);
        froca.reloadNotes = vi.fn(async () => {});
        const triggerEvent = vi.spyOn(appContext, "triggerEvent").mockResolvedValue(undefined as any);
        const triggerCommand = vi.spyOn(appContext, "triggerCommand").mockReturnValue(undefined as any);
        const showMessage = vi.spyOn(toastService, "showMessage").mockReturnValue(undefined as any);

        // Establish a pending deferred so the resolve branch is exercised.
        options.is = vi.fn(() => true) as typeof options.is;
        protectedSessionHolder.isProtectedSessionAvailable = vi.fn(() => false);
        const pending = protectedSession.enterProtectedSession() as unknown as Promise<boolean>;

        await dispatch({ type: "protectedSessionLogin" });

        expect(froca.loadInitialTree).toHaveBeenCalled();
        expect(froca.reloadNotes).toHaveBeenCalledWith(Object.keys(note));
        expect(triggerEvent).toHaveBeenCalledWith("frocaReloaded", {});
        expect(triggerEvent).toHaveBeenCalledWith("protectedSessionStarted", {});
        expect(triggerCommand).toHaveBeenCalledWith("closeProtectedSessionPasswordDialog");
        expect(showMessage).toHaveBeenCalled();

        // The pending deferred is resolved with true by the login handler.
        await expect(pending).resolves.toBe(true);
    });

    it("handles login when no deferred is pending", async () => {
        froca.loadInitialTree = vi.fn(async () => ({}) as any);
        froca.reloadNotes = vi.fn(async () => {});
        vi.spyOn(appContext, "triggerEvent").mockResolvedValue(undefined as any);
        vi.spyOn(appContext, "triggerCommand").mockReturnValue(undefined as any);
        const showMessage = vi.spyOn(toastService, "showMessage").mockReturnValue(undefined as any);

        await dispatch({ type: "protectedSessionLogin" });

        expect(showMessage).toHaveBeenCalled();
    });

    it("reloads the frontend app on logout", async () => {
        const reload = vi.spyOn(utils, "reloadFrontendApp").mockReturnValue(undefined as any);

        await dispatch({ type: "protectedSessionLogout" });

        expect(reload).toHaveBeenCalledWith("Protected session logout");
    });

    it("ignores unrelated message types", async () => {
        froca.loadInitialTree = vi.fn(async () => ({}) as any);
        const reload = vi.spyOn(utils, "reloadFrontendApp").mockReturnValue(undefined as any);

        await dispatch({ type: "somethingElse" });

        expect(froca.loadInitialTree).not.toHaveBeenCalled();
        expect(reload).not.toHaveBeenCalled();
    });
});

describe("protectNotes task ws handler", () => {
    it("ignores messages without the protectNotes taskType", async () => {
        const showError = vi.spyOn(toastService, "showError").mockReturnValue(undefined as any);
        const showPersistent = vi.spyOn(toastService, "showPersistent").mockReturnValue(undefined as any);

        await dispatch({ type: "taskError", taskType: "exportNotes", taskId: "t1", message: "x" });
        await dispatch({ type: "taskError", taskId: "t1", message: "x" });

        expect(showError).not.toHaveBeenCalled();
        expect(showPersistent).not.toHaveBeenCalled();
    });

    it("closes the persistent toast and shows an error on taskError (protecting)", async () => {
        const closePersistent = vi.spyOn(toastService, "closePersistent").mockReturnValue(undefined as any);
        const showError = vi.spyOn(toastService, "showError").mockReturnValue(undefined as any);

        await dispatch({
            type: "taskError",
            taskType: "protectNotes",
            taskId: "task-err",
            message: "boom",
            data: { protect: true }
        });

        expect(closePersistent).toHaveBeenCalledWith("task-err");
        expect(showError).toHaveBeenCalledWith("boom");
    });

    it("shows a persistent progress toast while protecting", async () => {
        const showPersistent = vi.spyOn(toastService, "showPersistent").mockReturnValue(undefined as any);

        await dispatch({
            type: "taskProgressCount",
            taskType: "protectNotes",
            taskId: "task-prot",
            progressCount: 5,
            data: { protect: true }
        });

        // Beyond id/icon, the toast must carry the interpolated progress text
        // (protecting key + the progressCount) and the protecting title. The
        // mocked `t` serializes the selected KEY and `count`, so we assert
        // structure/args, never a translated string.
        const toast = showPersistent.mock.calls[0][0] as ToastOptionsWithRequiredId;
        expect(showPersistent).toHaveBeenCalledWith(
            expect.objectContaining({
                id: "task-prot",
                icon: "check-shield",
                message: "protected_session.protecting-in-progress:count=5",
                title: "protected_session.protecting-title"
            })
        );
        // The progressCount must be interpolated into the message.
        expect(toast.message).toContain("count=5");
    });

    it("shows a persistent progress toast while unprotecting", async () => {
        const showPersistent = vi.spyOn(toastService, "showPersistent").mockReturnValue(undefined as any);

        await dispatch({
            type: "taskProgressCount",
            taskType: "protectNotes",
            taskId: "task-unprot",
            progressCount: 2,
            data: { protect: false }
        });

        const toast = showPersistent.mock.calls[0][0] as ToastOptionsWithRequiredId;
        expect(showPersistent).toHaveBeenCalledWith(
            expect.objectContaining({
                id: "task-unprot",
                icon: "shield",
                message: "protected_session.unprotecting-in-progress-count:count=2",
                title: "protected_session.unprotecting-title"
            })
        );
        expect(toast.message).toContain("count=2");
    });

    it("uses distinct progress text for the protecting vs unprotecting branch", async () => {
        // Drive both branches within one test so the assertion is self-contained
        // and not dependent on sibling-test ordering. The protect/unprotect ternary
        // (source line 122) must select different text for each.
        const showPersistent = vi.spyOn(toastService, "showPersistent").mockReturnValue(undefined as any);

        await dispatch({
            type: "taskProgressCount",
            taskType: "protectNotes",
            taskId: "task-prot-text",
            progressCount: 5,
            data: { protect: true }
        });
        await dispatch({
            type: "taskProgressCount",
            taskType: "protectNotes",
            taskId: "task-unprot-text",
            progressCount: 5,
            data: { protect: false }
        });

        const protectingToast = showPersistent.mock.calls[0][0] as ToastOptionsWithRequiredId;
        const unprotectingToast = showPersistent.mock.calls[1][0] as ToastOptionsWithRequiredId;
        // Same progressCount, opposite protect flag => the message/title text must
        // diverge (different translation keys are selected per branch).
        expect(protectingToast.message).not.toBe(unprotectingToast.message);
        expect(protectingToast.title).not.toBe(unprotectingToast.title);
    });

    it("shows a timed success toast on taskSucceeded for both protecting and unprotecting", async () => {
        const showPersistent = vi.spyOn(toastService, "showPersistent").mockReturnValue(undefined as any);

        await dispatch({
            type: "taskSucceeded",
            taskType: "protectNotes",
            taskId: "task-done",
            data: { protect: false }
        });
        expect(showPersistent).toHaveBeenCalledWith(
            expect.objectContaining({ id: "task-done", icon: "shield", timeout: 3000 })
        );

        // Protecting variant exercises the truthy side of the success-text ternary.
        await dispatch({
            type: "taskSucceeded",
            taskType: "protectNotes",
            taskId: "task-done-prot",
            data: { protect: true }
        });
        expect(showPersistent).toHaveBeenCalledWith(
            expect.objectContaining({ id: "task-done-prot", icon: "check-shield", timeout: 3000 })
        );
    });

    it("does nothing for a protectNotes message with an unrelated type", async () => {
        const closePersistent = vi.spyOn(toastService, "closePersistent").mockReturnValue(undefined as any);
        const showError = vi.spyOn(toastService, "showError").mockReturnValue(undefined as any);
        const showPersistent = vi.spyOn(toastService, "showPersistent").mockReturnValue(undefined as any);

        // taskType matches but the message type is none of error/progress/succeeded:
        // falls through all branches without producing a toast.
        await dispatch({
            type: "taskProgress",
            taskType: "protectNotes",
            taskId: "task-other",
            data: { protect: true }
        });

        expect(closePersistent).not.toHaveBeenCalled();
        expect(showError).not.toHaveBeenCalled();
        expect(showPersistent).not.toHaveBeenCalled();
    });

    it("treats a message with no data as unprotecting (undefined protect) on taskError", async () => {
        const closePersistent = vi.spyOn(toastService, "closePersistent").mockReturnValue(undefined as any);
        const showError = vi.spyOn(toastService, "showError").mockReturnValue(undefined as any);

        // No `data`: message.data?.protect short-circuits to undefined (falsy),
        // selecting the unprotecting title. taskError never calls makeToast, so
        // the missing `data` is safe here.
        await dispatch({
            type: "taskError",
            taskType: "protectNotes",
            taskId: "task-nodata",
            message: "no data"
        });

        expect(closePersistent).toHaveBeenCalledWith("task-nodata");
        expect(showError).toHaveBeenCalledWith("no data");
    });
});
