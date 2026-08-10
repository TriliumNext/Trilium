import { describe, expect, it } from "vitest";

import { buildNote } from "../test/becca_easy_mocking";
import { findLlmChatExcerpts, findMindMapExcerpts } from "./backlink_excerpts";

function chatContent(messages: unknown[]) {
    return JSON.stringify({ messages });
}

describe("findLlmChatExcerpts", () => {
    it("quotes the assistant prose around the wiki-link, links titled and text escaped", () => {
        buildNote({ id: "excTarget", title: "Chat target" });
        buildNote({ id: "excOther", title: "Other <note>" });

        const excerpts = findLlmChatExcerpts(chatContent([
            { role: "user", content: "where is [[excTarget]] mentioned?" },
            {
                role: "assistant",
                content: [
                    { type: "text", content: "I found 1 < 2 results in [[excTarget]] next to [[excOther]]." }
                ]
            }
        ]), "excTarget");

        expect(excerpts).toHaveLength(1);
        expect(excerpts[0]).toMatch(/^<div class="ck-content backlink-excerpt">/);
        expect(excerpts[0]).toContain("I found 1 &lt; 2 results in");
        expect(excerpts[0]).toContain(`<a class="reference-link backlink-link" href="#root/excTarget">Chat target</a>`);
        expect(excerpts[0]).toContain(`<a class="reference-link" href="#root/excOther">Other &lt;note&gt;</a>`);
    });

    it("renders the markdown instead of quoting it verbatim", () => {
        buildNote({ id: "excMd", title: "Md target" });

        const excerpts = findLlmChatExcerpts(chatContent([
            {
                role: "assistant",
                content: [
                    { type: "text", content: "It is **very** relevant to [[excMd]]:\n\n- one\n- two" }
                ]
            }
        ]), "excMd");

        expect(excerpts[0]).toContain("<strong>very</strong>");
        expect(excerpts[0]).toContain("<li>one</li>");
        expect(excerpts[0]).not.toContain("**");
    });

    it("keeps a regular markdown link's own text and titles a link to an unknown note with the raw ID", () => {
        const excerpts = findLlmChatExcerpts(chatContent([
            {
                role: "assistant",
                content: [
                    { type: "text", content: "See [my name](#root/excMissing) and [[excMissing]]." }
                ]
            }
        ]), "excMissing");

        expect(excerpts).toHaveLength(2);
        expect(excerpts[0]).toContain(">my name</a>");
        expect(excerpts[1]).toContain(">excMissing</a>");
    });

    it("truncates long neighboring paragraphs with ellipses, one excerpt per mention", () => {
        buildNote({ id: "excLong", title: "Long target" });

        const excerpts = findLlmChatExcerpts(chatContent([
            {
                role: "assistant",
                content: [
                    { type: "text", content: `${"a".repeat(260)}\n\nHere: [[excLong]]\n\n${"b".repeat(260)}` },
                    { type: "text", content: "Also see [[excLong]]." }
                ]
            }
        ]), "excLong");

        expect(excerpts).toHaveLength(2);
        // Like text-note excerpts, expansion stops at the first truncated paragraph, so the
        // budget goes to the text preceding the link.
        expect(excerpts[0]).toMatch(/…a+/);
        expect(excerpts[0]).toContain(`<a class="reference-link backlink-link" href="#root/excLong">Long target</a>`);
        expect(excerpts[1]).toContain("Also see <a");
    });

    it("quotes nothing from tool calls, thinking blocks, user prose, or broken content", () => {
        const quiet = chatContent([
            {
                role: "assistant",
                content: [
                    { type: "tool_call", toolCall: { input: { noteId: "excQuiet" } } },
                    { type: "thinking", content: "peeking at [[excQuiet]]" }
                ]
            },
            { role: "user", content: "the [[excQuiet]] wiki-link in user prose creates no relation" }
        ]);

        expect(findLlmChatExcerpts(quiet, "excQuiet")).toEqual([]);
        expect(findLlmChatExcerpts("not JSON at all", "excQuiet")).toEqual([]);
        expect(findLlmChatExcerpts(`{"messages": "not an array"}`, "excQuiet")).toEqual([]);
    });
});

