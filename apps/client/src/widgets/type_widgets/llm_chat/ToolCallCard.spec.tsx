import { render } from "preact";
import { act } from "preact/test-utils";
import { afterEach, describe, expect, it, vi } from "vitest";

vi.mock("../../../services/i18n.js", () => ({
    t: (key: string, options?: { defaultValue?: string }) => {
        if (key.startsWith("llm.tools.")) return key.slice("llm.tools.".length);
        return options?.defaultValue ?? (options ? `${key}${JSON.stringify(options)}` : key);
    }
}));
vi.mock("react-i18next", () => ({
    Trans: ({ i18nKey, components }: { i18nKey: string; components: Record<string, preact.ComponentChildren> }) =>
        <>{i18nKey}{Object.values(components)}</>
}));
const mocks = vi.hoisted(() => ({
    triggerEvent: vi.fn(),
    openInAppHelpFromUrl: vi.fn(),
    notes: {} as Record<string, { type: string; mime: string }>
}));
vi.mock("../../../components/app_context.js", () => ({ default: { triggerEvent: mocks.triggerEvent } }));
vi.mock("../../../services/utils.js", async (importOriginal) => ({
    ...(await importOriginal<typeof import("../../../services/utils.js")>()),
    openInAppHelpFromUrl: mocks.openInAppHelpFromUrl
}));
vi.mock("../../react/hooks.js", async (importOriginal) => ({
    ...(await importOriginal<typeof import("../../react/hooks.js")>()),
    useNote: (noteId: string) => mocks.notes[noteId]
}));
vi.mock("../text/ReadOnlyText.js", () => ({
    ReadOnlyTextContent: ({ html }: { html: string }) => <div className="markdown-stub">{html}</div>
}));
vi.mock("../../react/CodeBlock.js", () => ({
    default: ({ code, mimeType }: { code: string; mimeType?: string }) => <pre className="code-block-stub" data-mime={mimeType}>{code}</pre>
}));
vi.mock("../../react/NoteLink.js", () => ({
    NewNoteLink: ({ notePath, onClick }: { notePath: string; onClick?: (e: MouseEvent) => void }) =>
        <a className="note-link-stub" href="#" onClick={onClick}>{notePath}</a>
}));

import ToolCallCard from "./ToolCallCard.js";
import type { ToolCall } from "./llm_chat_types.js";

let host: HTMLElement | undefined;

afterEach(() => {
    mocks.triggerEvent.mockClear();
    mocks.openInAppHelpFromUrl.mockClear();
    if (host) {
        render(null, host);
        host.remove();
        host = undefined;
    }
});

function renderCard(toolCalls: ToolCall[]) {
    host = document.body.appendChild(document.createElement("div"));
    const target = host;
    act(() => render(<ToolCallCard toolCalls={toolCalls} />, target));
    return target;
}

