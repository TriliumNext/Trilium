import { beforeEach, describe, expect, it, vi } from "vitest";

import becca from "../becca/becca.js";
import { buildNote } from "../test/becca_easy_mocking.js";
import BackendScriptApi from "./backend_script_api.js";
import ws from "./ws.js";

describe("BackendScriptApi.log", () => {
    beforeEach(() => {
        becca.reset();
        vi.spyOn(ws, "sendMessageToAllClients").mockImplementation(() => {}).mockClear();
    });

    it("sends the plain message string over the websocket", async () => {
        const startNote = buildNote({
            type: "code",
            mime: "application/javascript;env=backend",
            content: ""
        });

        const api = new BackendScriptApi(startNote, { startNote });
        api.log("Hello world quickie.");

        await api.logSpacedUpdates[startNote.noteId].updateNowIfNecessary();

        expect(ws.sendMessageToAllClients).toHaveBeenCalledWith(
            expect.objectContaining({
                type: "api-log-messages",
                noteId: startNote.noteId,
                messages: ["Hello world quickie."]
            })
        );
    });
});

describe("BackendScriptApi.transactional", () => {
    beforeEach(() => becca.reset());

    it("runs the callback inside a transaction and returns its result", () => {
        const startNote = buildNote({ type: "code", mime: "application/javascript;env=backend", content: "" });
        const api = new BackendScriptApi(startNote, { startNote });

        let executed = false;
        const result = api.transactional(() => {
            executed = true;
            return 42;
        });

        expect(executed).toBe(true);
        expect(result).toBe(42);
    });
});

describe("BackendScriptApi markdown conversion", () => {
    beforeEach(() => becca.reset());

    function makeApi() {
        const startNote = buildNote({ type: "code", mime: "application/javascript;env=backend", content: "" });
        return new BackendScriptApi(startNote, { startNote });
    }

    it("htmlToMarkdown converts HTML to Markdown", () => {
        expect(makeApi().htmlToMarkdown("<p>This is <strong>bold</strong>.</p>")).toBe("This is **bold**.");
    });

    it("markdownToHtml converts Markdown to HTML", () => {
        expect(makeApi().markdownToHtml("This is **bold**.")).toContain("<strong>bold</strong>");
    });
});
