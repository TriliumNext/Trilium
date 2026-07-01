import { beforeEach, describe, expect, it, vi } from "vitest";

import { getBecca } from "../becca/becca.js";
import { buildNote } from "../test/becca_easy_mocking.js";
import BackendScriptApi from "./backend_script_api.js";
import ws from "./ws.js";

describe("BackendScriptApi.log", () => {
    beforeEach(() => {
        getBecca().reset();
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

describe("BackendScriptApi markdown conversion", () => {
    beforeEach(() => getBecca().reset());

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