describe("findMindMapExcerpts", () => {
    /** A map of nodes, each given as `[topic, hyperLink]`, all hanging off the root. */
    function mapContent(root: unknown) {
        return JSON.stringify({ nodeData: root });
    }

    it("quotes the node the link sits on, led by the nodes it hangs from", () => {
        buildNote({ id: "excMapTarget", title: "Map target" });

        const excerpts = findMindMapExcerpts(mapContent({
            topic: "Project",
            children: [
                {
                    topic: "Ideas <untried>",
                    children: [
                        { topic: "Rewrite the parser", hyperLink: "#root/excMapTarget" },
                        { topic: "Something else", hyperLink: "https://example.com" }
                    ]
                },
                { topic: "Done", hyperLink: "#root/excMapOther" }
            ]
        }), "excMapTarget");

        expect(excerpts).toHaveLength(1);
        expect(excerpts[0]).toBe(
            `<div class="ck-content backlink-excerpt">Project › Ideas &lt;untried&gt; › ` +
            `<a class="backlink-link" href="#root/excMapTarget">Rewrite the parser</a></div>`
        );
    });

    it("quotes every node linking to the note, the root among them", () => {
        buildNote({ id: "excMapTwice", title: "Twice" });

        const excerpts = findMindMapExcerpts(mapContent({
            topic: "Root",
            hyperLink: "#root/excMapTwice",
            children: [ { topic: "Child", hyperLink: "#root/excMapTwice" } ]
        }), "excMapTwice");

        expect(excerpts).toHaveLength(2);
        // The root hangs from nothing, so it is quoted on its own.
        expect(excerpts[0]).toContain(`>Root</a>`);
        expect(excerpts[0]).not.toContain("›");
        expect(excerpts[1]).toContain(`Root › <a class="backlink-link" href="#root/excMapTwice">Child</a>`);
    });

    it("names an unnamed node after the note it points at", () => {
        buildNote({ id: "excMapUnnamed", title: "The note itself" });

        const excerpts = findMindMapExcerpts(mapContent({
            topic: "Root",
            children: [ { topic: "", hyperLink: "#root/excMapUnnamed" } ]
        }), "excMapUnnamed");

        expect(excerpts[0]).toContain(`>The note itself</a>`);
    });

    it("drops the root end of a long trail rather than the node itself", () => {
        buildNote({ id: "excMapDeep", title: "Deep" });

        // Each level is well within the budget on its own; together they are not.
        const topics = [ "a".repeat(80), "b".repeat(80), "c".repeat(80) ];
        const deepest = { topic: "The node", hyperLink: "#root/excMapDeep" };
        const map = topics.reduceRight<unknown>((child, topic) => ({ topic, children: [ child ] }), deepest);

        const [ excerpt ] = findMindMapExcerpts(mapContent(map), "excMapDeep");

        expect(excerpt).toContain(`>The node</a>`);
        expect(excerpt).toContain("…");
        // The nearest ancestor is kept, the furthest dropped: it is the one that says the least.
        expect(excerpt).toContain("c".repeat(80));
        expect(excerpt).not.toContain("a".repeat(80));
    });

    it("quotes nothing from a map that links elsewhere, or from content it cannot read", () => {
        expect(findMindMapExcerpts(mapContent({ topic: "Root", hyperLink: "https://example.com" }), "excMapNone")).toEqual([]);
        expect(findMindMapExcerpts("not JSON at all", "excMapNone")).toEqual([]);
        expect(findMindMapExcerpts(`{"nodeData": "not a node"}`, "excMapNone")).toEqual([]);
    });
});
