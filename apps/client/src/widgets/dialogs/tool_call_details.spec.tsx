import { act } from "preact/test-utils";
import { beforeEach, describe, expect, it, vi } from "vitest";

import Component from "../../components/component";
import { renderInto } from "../../test/render";
import type { ToolCall } from "../type_widgets/llm_chat/llm_chat_types";
import { ParentComponent } from "../react/react_utils";
import ToolCallDetailsDialog from "./tool_call_details";

vi.mock("../../services/i18n", () => ({
    t: (key: string, options?: { defaultValue?: string }) => (key.startsWith("llm.tools.") ? options?.defaultValue ?? key : key)
}));
vi.mock("../../services/syntax_highlight", () => ({
    applySingleBlockSyntaxHighlight: vi.fn(),
    isSyntaxHighlightEnabled: () => false
}));

async function open(toolCall: ToolCall) {
    const host = new Component();
    renderInto(
        <ParentComponent.Provider value={host}>
            <ToolCallDetailsDialog />
        </ParentComponent.Provider>
    );
    await act(async () => {
        await host.handleEvent("showToolCallDetails", { toolCall });
    });
}

function sections() {
    return [ ...document.querySelectorAll(".tool-call-details-dialog .tool-call-details-section") ].map(section => ({
        heading: section.querySelector("h6")?.textContent,
        code: section.querySelector("code")?.textContent,
        empty: section.querySelector(".tool-call-details-empty")?.textContent
    }));
}

describe("ToolCallDetailsDialog", () => {
    beforeEach(() => {
        document.body.innerHTML = "";
    });

    it("shows the input and a JSON result pretty-printed, and a plain result as it is", async () => {
        await open({ id: "1", toolName: "get_note", input: { noteId: "a" }, result: "{\"title\":\"A\"}" });
        expect(document.querySelector(".tool-call-details-dialog .modal-title")?.textContent).toContain("get_note");
        expect(sections()).toEqual([
            { heading: "llm_chat.input", code: "{\n  \"noteId\": \"a\"\n}", empty: undefined },
            { heading: "llm_chat.result", code: "{\n  \"title\": \"A\"\n}", empty: undefined }
        ]);

        document.body.innerHTML = "";
        await open({ id: "2", toolName: "web_search", input: { query: "rocket" }, result: "Sunny", isError: true });
        expect(sections()[1]).toEqual({ heading: "llm_chat.error", code: "Sunny", empty: undefined });
    });

    it("shows the partial input of a call still streaming as it is, and says it has no result yet", async () => {
        await open({ id: "1", toolName: "read_web_page", input: {}, inputStreaming: "{\"url\":\"https://tri" });
        expect(sections()).toEqual([
            { heading: "llm_chat.input", code: "{\"url\":\"https://tri", empty: undefined },
            { heading: "llm_chat.result", code: undefined, empty: "llm_chat.tool_call_no_result" }
        ]);
    });
});
