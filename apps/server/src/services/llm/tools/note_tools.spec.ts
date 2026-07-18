import { becca, becca_easy_mocking } from "@triliumnext/core";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { noteTools } from "./note_tools.js";
import type { ToolDefinition } from "./tool_registry.js";

const { buildNote } = becca_easy_mocking;

const findResultsMock = vi.hoisted(() => vi.fn());

vi.mock("@triliumnext/core", async (importOriginal) => {
    const actual = await importOriginal<typeof import("@triliumnext/core")>();
    return {
        ...actual,
        note_service: {
            createNewNote: vi.fn()
        },
        search: {
            ...actual.search,
            findResultsWithQuery: findResultsMock
        }
    };
});

function getTool(name: string): ToolDefinition {
    for (const [n, def] of noteTools) {
        if (n === name) return def;
    }
    throw new Error(`Tool ${name} not registered`);
}

/**
 * Wire up an in-memory content store on a note so the tool can read back
 * what it just wrote via `setContent`. Also stubs `saveRevision` to a no-op.
 */
function withMutableContent(note: ReturnType<typeof buildNote>, initial: string) {
    let store = initial;
    note.getContent = () => store;
    note.setContent = vi.fn((content: string | Uint8Array) => {
        store = typeof content === "string" ? content : new TextDecoder().decode(content);
    }) as typeof note.setContent;
    note.saveRevision = vi.fn() as typeof note.saveRevision;
}

