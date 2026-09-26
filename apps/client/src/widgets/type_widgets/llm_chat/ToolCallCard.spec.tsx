import { render } from "preact";
import { act } from "preact/test-utils";
import { afterEach, describe, expect, it, vi } from "vitest";

vi.mock("../../../services/i18n.js", () => ({
    t: (key: string, options?: { defaultValue?: string }) => {
        if (key.startsWith("llm.tools.")) return key.slice("llm.tools.".length);
        if (key === "llm_chat.skills.search_syntax") return "Search syntax";
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

    it("previews an SVG a call wrote as an image, never as live markup", () => {
        mocks.notes = { s: { type: "image", mime: "image/svg+xml" } };
        const svg = "<svg xmlns=\"http://www.w3.org/2000/svg\"><script>alert(1)</script><circle r=\"4\"/></svg>";
        const target = renderCard([
            { id: "1", toolName: "create_note", input: { parentNoteId: "root", title: "Dot", content: svg, type: "image" } },
            { id: "2", toolName: "get_note", input: { noteId: "s" } },
            { id: "3", toolName: "set_note_content", input: { noteId: "s", content: svg } },
            { id: "4", toolName: "append_to_note", input: { noteId: "s", content: "<rect/>" } }
        ]);
        const [ created, , rewritten, appended ] = [ ...(target.querySelector(".llm-chat-tool-calls")?.children ?? []) ];

        for (const call of [ created, rewritten ]) {
            const img = call?.querySelector<HTMLImageElement>(".llm-chat-written img.llm-chat-written-svg");
            expect(img).not.toBeNull();
            expect(decodeURIComponent(img?.getAttribute("src") ?? "")).toBe(`data:image/svg+xml;charset=utf-8,${svg}`);
        }
        expect(target.querySelector("svg, script")).toBeNull();
        expect(appended).not.toBeUndefined();
        expect(appended?.querySelector(".llm-chat-written")).toBeNull();
    });

    it("shows what set_note_content wrote by the type and mime it changed the note to", () => {
        mocks.notes = { t: { type: "text", mime: "text/html" }, c: { type: "code", mime: "text/x-python" } };
        // A call in between keeps the two from grouping into one section.
        const target = renderCard([
            { id: "1", toolName: "set_note_content", input: { noteId: "t", content: "print(1)", type: "code", mime: "text/x-python" } },
            { id: "2", toolName: "get_note", input: { noteId: "t" } },
            { id: "3", toolName: "set_note_content", input: { noteId: "c", content: "# Title", type: "text" } }
        ]);
        const [ toCode, , toText ] = [ ...(target.querySelector(".llm-chat-tool-calls")?.children ?? []) ];

        const codeBlock = toCode?.querySelector(".llm-chat-written .code-block-stub");
        expect(codeBlock?.textContent).toBe("print(1)");
        expect(codeBlock?.getAttribute("data-mime")).toBe("text/x-python");
        expect(toCode?.querySelector(".llm-chat-written .markdown-stub")).toBeNull();

        expect(toText?.querySelector(".llm-chat-written .markdown-stub")).not.toBeNull();
        expect(toText?.querySelector(".llm-chat-written .code-block-stub")).toBeNull();
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
        expect(codeRemoved?.querySelector(".llm-diff-code")?.textContent).toBe("y = 2");
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

    it("names the title a note had before a rename, on the plain line", () => {
        const rename = (id: string, result: object): ToolCall => ({
            id, toolName: "rename_note", input: { noteId: "n", newTitle: "New" }, result: JSON.stringify(result)
        });
        const target = renderCard([
            rename("1", { success: true, noteId: "n", title: "New", oldTitle: "Old" }),
            { id: "2", toolName: "get_note", input: { noteId: "x" }, result: "{}" },
            rename("3", { success: true, noteId: "n", title: "New" })
        ]);
        const [ renamed, , older ] = [ ...(target.querySelector(".llm-chat-tool-calls")?.children ?? []) ];

        expect(renamed instanceof HTMLDetailsElement).toBe(false);
        const oldTitle = renamed?.querySelector(".llm-chat-tool-call-old-title");
        expect(oldTitle?.textContent).toBe("Old");
        expect(oldTitle?.nextElementSibling?.querySelector(".note-link-stub")?.textContent).toBe("n");
        expect(older?.querySelector(".llm-chat-tool-call-old-title")).toBeNull();
    });

    it("says where a move took a note from and to", () => {
        const move = (id: string, result: object): ToolCall => ({
            id, toolName: "move_note", input: { noteId: "n", newParentNoteId: "to" }, result: JSON.stringify(result)
        });
        const target = renderCard([
            move("1", { success: true, noteId: "n", newParentNoteId: "to", oldParentNoteId: "from" }),
            { id: "2", toolName: "get_note", input: { noteId: "x" }, result: "{}" },
            move("3", { success: true, noteId: "n", newParentNoteId: "to" })
        ]);
        const [ moved, , older ] = [ ...(target.querySelector(".llm-chat-tool-calls")?.children ?? []) ];
        const ref = (line: Element | undefined) => line?.querySelector(".llm-chat-tool-call-note-ref");

        expect(ref(moved)?.textContent).toBe("llm.tools.note_moved_fromnfromto");
        expect(ref(older)?.textContent).toBe("llm.tools.note_movednto");
    });

    it("shows a deleted note by the title it had, since its link has nothing left to show", () => {
        const target = renderCard([
            {
                id: "1",
                toolName: "delete_note",
                input: { noteId: "d" },
                result: JSON.stringify({ success: true, noteId: "d", deletedTitle: "Doomed" })
            },
            { id: "2", toolName: "get_note", input: { noteId: "x" }, result: "{}" },
            { id: "3", toolName: "delete_note", input: { noteId: "p" } }
        ]);
        const [ deleted, , pending ] = [ ...(target.querySelector(".llm-chat-tool-calls")?.children ?? []) ];

        expect(deleted?.querySelector(".llm-chat-tool-call-deleted-title")?.textContent).toBe("Doomed");
        expect(deleted?.querySelector(".note-link-stub")).toBeNull();
        expect(pending?.querySelector(".note-link-stub")?.textContent).toBe("p");
        expect(pending?.querySelector(".llm-chat-tool-call-deleted-title")).toBeNull();
    });

    it("shows the attributes each attribute tool read, set or deleted, as pills", () => {
        const target = renderCard([
            {
                id: "1",
                toolName: "get_attributes",
                input: { noteId: "n" },
                result: JSON.stringify([
                    { attributeId: "a1", type: "label", name: "book", value: "" },
                    { attributeId: "a2", type: "relation", name: "author", value: "tolkien" }
                ])
            },
            {
                id: "2",
                toolName: "get_attribute",
                input: { attributeId: "a3" },
                result: JSON.stringify({ attributeId: "a3", noteId: "n", type: "label", name: "status", value: "done" })
            },
            { id: "3", toolName: "set_attribute", input: { noteId: "n", type: "label", name: "year", value: "1954" } },
            {
                id: "4",
                toolName: "delete_attribute",
                input: { noteId: "n", attributeId: "a4" },
                result: JSON.stringify({ success: true, attributeId: "a4", type: "label", name: "temp", value: "1" })
            }
        ]);
        const [ list, single, set, deleted ] = [ ...(target.querySelector(".llm-chat-tool-calls")?.children ?? []) ];
        const pills = (line: Element | undefined) => [ ...(line?.querySelectorAll(".llm-chat-attribute") ?? []) ].map(pill => pill.textContent);

        expect(list instanceof HTMLDetailsElement).toBe(true);
        expect(list?.querySelector(".llm-chat-tool-call-result-count")?.textContent).toBe("llm_chat.attribute_count{\"count\":2}");
        expect(pills(list)).toEqual([ "#book", "~author=tolkien" ]);

        expect(single instanceof HTMLDetailsElement).toBe(false);
        expect(pills(single)).toEqual([ "#status=done" ]);
        expect(single?.querySelector(".llm-chat-tool-call-note-ref .note-link-stub")?.textContent).toBe("n");

        expect(pills(set)).toEqual([ "#year=1954" ]);

        expect(pills(deleted)).toEqual([ "#temp=1" ]);
        expect(deleted?.querySelector(".llm-chat-attribute")?.classList.contains("llm-chat-attribute-deleted")).toBe(true);
    });

    it("shows the icons an icon search found, and how many it left out", () => {
        const target = renderCard([ {
            id: "1",
            toolName: "search_icons",
            input: { query: "rocket", limit: 2 },
            result: JSON.stringify({
                totalResults: 5,
                results: [
                    { iconClass: "bx bx-rocket", terms: [ "rocket", "launch" ] },
                    { iconClass: "bx bxs-rocket", terms: [ "rocket" ] }
                ]
            })
        } ]);
        const line = target.querySelector("details.llm-chat-tool-call");
        expect(line?.querySelector(".llm-chat-tool-call-result-count")?.textContent)
            .toBe("llm_chat.search_icons_count{\"count\":5}");
        const icons = [ ...(line?.querySelectorAll(".llm-chat-icon-results .tn-icon") ?? []) ];
        expect(icons.map(icon => [ ...icon.classList ].filter(c => c.startsWith("bx")).join(" "))).toEqual([ "bx bx-rocket", "bx bxs-rocket" ]);
        expect(line?.querySelector(".llm-chat-note-results-more")?.textContent)
            .toBe("llm_chat.search_notes_limited{\"count\":5,\"limit\":2}");
    });

    it("names an attachment and its note, and previews the text read from one", () => {
        const target = renderCard([
            {
                id: "1",
                toolName: "get_attachment",
                input: { attachmentId: "a" },
                result: JSON.stringify({ attachmentId: "a", ownerId: "n", role: "file", mime: "application/pdf", title: "report.pdf", contentLength: 2048 })
            },
            {
                id: "2",
                toolName: "get_attachment_content",
                input: { attachmentId: "a" },
                result: JSON.stringify({ attachmentId: "a", source: "ocr", content: "Quarterly **report**" })
            }
        ]);
        const [ meta, content ] = [ ...(target.querySelector(".llm-chat-tool-calls")?.children ?? []) ];

        expect(meta instanceof HTMLDetailsElement).toBe(false);
        expect(meta?.querySelector(".llm-chat-tool-call-attachment-title")?.textContent).toBe("report.pdf");
        expect(meta?.querySelector(".note-link-stub")?.textContent).toBe("n");
        expect(meta?.querySelector(".llm-chat-tool-call-result-count")?.textContent).toBe("llm_chat.attachment_size{\"size\":\"2 KiB\"}");

        expect(content?.querySelector(".llm-chat-note-card-facts")?.textContent).toBe("llm_chat.attachment_ocr");
        expect(content?.querySelector(".llm-chat-note-result-preview")?.textContent).toBe("Quarterly report");
    });

    it("names a skill the AI loaded by its display name, falling back to its ID", () => {
        const target = renderCard([
            { id: "1", toolName: "load_skill", input: { name: "search_syntax" }, result: JSON.stringify({ skill: "search_syntax", instructions: "…" }) },
            { id: "2", toolName: "get_note", input: { noteId: "x" }, result: "{}" },
            { id: "3", toolName: "load_skill", input: { name: "brand_new" }, result: JSON.stringify({ skill: "brand_new", instructions: "…" }) }
        ]);
        const [ known, , unknown ] = [ ...(target.querySelector(".llm-chat-tool-calls")?.children ?? []) ];
        expect(known instanceof HTMLDetailsElement).toBe(false);
        expect(known?.querySelector(".llm-chat-tool-call-detail")?.textContent).toBe("Search syntax");
        expect(unknown?.querySelector(".llm-chat-tool-call-detail")?.textContent).toBe("brand_new");
    });

    it("lays out the User Guide contents as a tree whose pages open as contextual help", () => {
        const target = renderCard([ {
            id: "1",
            toolName: "get_help_toc",
            input: {},
            result: JSON.stringify({ pageCount: 3, toc: "Getting started (_help_a)\n  Install (_help_b)\nNotes (_help_c)" })
        } ]);
        const line = target.querySelector("details.llm-chat-tool-call");
        expect(line?.querySelector(".llm-chat-tool-call-result-count")?.textContent)
            .toBe("llm_chat.search_help_count{\"count\":3}");

        const header = (row: Element | null | undefined) => row?.querySelector(":scope > .llm-chat-note-result-header");
        const rows = [ ...(line?.querySelectorAll(".llm-chat-note-result") ?? []) ];
        expect(rows.map(row => ({
            page: header(row)?.querySelector("a")?.textContent,
            parent: header(row.parentElement?.closest(".llm-chat-note-result"))?.querySelector("a")?.textContent ?? null
        }))).toEqual([
            { page: "Getting started", parent: null },
            { page: "Install", parent: "Getting started" },
            { page: "Notes", parent: null }
        ]);

        const install = header(rows[1])?.querySelector<HTMLAnchorElement>("a");
        expect(install).not.toBeNull();
        act(() => install?.click());
        expect(mocks.openInAppHelpFromUrl).toHaveBeenCalledExactlyOnceWith("b");
    });

    it("lists the sources a web search found, whichever provider ran it", () => {
        const search = (id: string, input: Record<string, unknown>, result: unknown): ToolCall => ({
            id, toolName: "web_search", input, result: typeof result === "string" ? result : JSON.stringify(result)
        });
        const target = renderCard([
            search("1", { query: "trilium" }, [
                { type: "web_search_result", url: "https://triliumnotes.org/docs", title: "Docs", pageAge: null, encryptedContent: "x" },
                { type: "web_search_result", url: "https://github.com/TriliumNext/Trilium", title: null, pageAge: null, encryptedContent: "y" }
            ]),
            { id: "2", toolName: "get_note", input: { noteId: "x" }, result: "{}" },
            search("3", {}, { action: { type: "search", query: "weather" }, sources: [ { type: "url", url: "https://a.com/x" }, { type: "api", name: "oai" } ] }),
            { id: "4", toolName: "get_note", input: { noteId: "x" }, result: "{}" },
            search("5", { query: "t" }, "Web search results for query: \"t\"\n\nLinks: [{\"title\":\"T\",\"url\":\"https://t.org/p\"}]\n\nSummary"),
            { id: "6", toolName: "get_note", input: { noteId: "x" }, result: "{}" },
            search("7", { query: "q" }, "Searching the web")
        ]);
        const [ anthropic, , openai, , claude, , bare ] = [ ...(target.querySelector(".llm-chat-tool-calls")?.children ?? []) ];
        const sources = (line: Element | undefined) => [ ...(line?.querySelectorAll(".llm-chat-note-result") ?? []) ].map(row => ({
            text: row.querySelector("a.external")?.textContent,
            href: row.querySelector("a.external")?.getAttribute("href"),
            domain: row.querySelector(".llm-chat-note-result-detail")?.textContent
        }));

        expect(anthropic?.querySelector(".llm-chat-tool-call-result-count")?.textContent).toBe("llm_chat.web_sources_count{\"count\":2}");
        expect(sources(anthropic)).toEqual([
            { text: "Docs", href: "https://triliumnotes.org/docs", domain: "triliumnotes.org" },
            { text: "https://github.com/TriliumNext/Trilium", href: "https://github.com/TriliumNext/Trilium", domain: "github.com" }
        ]);

        expect(openai?.querySelector(".llm-chat-tool-call-detail")?.textContent).toBe("weather");
        expect(sources(openai)).toEqual([ { text: "https://a.com/x", href: "https://a.com/x", domain: "a.com" } ]);

        expect(sources(claude)).toEqual([ { text: "T", href: "https://t.org/p", domain: "t.org" } ]);

        expect(bare instanceof HTMLDetailsElement).toBe(false);
    });

    it("links the page a call read, and previews what it read there", () => {
        const target = renderCard([ {
            id: "1",
            toolName: "read_web_page",
            input: { url: "https://triliumnotes.org" },
            result: "The page describes **Trilium**."
        } ]);
        const line = target.querySelector("details.llm-chat-tool-call");
        const link = line?.querySelector<HTMLAnchorElement>(".llm-chat-tool-call-detail a.external");
        expect(link?.getAttribute("href")).toBe("https://triliumnotes.org");
        expect(link?.getAttribute("target")).toBe("_blank");
        expect(line?.querySelector(".llm-chat-note-result-preview")?.textContent).toBe("The page describes Trilium.");
    });
});
