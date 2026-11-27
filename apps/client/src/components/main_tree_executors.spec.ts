import { beforeEach, describe, expect, it, vi } from "vitest";

import options from "../services/options.js";
import protectedSession from "../services/protected_session.js";
import protectedSessionHolder from "../services/protected_session_holder.js";
import MainTreeExecutors from "./main_tree_executors.js";

describe("protecting and unprotecting a subtree", () => {
    let executor: MainTreeExecutors;
    let triggerCommand: ReturnType<typeof vi.spyOn>;
    let protectNote: ReturnType<typeof vi.spyOn>;
    let sessionAvailable: boolean;

    beforeEach(() => {
        vi.restoreAllMocks();
        executor = new MainTreeExecutors();
        triggerCommand = vi.spyOn(executor, "triggerCommand").mockReturnValue(undefined);
        protectNote = vi.spyOn(protectedSession, "protectNote").mockResolvedValue(undefined);
        vi.spyOn(options, "is").mockImplementation((name) => name === "isPasswordSet");
        sessionAvailable = false;
        vi.spyOn(protectedSessionHolder, "isProtectedSessionAvailable").mockImplementation(() => sessionAvailable);
    });

    it("always confirms unprotecting, even inside a protected session", () => {
        for (const available of [ false, true ]) {
            sessionAvailable = available;
            executor.unprotectSubtreeCommand({ noteId: "journal", selectedOrActiveBranchIds: [] });
        }

        expect(protectNote).not.toHaveBeenCalled();
        expect(triggerCommand).toHaveBeenCalledTimes(2);
        expect(triggerCommand).toHaveBeenNthCalledWith(1, "showProtectSubtreeDialog", { noteId: "journal", protect: false });
        expect(triggerCommand).toHaveBeenNthCalledWith(2, "showProtectSubtreeDialog", { noteId: "journal", protect: false });
    });

    it("protects at once inside a protected session, and asks for the password outside one", () => {
        executor.protectSubtreeCommand({ noteId: "drafts", selectedOrActiveBranchIds: [] });
        expect(triggerCommand).toHaveBeenCalledExactlyOnceWith("showProtectSubtreeDialog", { noteId: "drafts", protect: true });
        expect(protectNote).not.toHaveBeenCalled();

        sessionAvailable = true;
        executor.protectSubtreeCommand({ noteId: "drafts", selectedOrActiveBranchIds: [] });
        expect(protectNote).toHaveBeenCalledExactlyOnceWith("drafts", true, true);
        expect(triggerCommand).toHaveBeenCalledOnce();
    });

    it("points to setting a password when none is set", () => {
        vi.spyOn(options, "is").mockReturnValue(false);

        executor.unprotectSubtreeCommand({ noteId: "journal", selectedOrActiveBranchIds: [] });
        executor.protectSubtreeCommand({ noteId: "drafts", selectedOrActiveBranchIds: [] });

        expect(triggerCommand).toHaveBeenCalledTimes(2);
        expect(triggerCommand).toHaveBeenCalledWith("showPasswordNotSet");
        expect(triggerCommand).not.toHaveBeenCalledWith("showProtectSubtreeDialog", expect.anything());
    });
});
