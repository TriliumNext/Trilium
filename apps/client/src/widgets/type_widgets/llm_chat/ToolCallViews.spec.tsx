import { describe, expect, it, vi } from "vitest";

vi.mock("../../../services/i18n.js", () => ({
    t: (key: string, options?: Record<string, unknown>) => (options ? `${key}${JSON.stringify(options)}` : key)
}));

import type { ToolCall } from "./llm_chat_types.js";
import { getToolCallView, markdownToPlainPreview } from "./ToolCallViews.js";

function call(toolName: string, result: string | undefined, input: Record<string, unknown> = {}): ToolCall {
    return { id: "1", toolName, input, result };
}

describe("getToolCallView", () => {
    it("falls back to the bare line for a result or input it cannot read", () => {
        const unreadable: ToolCall[] = [
            call("create_note", undefined, { type: 1, content: "x" }),
            call("set_note_content", undefined, { noteId: "n1", content: "  " }),
            call("append_to_note", undefined, { noteId: 1, content: "x" }),
            call("set_attribute", "not json", { type: "label" }),
            call("get_attributes", "{}"),
            call("get_attribute", "{\"type\":\"label\"}"),
            call("delete_attribute", "not json"),
            call("search_notes", "{\"totalResults\":\"many\",\"results\":[]}"),
            call("search_notes", "null"),
            call("search_help", "not json"),
            call("search_icons", "{\"totalResults\":1}"),
            call("get_help_toc", "{\"toc\":1}"),
            call("web_search", "[]"),
            call("read_web_page", "{\"status\":\"ok\"}"),
            call("read_web_page", "[12KB - too large to preview]"),
            call("get_child_notes", "not json"),
            call("get_child_notes", "{}"),
            call("rename_note", "{}"),
            call("get_attachment", "{\"title\":\"a.png\"}"),
            call("get_attachment_content", "{}"),
            call("get_note", "not json"),
            call("get_note_content", "not json"),
            call("get_subtree", "not json"),
            call("get_subtree", "[]"),
            call("unknown_tool", "{}")
        ];
        expect(unreadable.map(tc => [ tc.toolName, getToolCallView(tc) ])).toEqual(unreadable.map(tc => [ tc.toolName, null ]));
    });

    it("counts what a result lists when it gives no count of its own, and leaves out an empty body", () => {
        const toc = getToolCallView(call("get_help_toc", JSON.stringify({ toc: "Basics (_help_a)\nNotes (_help_b)" })));
        expect(toc?.summary).toBe("llm_chat.search_help_count{\"count\":2}");

        const subtree = getToolCallView(call("get_subtree", JSON.stringify({ noteId: "root" })));
        expect(subtree).toEqual({ summary: "llm_chat.search_notes_count{\"count\":0}", body: undefined });

        const attachment = getToolCallView(call("get_attachment", JSON.stringify({ title: "a.png", ownerId: "n1" })));
        expect(attachment?.lead).toBeDefined();
        expect(attachment?.summary).toBeUndefined();

        expect(getToolCallView(call("get_attributes", "[]"))?.body).toBeUndefined();
        expect(getToolCallView(call("search_help", JSON.stringify({ totalResults: 0, results: [] })))?.body).toBeUndefined();
        expect(getToolCallView(call("search_icons", JSON.stringify({ totalResults: 0, results: [] })))?.body).toBeUndefined();
        expect(getToolCallView(call("get_child_notes", "[]"))?.body).toBeUndefined();
    });
});

describe("markdownToPlainPreview", () => {
    it("decodes numeric and named entities, and keeps the ones it cannot", () => {
        expect(markdownToPlainPreview("&#65;&#x42;&#X43; &AMP; &#99999999; &bogus;")).toBe("ABC & &#99999999; &bogus;");
    });

    it("strips a tag that removing another one leaves behind", () => {
        expect(markdownToPlainPreview("<<b>script>alert(1)<</b>/script>")).toBe("alert(1)");
    });

    it("drops the separator row of a table, whatever its alignment, spacing or line ending", () => {
        const rows = [
            ["| a | b |", "| --- | --- |", "| 1 | 2 |"],
            ["| a | b |", "| :--- | ---: |", "| 1 | 2 |"],
            ["| a | b |", "|:-:|:-:|", "| 1 | 2 |"],
            ["a | b", "- | -", "1 | 2"],
            ["| a | b |", "  |  ---  |  ---  |  ", "| 1 | 2 |"],
            ["| a | b |", "|\u00a0---\u00a0|\t---\t|", "| 1 | 2 |"]
        ];
        for (const [header, separator, body] of rows) {
            for (const eol of ["\n", "\r\n"]) {
                const table = [header, separator, body].join(eol) + eol;
                expect(markdownToPlainPreview(table)).toBe("a b 1 2");
            }
        }
    });

    it("keeps a row that only looks like a separator because of its text", () => {
        expect(markdownToPlainPreview("| --- |\n| - x - |")).toBe("- x -");
    });

    it("reads a run of whitespace in linear time", () => {
        // The elapsed time of `calls` runs of the preview over `size` characters, per run.
        const perCall = (size: number) => {
            const input = `${" ".repeat(size)}x`;
            let best = Infinity;
            for (let attempt = 0; attempt < 3; attempt++) {
                let calls = 0;
                const start = performance.now();
                do {
                    markdownToPlainPreview(input);
                    calls++;
                } while (performance.now() - start < 5);
                best = Math.min(best, (performance.now() - start) / calls);
            }
            return best;
        };

        // A line of N spaces is cubic in N when the separator pattern backtracks, so 4x the size
        // costs about 64x the time; a linear pass costs about 4x. The bound sits between the two.
        // The ratio is of two timings taken the same way, so the speed of the machine cancels out.
        // The check runs first because on the cubic pattern the 50k input below does not finish.
        expect(perCall(2000) / perCall(500)).toBeLessThan(12);

        expect(markdownToPlainPreview(`${" ".repeat(50000)}x`)).toBe("x");
        expect(markdownToPlainPreview(" \n".repeat(25000) + "x")).toBe("x");
    });
});
