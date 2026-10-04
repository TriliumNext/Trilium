import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
    post: vi.fn<(url: string) => Promise<unknown>>(),
    // app_context is pulled in at module scope and asks for the keyboard actions as it loads, so
    // replacing the server module has to answer that too.
    get: vi.fn<(url: string) => Promise<unknown>>(
        async (url) => (url === "keyboard-actions" ? [] : {})),
    showErrorForScriptNote: vi.fn()
}));

vi.mock("./server.js", () => ({
    default: { postWithSilentInternalServerError: mocks.post, get: mocks.get }
}));
vi.mock("./toast.js", () => ({
    default: { showPersistent: vi.fn(), showMessage: vi.fn() },
    showErrorForScriptNote: mocks.showErrorForScriptNote
}));

import { readScriptFailure, runBackendScript } from "./backend_scripting.js";

/** How the server's answer reaches the client: the response body, not an Error. */
const responseBody = (failure: { message: string; noteId?: string }) => JSON.stringify(failure);

describe("readScriptFailure", () => {
    it("takes the parts the server answered with", () => {
        expect(readScriptFailure(responseBody({ message: "boom", noteId: "child1" })))
            .toEqual({ message: "boom", noteId: "child1" });
    });

    it("answers nothing for a response that is not a script failure", () => {
        expect(readScriptFailure(responseBody({ message: "Note 'x' doesn't exist." }))).toBeUndefined();
        expect(readScriptFailure("not json at all")).toBeUndefined();
        expect(readScriptFailure(new Error("thrown"))).toBeUndefined();
        expect(readScriptFailure(undefined)).toBeUndefined();
    });
});

describe("runBackendScript", () => {
    beforeEach(() => {
        mocks.post.mockReset();
        mocks.showErrorForScriptNote.mockReset();
    });

    it("says nothing when the script runs", async () => {
        mocks.post.mockResolvedValue(undefined);

        await runBackendScript("note1");

        expect(mocks.post).toHaveBeenCalledWith("script/run/note1");
        expect(mocks.showErrorForScriptNote).not.toHaveBeenCalled();
    });

    it("reports a failure against the note, and still lets the caller know", async () => {
        mocks.post.mockRejectedValue(responseBody({
            message: "Module 'axioss' could not be loaded.",
            noteId: "Qp58WenrLLwg"
        }));

        await expect(runBackendScript("Qp58WenrLLwg")).rejects.toBeDefined();

        expect(mocks.showErrorForScriptNote).toHaveBeenCalledWith(
            "Qp58WenrLLwg", "Module 'axioss' could not be loaded.", { monospace: true });
    });

    it("points at the child module note that failed, not the one that was run", async () => {
        mocks.post.mockRejectedValue(responseBody({ message: "boom", noteId: "childModule" }));

        await expect(runBackendScript("parentScript")).rejects.toBeDefined();

        expect(mocks.showErrorForScriptNote).toHaveBeenCalledWith(
            "childModule", "boom", { monospace: true });
    });

    // `server.ts` has already reported a failure that is not the route's script failure, such as a
    // 404 for a deleted note or a dropped connection.
    it("adds no scripting error to a failure the request reported itself", async () => {
        mocks.post.mockRejectedValue(responseBody({ message: "Note 'gone' doesn't exist." }));

        await expect(runBackendScript("gone")).rejects.toBeDefined();

        expect(mocks.showErrorForScriptNote).not.toHaveBeenCalled();
    });

    // A 500 is silenced for this request, so a body that is not Trilium's own reaches no other toast.
    it("reports a failure that is not Trilium's against the note that was run", async () => {
        mocks.post.mockRejectedValue("<html>Internal Server Error</html>");

        await expect(runBackendScript("note1")).rejects.toBeDefined();

        expect(mocks.showErrorForScriptNote).toHaveBeenCalledWith(
            "note1", "<html>Internal Server Error</html>", { monospace: true });
    });
});