describe("note_tools — write tools return post-write content", () => {
    beforeEach(() => {
        becca.reset();
        vi.clearAllMocks();
    });

    describe("set_note_content", () => {
        it("returns the new content for code notes", () => {
            const note = buildNote({ id: "code1", type: "code", mime: "text/plain", content: "old" });
            withMutableContent(note, "old");

            const result = getTool("set_note_content").execute({ noteId: "code1", content: "new code" });

            expect(result).toEqual({
                success: true,
                noteId: "code1",
                title: note.title,
                content: "new code"
            });
        });

        it("returns Markdown for text notes (HTML round-trip)", () => {
            const note = buildNote({ id: "text1", type: "text", mime: "text/html", content: "" });
            withMutableContent(note, "");

            const result = getTool("set_note_content").execute({
                noteId: "text1",
                content: "# Heading\n\nBody text"
            }) as { success: true; content: string };

            expect(result.success).toBe(true);
            expect(result.content).toContain("# Heading");
            expect(result.content).toContain("Body text");
        });

        it("returns an error and no content when the note is missing", () => {
            const result = getTool("set_note_content").execute({ noteId: "missing", content: "x" });
            expect(result).toEqual({ error: "Note not found" });
        });
    });

    describe("append_to_note", () => {
        it("returns the combined content for code notes", () => {
            const note = buildNote({ id: "code2", type: "code", mime: "text/plain", content: "first line" });
            withMutableContent(note, "first line");

            const result = getTool("append_to_note").execute({ noteId: "code2", content: "second line" }) as {
                success: true;
                content: string;
            };

            expect(result.success).toBe(true);
            expect(result.content).toBe("first line\nsecond line");
        });
    });

    describe("edit_note_content", () => {
        it("returns the content with edits applied", () => {
            const note = buildNote({
                id: "code3",
                type: "code",
                mime: "text/plain",
                content: "const x = 1;\nconst y = 2;"
            });
            withMutableContent(note, "const x = 1;\nconst y = 2;");

            const result = getTool("edit_note_content").execute({
                noteId: "code3",
                edits: [{ oldText: "const x = 1;", newText: "const x = 42;" }]
            }) as { success: true; content: string };

            expect(result.success).toBe(true);
            expect(result.content).toBe("const x = 42;\nconst y = 2;");
        });

        it("rejects text notes and returns no content field", () => {
            const note = buildNote({ id: "text2", type: "text", content: "<p>hi</p>" });
            withMutableContent(note, "<p>hi</p>");

            const result = getTool("edit_note_content").execute({
                noteId: "text2",
                edits: [{ oldText: "hi", newText: "bye" }]
            });

            expect(result).toMatchObject({ error: expect.stringContaining("does not support rich-text") });
            expect(result).not.toHaveProperty("content");
        });
    });

    describe("write-tool guard branches", () => {
        for (const tool of ["set_note_content", "append_to_note", "edit_note_content"] as const) {
            const args = (noteId: string) =>
                tool === "edit_note_content"
                    ? { noteId, edits: [{ oldText: "a", newText: "b" }] }
                    : { noteId, content: "x" };

            it(`${tool} reports a missing note`, () => {
                expect(getTool(tool).execute(args("does-not-exist")))
                    .toEqual({ error: "Note not found" });
            });

            it(`${tool} rejects a protected note and an unsupported (binary) note type`, () => {
                const prot = buildNote({ id: `${tool}-p`, type: "code", mime: "text/plain", content: "a" });
                withMutableContent(prot, "a");
                prot.isContentAvailable = () => false;
                expect(getTool(tool).execute(args(`${tool}-p`)))
                    .toMatchObject({ error: expect.stringContaining("protected") });

                // image notes are not string notes → hasStringContent() is false.
                const bin = buildNote({ id: `${tool}-b`, type: "image", mime: "image/png" });
                expect(getTool(tool).execute(args(bin.noteId)))
                    .toMatchObject({ error: expect.stringContaining("note type: image") });
            });
        }

        it("append_to_note and edit_note_content reject a note whose stored content is binary", () => {
            // hasStringContent() reports true but getContent() yields a buffer.
            const mkBinaryHolder = (id: string) => {
                const note = buildNote({ id, type: "code", mime: "text/plain" });
                note.hasStringContent = () => true;
                note.getContent = () => new Uint8Array([1, 2, 3]);
                note.saveRevision = vi.fn() as typeof note.saveRevision;
                return note;
            };
            expect(getTool("append_to_note").execute({ noteId: mkBinaryHolder("ap-bin").noteId, content: "x" }))
                .toEqual({ error: "Note has binary content" });
            expect(getTool("edit_note_content").execute({
                noteId: mkBinaryHolder("ed-bin").noteId,
                edits: [{ oldText: "a", newText: "b" }]
            })).toEqual({ error: "Note has binary content" });
        });

        it("append_to_note does not add a second newline when content already ends with one", () => {
            const note = buildNote({ id: "ap-nl", type: "code", mime: "text/plain", content: "line\n" });
            withMutableContent(note, "line\n");
            const result = getTool("append_to_note").execute({ noteId: "ap-nl", content: "next" }) as {
                content: string;
            };
            expect(result.content).toBe("line\nnext");
        });

        it("append_to_note converts Markdown to HTML for text notes", () => {
            const note = buildNote({ id: "ap-text", type: "text", content: "<p>start</p>" });
            withMutableContent(note, "<p>start</p>");
            const result = getTool("append_to_note").execute({ noteId: "ap-text", content: "more" }) as {
                success: boolean;
                content: string;
            };
            expect(result.success).toBe(true);
            // The appended Markdown is rendered and round-tripped back to Markdown.
            expect(result.content).toContain("more");
        });

        it("edit_note_content surfaces a failed text edit", () => {
            const note = buildNote({ id: "ed-fail", type: "code", mime: "text/plain", content: "abc" });
            withMutableContent(note, "abc");
            expect(getTool("edit_note_content").execute({
                noteId: "ed-fail",
                edits: [{ oldText: "zzz", newText: "y" }]
            })).toMatchObject({ error: expect.stringContaining("not found") });
        });
    });

    describe("create_note", () => {
        it("returns the created note's content", async () => {
            buildNote({ id: "parent1", title: "Parent" });

            const newNote = buildNote({ id: "new1", type: "code", mime: "text/plain", content: "hello" });
            withMutableContent(newNote, "hello");

            const { note_service: noteService } = await import("@triliumnext/core");
            vi.mocked(noteService.createNewNote).mockReturnValue({ note: newNote } as ReturnType<typeof noteService.createNewNote>);

            const result = getTool("create_note").execute({
                parentNoteId: "parent1",
                title: "New",
                content: "hello",
                type: "code",
                mime: "text/plain"
            }) as { success: true; noteId: string; content: string };

            expect(result.success).toBe(true);
            expect(result.noteId).toBe("new1");
            expect(result.content).toBe("hello");
        });

        it("requires a mime for code notes and validates the parent", async () => {
            expect(getTool("create_note").execute({
                parentNoteId: "root", title: "x", content: "", type: "code"
            })).toMatchObject({ error: expect.stringContaining("mime is required") });

            expect(getTool("create_note").execute({
                parentNoteId: "ghost", title: "x", content: "", type: "text"
            })).toEqual({ error: "Parent note not found" });

            const protectedParent = buildNote({ id: "pp", title: "Protected" });
            protectedParent.isProtected = true;
            expect(getTool("create_note").execute({
                parentNoteId: "pp", title: "x", content: "", type: "text"
            })).toMatchObject({ error: expect.stringContaining("protected parent") });
        });

        it("renders Markdown to HTML for text notes and surfaces creation errors", async () => {
            buildNote({ id: "tparent", title: "TParent" });
            const { note_service: noteService } = await import("@triliumnext/core");

            const created = buildNote({ id: "tnew", type: "text", content: "<h2>Hi</h2>" });
            withMutableContent(created, "<h2>Hi</h2>");
            vi.mocked(noteService.createNewNote).mockImplementationOnce((opts: any) => {
                // The tool converts Markdown → HTML before persisting.
                expect(opts.content).toContain("<h2>");
                return { note: created } as ReturnType<typeof noteService.createNewNote>;
            });
            const ok = getTool("create_note").execute({
                parentNoteId: "tparent", title: "T", content: "## Hi", type: "text"
            }) as { success: boolean };
            expect(ok.success).toBe(true);

            vi.mocked(noteService.createNewNote).mockImplementationOnce(() => {
                throw new Error("disk full");
            });
            expect(getTool("create_note").execute({
                parentNoteId: "tparent", title: "T", content: "x", type: "text"
            })).toEqual({ error: "disk full" });

            // A non-Error throw falls back to a generic message.
            vi.mocked(noteService.createNewNote).mockImplementationOnce(() => {
                throw "boom";
            });
            expect(getTool("create_note").execute({
                parentNoteId: "tparent", title: "T", content: "x", type: "text"
            })).toEqual({ error: "Failed to create note" });
        });
    });

    describe("search_notes", () => {
        it("maps results to note summaries and skips stale ids", () => {
            const parent = buildNote({ id: "sp", title: "Search parent" });
            const a = buildNote({ id: "sa", title: "Alpha", type: "code", mime: "text/plain", content: "body" });
            withMutableContent(a, "body");
            // Wire a parent so parentTitle is populated.
            a.getParentNotes = () => [parent];

            findResultsMock.mockReturnValue([
                { noteId: "sa" },
                { noteId: "stale" } // not in becca → filtered out within the limit
            ]);

            const result = getTool("search_notes").execute({ query: "alpha", limit: 5 }) as {
                totalResults: number;
                results: any[];
            };
            expect(result.totalResults).toBe(2);
            expect(result.results).toHaveLength(1); // stale id dropped
            expect(result.results[0]).toMatchObject({ noteId: "sa", title: "Alpha", parentTitle: "Search parent" });
        });

        it("truncates the mapped results to the limit", () => {
            for (const id of ["t1", "t2", "t3"]) {
                const n = buildNote({ id, title: id, type: "code", mime: "text/plain", content: "c" });
                withMutableContent(n, "c");
                n.getParentNotes = () => [];
            }
            // More results than the limit: slice(0, limit) must drop the rest,
            // while totalResults still reflects the full result count.
            findResultsMock.mockReturnValue([{ noteId: "t1" }, { noteId: "t2" }, { noteId: "t3" }]);

            const result = getTool("search_notes").execute({ query: "x", limit: 2 }) as {
                totalResults: number;
                results: any[];
            };
            expect(result.totalResults).toBe(3);
            expect(result.results).toHaveLength(2);
            expect(result.results.map((r) => r.noteId)).toEqual(["t1", "t2"]);
        });

        it("defaults the limit to 10 and tolerates results with no parent", () => {
            const n = buildNote({ id: "np", title: "No parent", type: "code", mime: "text/plain", content: "c" });
            withMutableContent(n, "c");
            n.getParentNotes = () => [];
            findResultsMock.mockReturnValue([{ noteId: "np" }]);

            const result = getTool("search_notes").execute({ query: "x" }) as { results: any[] };
            expect(result.results[0].parentTitle).toBeNull();
        });
    });

    describe("get_note", () => {
        it("returns full metadata for an existing note", () => {
            const note = buildNote({ id: "gn", title: "Meta note", type: "code", mime: "text/plain", content: "c" });
            withMutableContent(note, "c");
            const result = getTool("get_note").execute({ noteId: "gn" }) as { noteId: string };
            expect(result.noteId).toBe("gn");
        });

        it("returns an error for a missing note", () => {
            expect(getTool("get_note").execute({ noteId: "nope" })).toEqual({ error: "Note not found" });
        });
    });

    describe("get_note_content", () => {
        it("returns the LLM-formatted content", () => {
            const note = buildNote({ id: "gc", type: "code", mime: "text/plain", content: "plain" });
            withMutableContent(note, "plain");
            expect(getTool("get_note_content").execute({ noteId: "gc" }))
                .toEqual({ noteId: "gc", content: "plain" });
        });

        it("rejects a missing note and a protected note", () => {
            expect(getTool("get_note_content").execute({ noteId: "nope" }))
                .toEqual({ error: "Note not found" });

            const note = buildNote({ id: "gp", content: "x" });
            note.isContentAvailable = () => false;
            expect(getTool("get_note_content").execute({ noteId: "gp" }))
                .toEqual({ error: "Note is protected" });
        });
    });

    describe("rename_note", () => {
        it("renames a note and trims the title", () => {
            const note = buildNote({ id: "rn", title: "Old" });
            note.save = vi.fn() as typeof note.save;
            const result = getTool("rename_note").execute({ noteId: "rn", newTitle: "  New  " }) as { title: string };
            expect(result.title).toBe("New");
            expect(note.title).toBe("New");
            expect(note.save).toHaveBeenCalledOnce();
        });

        it("rejects missing, protected, and empty-title cases", () => {
            expect(getTool("rename_note").execute({ noteId: "nope", newTitle: "x" }))
                .toEqual({ error: "Note not found" });

            const prot = buildNote({ id: "rp", title: "P" });
            prot.isProtected = true;
            expect(getTool("rename_note").execute({ noteId: "rp", newTitle: "x" }))
                .toMatchObject({ error: expect.stringContaining("protected") });

            const note = buildNote({ id: "re", title: "E" });
            note.save = vi.fn() as typeof note.save;
            expect(getTool("rename_note").execute({ noteId: "re", newTitle: "   " }))
                .toMatchObject({ error: expect.stringContaining("empty") });
        });
    });

    describe("delete_note", () => {
        it("soft-deletes a note and returns its former title", () => {
            const note = buildNote({ id: "dn", title: "Doomed" });
            note.deleteNote = vi.fn() as typeof note.deleteNote;
            const result = getTool("delete_note").execute({ noteId: "dn" });
            expect(result).toEqual({ success: true, noteId: "dn", deletedTitle: "Doomed" });
            expect(note.deleteNote).toHaveBeenCalledOnce();
        });

        it("rejects system notes, missing notes, and protected notes", () => {
            expect(getTool("delete_note").execute({ noteId: "root" }))
                .toEqual({ error: "Cannot delete system notes" });

            expect(getTool("delete_note").execute({ noteId: "nope" }))
                .toEqual({ error: "Note not found" });

            const prot = buildNote({ id: "dp", title: "P" });
            prot.isProtected = true;
            expect(getTool("delete_note").execute({ noteId: "dp" }))
                .toMatchObject({ error: expect.stringContaining("protected") });
        });
    });
});
