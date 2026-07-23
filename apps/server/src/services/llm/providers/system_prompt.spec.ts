import { describe, expect, it, vi } from "vitest";

// Delegates to the real getTaskStates by default; individual tests override it
// to inject custom task states (the namespace re-export is frozen, so a plain
// spy can't patch it).
const getTaskStatesMock = vi.hoisted(() => vi.fn());
const getNoteMock = vi.hoisted(() => vi.fn());
vi.mock("@triliumnext/core", async (importOriginal) => {
    const actual = await importOriginal<typeof import("@triliumnext/core")>();
    getTaskStatesMock.mockImplementation(actual.task_states.getTaskStates);
    return {
        ...actual,
        task_states: { ...actual.task_states, getTaskStates: getTaskStatesMock },
        becca: { ...actual.becca, getNote: getNoteMock }
    };
});

import { buildSystemPrompt } from "./system_prompt.js";

describe("buildSystemPrompt", () => {
    it("uses config.systemPrompt over the message system prompt and emits the no-note-access notice", () => {
        const prompt = buildSystemPrompt(
            [{ role: "system", content: "FROM MESSAGE" }],
            { systemPrompt: "FROM CONFIG" }
        ) ?? "";
        expect(prompt).toContain("FROM CONFIG");
        expect(prompt).not.toContain("FROM MESSAGE");
        expect(prompt).toContain("do not have access to the user's notes");
    });

    it("falls back to the system message content when no config prompt is set", () => {
        const prompt = buildSystemPrompt([{ role: "system", content: "FROM MESSAGE" }], {}) ?? "";
        expect(prompt).toContain("FROM MESSAGE");
    });

    it("includes the note-tools guidance when note tools are enabled", () => {
        const prompt = buildSystemPrompt([], { enableNoteTools: true, enableWebSearch: true }) ?? "";
        expect(prompt).toContain("load_skill");
        expect(prompt).toContain("wiki-link format [[noteId]]");
        // Parallel tool-call hint appears when any tool capability is on.
        expect(prompt).toContain("issue the tool calls in parallel");
        // Web search enabled → no "web search is disabled" notice.
        expect(prompt).not.toContain("do not have access to web search");
    });

    it("emits the context-note-only notice when a context note is set but note tools are off", () => {
        const prompt = buildSystemPrompt([], { contextNoteId: "ctx" }) ?? "";
        expect(prompt).toContain("cannot search or access other notes");
        expect(prompt).toContain("do not have access to web search");
    });

    it("always appends the markdown formatting hints", () => {
        const prompt = buildSystemPrompt([], {}) ?? "";
        expect(prompt).toContain("Admonitions");
        expect(prompt).toContain("Mermaid diagrams");
        expect(prompt).toContain("Blockquotes");
        expect(prompt).toContain("Tables");
        expect(prompt).toContain("Collapsible blocks");
        expect(prompt).toContain("Keyboard keys");
    });

    it("lists the workspace's custom task-state markers so the model can recognize them", () => {
        // No _taskStates container in the test becca → getTaskStates falls back to the defaults.
        const prompt = buildSystemPrompt([], {}) ?? "";
        expect(prompt).toContain("Task lists");
        expect(prompt).toContain("`- [/]` — Doing");
        expect(prompt).toContain("`- [?]` — Maybe");
        expect(prompt).toContain("`- [-]` — Cancelled");
    });

    it("keeps just the native open/completed hint when no custom states are defined", () => {
        getTaskStatesMock.mockReturnValueOnce([]);
        const prompt = buildSystemPrompt([], {}) ?? "";
        expect(prompt).toContain("`- [ ]` for an open task");
        expect(prompt).not.toContain("also defines extra task states");
    });

    it("suffixes custom task states that mark a task as completed", () => {
        getTaskStatesMock.mockReturnValueOnce([
            { name: "verified", title: "Verified", markdownSymbol: "v", isCompleted: true, icon: "bx bx-check-double" }
        ]);
        const prompt = buildSystemPrompt([], {}) ?? "";
        expect(prompt).toContain("`- [v]` — Verified (completed)");
    });
});

describe("buildSystemPrompt knowledge base", () => {
    function kbNote(noteId: string, title: string) {
        return {
            noteId,
            type: "text",
            getTitleOrProtected: () => title,
            getChildNotes: () => [],
            isContentAvailable: () => true,
            getContent: () => `<p>content of ${title}</p>`
        };
    }

    it("injects the KB section and enables the note-tools guidance for the sources", () => {
        getNoteMock.mockImplementation((id: string) => kbNote(id, `Note ${id}`));

        const prompt = buildSystemPrompt([], { sourceNoteIds: ["a", "b"] }) ?? "";

        expect(prompt).toContain("## Knowledge Base Sources");
        expect(prompt).toContain("[1] Note a [[a]]");
        expect(prompt).toContain("[2] Note b [[b]]");
        // KB mode implies note access even when enableNoteTools is off.
        expect(prompt).toContain("wiki-link format [[noteId]]");
        expect(prompt).not.toContain('"Note access" is disabled');
    });

    it("adds no KB section when the sources resolve to nothing", () => {
        getNoteMock.mockReturnValue(null);
        const prompt = buildSystemPrompt([], { sourceNoteIds: ["gone"] }) ?? "";
        expect(prompt).not.toContain("## Knowledge Base Sources");
    });

    it("adds no KB section without sources", () => {
        const prompt = buildSystemPrompt([], {}) ?? "";
        expect(prompt).not.toContain("## Knowledge Base Sources");
    });
});