describe("ToolCallCard", () => {
    it("shows what a call looked for: the name, the query, or the page it read", () => {
        const card = renderCard([
            { id: "1", toolName: "search_icons", input: { query: "rocket" }, result: "[]" },
            { id: "2", toolName: "web_search", input: { query: "weather Sibiu" }, result: "Sunny" },
            { id: "3", toolName: "read_web_page", input: { url: "https://triliumnotes.org" }, result: "Fetched" }
        ]);
        expect([ ...card.querySelectorAll(".llm-chat-tool-call-detail") ].map(detail => detail.textContent))
            .toEqual([ "rocket", "weather Sibiu", "https://triliumnotes.org" ]);
    });

    it("lists the calls as bare lines, folding only those with something to show inline", () => {
        const target = renderCard([
            { id: "1", toolName: "get_note", input: { noteId: "a" }, result: "{}" },
            { id: "2", toolName: "get_note", input: { noteId: "b" }, result: "{}" },
            { id: "3", toolName: "web_search", input: { query: "rocket" }, result: "Sunny" }
        ]);
        expect(target.querySelector(".expandable-card")).toBeNull();
        const lines = [ ...(target.querySelector(".llm-chat-tool-calls")?.children ?? []) ];
        expect(lines.map(line => line.classList.contains("llm-chat-tool-call"))).toEqual([ true, true ]);
        expect(lines.map(line => line instanceof HTMLDetailsElement)).toEqual([ true, false ]);
        const grouped = lines[0]?.querySelectorAll(".expandable-section-body > .llm-chat-tool-call");
        expect([ ...(grouped ?? []) ].map(line => line instanceof HTMLDetailsElement)).toEqual([ false, false ]);
        expect(target.textContent).not.toContain("Sunny");
    });

    it("opens the input and result of a call in a dialog", () => {
        const call: ToolCall = { id: "1", toolName: "web_search", input: { query: "rocket" }, result: "Sunny" };
        const target = renderCard([ call ]);
        const button = target.querySelector<HTMLButtonElement>(".llm-chat-tool-call-debug");
        expect(button).not.toBeNull();
        act(() => button?.click());
        expect(mocks.triggerEvent).toHaveBeenCalledExactlyOnceWith("showToolCallDetails", { toolCall: call });
    });

    it("shows why a call failed inline, and opening the dialog leaves the line folded", () => {
        const target = renderCard([ {
            id: "1",
            toolName: "get_note",
            input: { noteId: "a" },
            result: JSON.stringify({ error: "Note not found" }),
            isError: true
        } ]);
        const line = target.querySelector("details.llm-chat-tool-call");
        expect(line?.querySelector(".llm-chat-tool-call-error-message")?.textContent).toBe("Note not found");

        act(() => line?.querySelector<HTMLButtonElement>(".llm-chat-tool-call-debug")?.click());
        expect(mocks.triggerEvent).toHaveBeenCalledOnce();
        expect((line as HTMLDetailsElement | null)?.open).toBe(false);
    });

    it("lists the notes a search found, with their parents and a plain preview", () => {
        const target = renderCard([ {
            id: "1",
            toolName: "search_notes",
            input: { query: "rocket", limit: 2 },
            result: JSON.stringify({
                totalResults: 42,
                results: [
                    { noteId: "a", title: "Apollo", type: "text", parentTitle: "Space", contentPreview: "## Launch\n\nThe **Saturn V** [rocket](https://x.org)" },
                    { noteId: "b", title: "Big", type: "text", parentTitle: null, contentPreview: "[12KB - use get_note_content for full text]" }
                ]
            })
        } ]);
        const line = target.querySelector("details.llm-chat-tool-call");
        expect(line?.querySelector(".llm-chat-tool-call-result-count")?.textContent).toBe("llm_chat.search_notes_count{\"count\":42}");

        const rows = [ ...(line?.querySelectorAll(".llm-chat-note-result") ?? []) ];
        expect(rows.map(row => ({
            note: row.querySelector(".note-link-stub")?.textContent,
            parent: row.querySelector(".llm-chat-note-result-parent")?.textContent ?? null,
            preview: row.querySelector(".llm-chat-note-result-preview")?.textContent ?? null
        }))).toEqual([
            { note: "a", parent: "Space", preview: "Launch The Saturn V rocket" },
            { note: "b", parent: null, preview: null }
        ]);
        expect(line?.querySelector(".llm-chat-note-results-scope")).toBeNull();
        expect(line?.querySelector(".llm-chat-note-results-more")?.textContent)
            .toBe("llm_chat.search_notes_limited{\"count\":42,\"limit\":2}");
    });

    it("names the subtree a search was confined to, even when it found nothing there", () => {
        const target = renderCard([
            {
                id: "1",
                toolName: "search_notes",
                input: { query: "a", ancestorNoteId: "scope" },
                result: JSON.stringify({ totalResults: 12, results: [ { noteId: "a" } ] })
            },
            {
                id: "2",
                toolName: "search_notes",
                input: { query: "b", ancestorNoteId: "scope" },
                result: JSON.stringify({ totalResults: 0, results: [] })
            }
        ]);
        const lines = [ ...(target.querySelector(".llm-chat-tool-calls")?.children ?? []) ];
        expect(lines.map(line => line instanceof HTMLDetailsElement)).toEqual([ true ]);
        const groupedLines = [ ...(lines[0]?.querySelectorAll(".expandable-section-body > .llm-chat-tool-call") ?? []) ];
        expect(groupedLines.map(line => line instanceof HTMLDetailsElement)).toEqual([ true, true ]);
        expect(groupedLines.map(line => line.querySelector(".llm-chat-note-results-scope .note-link-stub")?.textContent))
            .toEqual([ "scope", "scope" ]);
        expect(groupedLines[0]?.querySelector(".llm-chat-note-results-more")?.textContent)
            .toBe("llm_chat.search_notes_limited{\"count\":12,\"limit\":1}");
    });

    it("keeps a search that found nothing, or returned something unexpected, to a plain line", () => {
        const target = renderCard([
            { id: "1", toolName: "search_notes", input: { query: "a", ancestorNoteId: "root" }, result: JSON.stringify({ totalResults: 0, results: [] }) },
            { id: "2", toolName: "get_note", input: { noteId: "x" }, result: "{}" },
            { id: "3", toolName: "search_notes", input: { query: "b" }, result: "not json" }
        ]);
        const lines = [ ...(target.querySelector(".llm-chat-tool-calls")?.children ?? []) ];
        expect(lines.map(line => line instanceof HTMLDetailsElement)).toEqual([ false, false, false ]);
        expect(lines[0]?.querySelector(".llm-chat-tool-call-result-count")?.textContent).toBe("llm_chat.search_notes_count{\"count\":0}");
        expect(target.querySelector(".llm-chat-note-result")).toBeNull();
    });

    it("lists the children a call read, each with how many children it has", () => {
        const target = renderCard([
            {
                id: "1",
                toolName: "get_child_notes",
                input: { noteId: "parent" },
                result: JSON.stringify([
                    { noteId: "a", title: "Alpha", type: "text", childCount: 3 },
                    { noteId: "b", title: "Beta", type: "text", childCount: 0 }
                ])
            },
            { id: "2", toolName: "get_note", input: { noteId: "x" }, result: "{}" },
            { id: "3", toolName: "get_child_notes", input: { noteId: "leaf" }, result: "[]" }
        ]);
        const [ children, , empty ] = [ ...(target.querySelector(".llm-chat-tool-calls")?.children ?? []) ];

        expect(children instanceof HTMLDetailsElement).toBe(true);
        expect(children?.querySelector(".llm-chat-tool-call-note-ref .note-link-stub")?.textContent).toBe("parent");
        expect(children?.querySelector(".llm-chat-tool-call-result-count")?.textContent)
            .toBe("llm_chat.child_notes_count{\"count\":2}");
        const rows = [ ...(children?.querySelectorAll(".llm-chat-note-result") ?? []) ];
        expect(rows.map(row => ({
            note: row.querySelector(".note-link-stub")?.textContent,
            detail: row.querySelector(".llm-chat-note-result-detail")?.textContent ?? null
        }))).toEqual([
            { note: "a", detail: "llm_chat.child_count{\"count\":3}" },
            { note: "b", detail: null }
        ]);

        expect(empty instanceof HTMLDetailsElement).toBe(false);
        expect(empty?.querySelector(".llm-chat-tool-call-result-count")?.textContent)
            .toBe("llm_chat.child_notes_count{\"count\":0}");
    });

    it("lists the User Guide pages a help search found, opening each as contextual help", () => {
        const target = renderCard([ {
            id: "1",
            toolName: "search_help",
            input: { query: "clone", limit: 2 },
            result: JSON.stringify({
                totalResults: 5,
                results: [
                    {
                        noteId: "_help_abc",
                        title: "Cloning",
                        path: "Basic Concepts > Notes",
                        contentPreview: "**Clones** share&nbsp;<a class=\"reference-link\" href=\"#root/x\">a note</a>: <kbd>Ctrl</kbd>+<kbd>C</kbd> <span class=\"tn-icon bx bx-copy\"></span>&amp; 1 < 2"
                    },
                    { noteId: "_help_def", title: "Tree", path: "", contentPreview: null }
                ]
            })
        } ]);
        const line = target.querySelector("details.llm-chat-tool-call");
        expect(line?.querySelector(".llm-chat-tool-call-result-count")?.textContent)
            .toBe("llm_chat.search_help_count{\"count\":5}");

        const rows = [ ...(line?.querySelectorAll(".llm-chat-note-result") ?? []) ];
        expect(rows.map(row => ({
            note: row.querySelector(".note-link-stub")?.textContent,
            path: row.querySelector(".llm-chat-note-result-parent")?.textContent ?? null,
            preview: row.querySelector(".llm-chat-note-result-preview")?.textContent ?? null
        }))).toEqual([
            { note: "_help_abc", path: "Basic Concepts > Notes", preview: "Clones share a note: Ctrl+C & 1 < 2" },
            { note: "_help_def", path: null, preview: null }
        ]);
        expect(line?.querySelector(".llm-chat-note-results-more")?.textContent)
            .toBe("llm_chat.search_notes_limited{\"count\":5,\"limit\":2}");

        const link = rows[0]?.querySelector<HTMLAnchorElement>(".note-link-stub");
        expect(link).not.toBeNull();
        act(() => {
            link?.dispatchEvent(new MouseEvent("click", { bubbles: true, cancelable: true, ctrlKey: true }));
        });
        expect(mocks.openInAppHelpFromUrl).not.toHaveBeenCalled();
        act(() => link?.click());
        expect(mocks.openInAppHelpFromUrl).toHaveBeenCalledExactlyOnceWith("abc");
    });

    it("nests the notes of a subtree, with what the depth and width limits left out", () => {
        const target = renderCard([ {
            id: "1",
            toolName: "get_subtree",
            input: { noteId: "top", depth: 2 },
            result: JSON.stringify({
                noteId: "top", title: "Top", type: "text", children: [
                    { noteId: "a", title: "A", type: "text", children: [
                        { noteId: "a1", title: "A1", type: "text", children: "5 children not shown (depth limit reached)" }
                    ] },
                    { noteId: "b", title: "B", type: "text" },
                    { noteId: "", title: "... and 3 more", type: "truncated" }
                ]
            })
        } ]);
        const line = target.querySelector("details.llm-chat-tool-call");
        expect(line?.querySelector(".llm-chat-tool-call-result-count")?.textContent)
            .toBe("llm_chat.search_notes_count{\"count\":3}");

        const header = (row: Element | null | undefined) => row?.querySelector(":scope > .llm-chat-note-result-header");
        const rows = [ ...(line?.querySelectorAll(".llm-chat-note-result") ?? []) ];
        expect(rows.map(row => ({
            note: header(row)?.querySelector(".note-link-stub")?.textContent,
            detail: header(row)?.querySelector(".llm-chat-note-result-detail")?.textContent ?? null,
            parent: header(row.parentElement?.closest(".llm-chat-note-result"))?.querySelector(".note-link-stub")?.textContent ?? null
        }))).toEqual([
            { note: "a", detail: null, parent: null },
            { note: "a1", detail: "llm_chat.child_count{\"count\":5}", parent: "a" },
            { note: "b", detail: null, parent: null }
        ]);

        const more = line?.querySelector(".llm-chat-note-results-more");
        expect(more?.textContent).toBe("llm_chat.subtree_more{\"count\":3}");
        expect(more?.closest(".llm-chat-note-result")).toBeNull();
    });

    it("shows what a get_note call learned: type, counts, attributes and a preview", () => {
        const target = renderCard([ {
            id: "1",
            toolName: "get_note",
            input: { noteId: "n" },
            result: JSON.stringify({
                noteId: "n",
                title: "N",
                type: "code",
                mime: "text/x-markdown",
                childNotes: { totalCount: 12, results: [] },
                attributes: {
                    totalCount: 5,
                    results: [
                        { type: "label", name: "book", value: "" },
                        { type: "label", name: "status", value: "in progress" },
                        { type: "relation", name: "author", value: "tolkien" },
                        { type: "relation", name: "internalLink", value: "other" }
                    ]
                },
                attachments: { totalCount: 1, results: [] },
                contentPreview: "# Title\n\nSome **text**"
            })
        } ]);
        const card = target.querySelector("details.llm-chat-tool-call .llm-chat-note-card");
        expect(card?.querySelector(".llm-chat-note-card-facts")?.textContent)
            .toBe("note_types.markdown · llm_chat.child_count{\"count\":12} · llm_chat.attachment_count{\"count\":1}");
        expect([ ...(card?.querySelectorAll(".llm-chat-attribute") ?? []) ].map(pill => pill.textContent))
            .toEqual([ "#book", "#status=\"in progress\"", "~author=tolkien" ]);
        expect(card?.querySelector(".llm-chat-attribute .note-link-stub")?.textContent).toBe("tolkien");
        expect(card?.querySelector(".llm-chat-note-card-attributes .llm-chat-note-results-more")?.textContent)
            .toBe("llm_chat.subtree_more{\"count\":1}");
        expect(card?.querySelector(".llm-chat-note-result-preview")?.textContent).toBe("Title Some text");
    });

    it("previews the content a get_note_content call read, and keeps an empty note to a plain line", () => {
        const target = renderCard([
            {
                id: "1",
                toolName: "get_note_content",
                input: { noteId: "n" },
                result: JSON.stringify({ noteId: "n", content: `# Title\n\nSome **text**${" more".repeat(400)}` })
            },
            { id: "2", toolName: "get_note", input: { noteId: "x" }, result: "{}" },
            { id: "3", toolName: "get_note_content", input: { noteId: "e" }, result: JSON.stringify({ noteId: "e", content: "" }) }
        ]);
        const [ read, , empty ] = [ ...(target.querySelector(".llm-chat-tool-calls")?.children ?? []) ];
        const preview = read?.querySelector(".llm-chat-note-card .llm-chat-note-result-preview")?.textContent;
        expect(preview?.startsWith("Title Some text more more")).toBe(true);
        expect(preview?.length).toBeLessThan(1000);
        expect(read?.querySelector(".llm-chat-note-card-facts")).toBeNull();
        expect(empty instanceof HTMLDetailsElement).toBe(false);
    });

    it("shows what a create_note call wrote, by the type of the note, before its result arrives", () => {
        const call = (id: string, type: string, content: string, mime?: string): ToolCall => ({
            id, toolName: "create_note", input: { parentNoteId: "p", title: "T", type, content, mime }
        });
        const target = renderCard([
            { ...call("1", "text", "# Heading\n\nSome **bold**"), result: JSON.stringify({ success: true, noteId: "n", title: "T", type: "text" }) },
            call("2", "code", "const a = 1;", "application/javascript;env=frontend"),
            call("3", "canvas", "{\"elements\":[]}"),
            call("4", "webView", "https://triliumnotes.org"),
            call("5", "search", "#book")
        ]);
        // Consecutive calls to one tool fold into a group, so the calls are the lines inside it.
        const [ text, code, canvas, webView, search ] = [ ...target.querySelectorAll(".expandable-section-body > .llm-chat-tool-call") ];

        expect(text instanceof HTMLDetailsElement).toBe(true);
        expect(text?.querySelector(".llm-chat-written .markdown-stub")?.textContent).toContain("<strong>bold</strong>");
        expect(text?.querySelector(".llm-chat-note-card-facts")).toBeNull();

        const codeBlock = code?.querySelector(".llm-chat-written .code-block-stub");
        expect(code instanceof HTMLDetailsElement).toBe(true);
        expect(codeBlock?.textContent).toBe("const a = 1;");
        expect(codeBlock?.getAttribute("data-mime")).toBe("application/javascript;env=frontend");
        expect(code?.querySelector(".llm-chat-note-card-facts")?.textContent).toBe("note_types.code");

        expect(canvas instanceof HTMLDetailsElement).toBe(false);

        const url = webView?.querySelector<HTMLAnchorElement>(".llm-chat-written a.external");
        expect(url?.getAttribute("href")).toBe("https://triliumnotes.org");

        expect(search?.querySelector(".llm-chat-written .code-block-stub")?.textContent).toBe("#book");
    });

    it("shows what set_note_content and append_to_note wrote, by the type of the note they wrote to", () => {
        mocks.notes = {
            t: { type: "text", mime: "text/html" },
            c: { type: "code", mime: "text/x-python" },
            j: { type: "canvas", mime: "application/json" }
        };
        const target = renderCard([
            { id: "1", toolName: "set_note_content", input: { noteId: "t", content: "Some **bold**" } },
            { id: "2", toolName: "append_to_note", input: { noteId: "c", content: "print(1)" } },
            { id: "3", toolName: "set_note_content", input: { noteId: "j", content: "{\"elements\":[]}" } }
        ]);
        const [ set, append, json ] = [ ...(target.querySelector(".llm-chat-tool-calls")?.children ?? []) ];

        expect(set?.querySelector(".llm-chat-written .markdown-stub")?.textContent).toContain("<strong>bold</strong>");
        expect(set?.querySelector(".llm-chat-written-appended")).toBeNull();

        const codeBlock = append?.querySelector(".llm-chat-written.llm-chat-written-appended .code-block-stub");
        expect(codeBlock?.textContent).toBe("print(1)");
        expect(codeBlock?.getAttribute("data-mime")).toBe("text/x-python");

        expect(json).not.toBeUndefined();
        expect(json?.querySelector(".llm-chat-written")).toBeNull();
    });

    it("shows an edit as blocks with colored edges, rendering Markdown on a Markdown note", () => {
        mocks.notes = {
            m: { type: "code", mime: "text/x-markdown" },
            c: { type: "code", mime: "text/x-python" }
        };
        const edit = (id: string, noteId: string, oldText: string, newText: string): ToolCall => ({
            id, toolName: "edit_note_content", input: { noteId, edits: [ { oldText, newText } ] }
        });
        const target = renderCard([
            edit("1", "m", "a\n**old**\nc", "a\n**new**\nc"),
            { id: "2", toolName: "get_note", input: { noteId: "x" }, result: "{}" },
            edit("3", "c", "x = 1\ny = 2", "x = 1\ny = 3")
        ]);
        const [ markdown, , code ] = [ ...(target.querySelector(".llm-chat-tool-calls")?.children ?? []) ];

        const blocks = [ ...(markdown?.querySelectorAll(".llm-diff-block") ?? []) ];
        expect(blocks.map(block => block.className.replace("llm-diff-block ", ""))).toEqual([
            "llm-diff-block-context", "llm-diff-block-remove", "llm-diff-block-add", "llm-diff-block-context"
        ]);
        expect(blocks[1]?.querySelector(".markdown-stub")?.textContent).toContain("<strong>old</strong>");
        expect(blocks[2]?.querySelector(".markdown-stub")?.textContent).toContain("<strong>new</strong>");

        const codeRemoved = code?.querySelector(".llm-diff-block-remove");
        expect(codeRemoved?.querySelector("pre")?.textContent).toBe("y = 2");
        expect(codeRemoved?.querySelector(".markdown-stub")).toBeNull();
    });

    it("shows a call as failed from its { error } result even when the provider did not flag it", () => {
        const target = renderCard([ {
            id: "1",
            toolName: "edit_note_content",
            input: { noteId: "t", edits: [ { oldText: "a", newText: "b" } ] },
            result: JSON.stringify({ error: "edit_note_content does not support rich-text notes." })
        } ]);
        const line = target.querySelector("details.llm-chat-tool-call");
        expect(line?.classList.contains("llm-chat-tool-call-error")).toBe(true);
        expect(line?.querySelector(".llm-chat-tool-call-error-badge")).not.toBeNull();
        expect(line?.querySelector(".llm-chat-tool-call-error-message")?.textContent)
            .toBe("edit_note_content does not support rich-text notes.");
    });
});
