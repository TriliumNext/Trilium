// @vitest-environment jsdom
// The pipeline ends in DOMPurify, which needs browser-faithful NodeIterator traversal; happy-dom
// mishandles it and drops the first node of every fragment. Same reason as sanitize_content.spec.
import type { AiConversationTurn, AiSurroundings } from "@triliumnext/ckeditor5";
import type { LlmChatConfig } from "@triliumnext/commons";
import { beforeEach, describe, expect, it, vi } from "vitest";

// Keys stand in for their translations; a key with interpolation renders as `key(name=value)`, so
// a composed label shows both the key it went through and what was substituted into it.
vi.mock("../../../services/i18n.js", async () => {
    // The real catalogue, which is what the function returns in a production build: the languages
    // the Translate submenu offers are exactly the ones out of it the user enabled.
    const { LOCALES } = await import("@triliumnext/commons");
    return {
        t: (key: string, values?: Record<string, string>) => (values
            ? `${key}(${Object.entries(values).map(([name, value]) => `${name}=${value}`).join(",")})`
            : key),
        getAvailableLocales: () => LOCALES
    };
});
vi.mock("../../../services/options.js", () => ({
    default: {
        getJson: (key: string) => (key === "languages" ? storedLanguages : storedProviders),
        is: (key: string) => (key === "aiEnabled" ? aiEnabled : false)
    }
}));
vi.mock("../../../services/llm_chat.js", () => ({
    streamChatCompletion: vi.fn(async (messages, config, callbacks) => {
        requestedConfigs.push(config);
        requestedMessages.push(messages);
        for (const chunk of responseChunks) {
            callbacks.onChunk(chunk);
        }
        callbacks.onDone();
    })
}));
// The context is converted by the server: turndown lives in core, which the client cannot import.
vi.mock("../../../services/server.js", () => ({
    default: { post: vi.fn(async (_url: string, data: { htmlContent: string }) => toMarkdownResult(data.htmlContent)) }
}));
vi.mock("../../../services/task_states.js", () => ({ getTaskStateDefinitions: async () => [] }));
// The breadcrumb is the tree service's own, resolved out of Froca one ancestor at a time.
vi.mock("../../../services/tree.js", () => ({
    default: { getNotePathTitle: vi.fn(async (notePath: string) => notePathTitle(notePath)) }
}));
vi.mock("../../../components/app_context.js", () => ({ default: { triggerCommand: vi.fn() } }));

import appContext from "../../../components/app_context.js";
import buildAiAssistantStream, { type AiNoteLocation, buildAiAssistantQuickActions, stripMarkdownFences } from "./ai_assistant_stream.js";

/** The `llmProviders` option as the mocked `options.getJson` will return it. */
let storedProviders: unknown = null;
/** The `languages` option — the locale ids enabled as content languages. */
let storedLanguages: unknown = null;
/** The `aiEnabled` option — the master switch over every AI feature. */
let aiEnabled = true;
/** The config each `streamChatCompletion` call was made with, in order. */
let requestedConfigs: LlmChatConfig[] = [];
/** The messages each `streamChatCompletion` call was made with, in order. */
let requestedMessages: Array<Array<{ role: string; content: string }>> = [];
/** What the mocked stream emits, one `onChunk` per entry. */
let responseChunks: string[] = ["done"];
/** Stands in for `POST other/to-markdown`; throws to exercise the fallback. */
let toMarkdownResult: (html: string) => { markdownContent: string } = () => ({ markdownContent: "teh" });
/** Stands in for the tree service's breadcrumb; throws to exercise the fallback. */
let notePathTitle: (notePath: string) => string = (notePath) => `Root › ${notePath}`;

const PROVIDER = [{ id: "cfg-openai", provider: "openai", selectedModels: [{ id: "gpt-5", isDefault: true }] }];

beforeEach(() => {
    storedProviders = null;
    storedLanguages = null;
    aiEnabled = true;
    requestedConfigs = [];
    requestedMessages = [];
    responseChunks = ["done"];
    toMarkdownResult = () => ({ markdownContent: "teh" });
    notePathTitle = (notePath) => `Root › ${notePath}`;
});

/** What a run carries besides the content: the conversation, the note, and what surrounds it. */
interface RunOptions {
    history?: AiConversationTurn[];
    surroundings?: AiSurroundings;
    note?: AiNoteLocation | null;
}

/** Runs one completion through the built stream, collecting everything handed to `onData`. */
async function run(context = "<p>teh</p>", opts: RunOptions = {}): Promise<{
    config: LlmChatConfig;
    prompt: string;
    messages: Array<{ role: string; content: string }>;
    rendered: string[];
    sources: string[];
}> {
    const stream = buildAiAssistantStream(opts.note !== undefined ? () => opts.note ?? null : undefined);
    if (!stream) {
        throw new Error("expected the assistant to be enabled");
    }
    const rendered: string[] = [];
    const sources: string[] = [];
    await stream({
        query: "Fix typos",
        context,
        surroundings: opts.surroundings ?? { before: "", after: "" },
        history: opts.history ?? []
    }, (html, source) => {
        rendered.push(html);
        sources.push(source ?? "");
    }, new AbortController().signal);
    const messages = requestedMessages[0] ?? [];
    return {
        config: requestedConfigs[0],
        prompt: messages.find((message) => message.role === "user")?.content ?? "",
        messages,
        rendered,
        sources
    };
}

/** Runs one completion and returns just the provider/model config it sent. */
async function runOnce(): Promise<LlmChatConfig> {
    return (await run()).config;
}

describe("buildAiAssistantStream", () => {
    it("stays disabled when no provider is configured", () => {
        expect(buildAiAssistantStream()).toBeUndefined();
        storedProviders = [];
        expect(buildAiAssistantStream()).toBeUndefined();
    });

    // Switching the AI features off leaves the configured providers stored — they are what
    // switching it back on restores — so the master switch has to be read in its own right.
    it("stays disabled when the AI features are switched off, provider or no provider", () => {
        aiEnabled = false;
        storedProviders = PROVIDER;
        expect(buildAiAssistantStream()).toBeUndefined();

        aiEnabled = true;
        expect(buildAiAssistantStream()).toBeDefined();
    });

    it("uses the first provider's default model, else its first", async () => {
        storedProviders = [{
            id: "cfg-openai",
            provider: "openai",
            selectedModels: [{ id: "gpt-5-mini" }, { id: "gpt-5", isDefault: true }]
        }];
        expect(await runOnce()).toEqual({ model: "gpt-5", provider: "openai", providerId: "cfg-openai" });

        requestedConfigs = [];
        storedProviders = [{ id: "cfg-openai", provider: "openai", selectedModels: [{ id: "gpt-5-mini" }] }];
        expect(await runOnce()).toEqual({ model: "gpt-5-mini", provider: "openai", providerId: "cfg-openai" });
    });

    it("skips providers without a selected model", async () => {
        storedProviders = [
            { id: "cfg-openai", provider: "openai" },
            { id: "cfg-ollama", provider: "ollama", selectedModels: [{ id: "llama4" }] }
        ];
        expect(await runOnce()).toEqual({ model: "llama4", provider: "ollama", providerId: "cfg-ollama" });
    });

    it("still names the provider when no provider has a selected model", async () => {
        // Without this the request names nothing and the server falls back to Anthropic, which
        // either fails outright or silently answers from the wrong provider.
        storedProviders = [
            { id: "cfg-openai", provider: "openai" },
            { id: "cfg-ollama", provider: "ollama", selectedModels: [] }
        ];
        expect(await runOnce()).toEqual({ provider: "openai", providerId: "cfg-openai" });
    });

    // The assistant rewrites what it was handed and needs nothing from the note tools. It asks for
    // none by saying nothing about them, which every provider reads as off — see the two agent
    // providers' own specs, which pin that down on the side where it used to go the other way.
    it("asks for no note tools", async () => {
        storedProviders = [{ id: "cfg-openai", provider: "openai", selectedModels: [{ id: "gpt-5" }] }];

        expect(await runOnce()).not.toHaveProperty("enableNoteTools");
    });
});

describe("the Markdown pipeline", () => {
    beforeEach(() => {
        storedProviders = PROVIDER;
    });

    it("sends the context as Markdown, converted by the server", async () => {
        toMarkdownResult = (html) => ({ markdownContent: html + " as markdown" });

        const { prompt } = await run("<p>teh</p>");
        expect(prompt).toContain("<p>teh</p> as markdown");
        expect(prompt).toContain("Task: Fix typos");
    });

    it("sends no context at all when generating from scratch", async () => {
        const { prompt } = await run("");
        expect(prompt).toBe("Fix typos");
    });

    it("falls back to the HTML context when the conversion fails", async () => {
        // Losing the conversion is worth far less than losing the run.
        toMarkdownResult = () => { throw new Error("offline"); };
        vi.spyOn(console, "warn").mockImplementation(() => {});

        const { prompt } = await run("<p>teh</p>");
        expect(prompt).toContain("<p>teh</p>");
    });

    it("renders the cumulative Markdown to HTML on every chunk", async () => {
        responseChunks = ["# Ti", "tle\n\nsome ", "**bold** text"];

        const { rendered } = await run();
        expect(rendered).toHaveLength(3);
        // Each render is of the whole buffer, so a heading cut mid-word is still a heading —
        // demoted to <h2>, since in Trilium the note title is the document's <h1>.
        expect(rendered[0]).toContain("<h2");
        expect(rendered[2]).toContain("<strong>bold</strong>");
    });

    it("turns the Trilium syntaxes the prompt advertises into their markup", async () => {
        responseChunks = [
            "> [!TIP]\n> Watch out\n\n",
            "- [ ] ship it\n\n",
            "\u0060\u0060\u0060mermaid\nflowchart TD\n  a-->b\n\u0060\u0060\u0060\n"
        ];

        const [, , html] = (await run()).rendered;
        expect(html).toContain('<aside class="admonition tip">');
        expect(html).toContain('<ul class="todo-list">');
        expect(html).toContain("language-mermaid");
    });

    // Markdown has no collapsible syntax, so the model writes the HTML — which only keeps its
    // Markdown formatted when the blank lines separate it from the surrounding block.
    it("formats the content inside a collapsible, given the blank lines the prompt asks for", async () => {
        responseChunks = ["<details>\n<summary>More</summary>\n\n- one\n- two\n\n</details>"];

        const [html] = (await run()).rendered;
        expect(html).toContain("<summary>More</summary>");
        expect(html).toContain("<ul><li>one</li><li>two</li></ul>");
    });

    it("leaves a collapsible's content unformatted when the model omits them", async () => {
        // Documented so the prompt's insistence on blank lines is not mistaken for noise.
        responseChunks = ["<details><summary>More</summary>\n- one\n</details>"];

        const [html] = (await run()).rendered;
        expect(html).toContain("- one");
        expect(html).not.toContain("<li>one</li>");
    });

    // The Diagram action asks for the code block and nothing else, so the whole answer is a
    // fence — one the stripper must not mistake for a wrapper.
    it("keeps a diagram whose fence is the entire answer", async () => {
        responseChunks = ["```mermaid\nflowchart TD\n  a-->b\n```"];

        const [html] = (await run()).rendered;
        expect(html).toContain("language-mermaid");
        expect(html).toContain("flowchart TD");
    });

    it("strips a fence the model wrapped the whole answer in", async () => {
        responseChunks = ["\u0060\u0060\u0060markdown\n**bold**\n\u0060\u0060\u0060"];

        const [html] = (await run()).rendered;
        expect(html).toContain("<strong>bold</strong>");
        expect(html).not.toContain("\u0060\u0060\u0060");
    });
});

// A selection alone leaves the model writing into a document it cannot see; the note it sits in
// and the text either side of it are what place the answer, without a line of retrieval.
describe("where the run is writing", () => {
    beforeEach(() => {
        storedProviders = PROVIDER;
    });

    it("opens with the note's breadcrumb and the text around the content", async () => {
        toMarkdownResult = () => ({ markdownContent: "the target" });

        const { prompt } = await run("<p>the target</p>", {
            note: { title: "Meeting notes", notePath: "abc123" },
            surroundings: { before: "A heading\nBefore it", after: "After it" }
        });

        expect(prompt).toBe([
            "Note: Root › abc123",
            "Text before the content (context only):\nA heading\nBefore it",
            "Text after the content (context only):\nAfter it",
            "Content:\nthe target",
            "Task: Fix typos"
        ].join("\n\n"));
    });

    // The whole point of naming the sections: the model has to place the answer without touching
    // them.
    it("tells the model the background is not its to rewrite", async () => {
        const { messages } = await run();
        expect(messages[0].role).toBe("system");
        expect(messages[0].content).toContain("never rewrite, repeat or answer them");
    });

    it("names the cursor rather than the content when generating from scratch", async () => {
        const { prompt } = await run("", {
            note: { title: "Meeting notes" },
            surroundings: { before: "Before it", after: "" }
        });

        // There is no "Content" section for it to be before, and saying otherwise would name
        // something the model was never shown.
        expect(prompt).toBe("Note: Meeting notes\n\nText before the cursor (context only):\nBefore it\n\nTask: Fix typos");
    });

    it("names the note by its title alone when it has no path", async () => {
        expect((await run("", { note: { title: "Meeting notes" } })).prompt)
            .toBe("Note: Meeting notes\n\nTask: Fix typos");
    });

    // Nothing to place it against — an instruction typed into an empty note by a host that names
    // none — so it goes as it was typed rather than as the sole entry of a form.
    it("sends the instruction bare when there is nothing to place it against", async () => {
        expect((await run("", { note: null })).prompt).toBe("Fix typos");
    });

    it("falls back to the title when the breadcrumb cannot be resolved", async () => {
        notePathTitle = () => { throw new Error("gone"); };
        vi.spyOn(console, "warn").mockImplementation(() => {});

        const { prompt } = await run("", { note: { title: "Meeting notes", notePath: "abc123" } });
        expect(prompt).toBe("Note: Meeting notes\n\nTask: Fix typos");
    });

    // The note has not changed under the assistant, and the answers to it are in the transcript.
    it("places only the opening turn, leaving the follow-ups bare", async () => {
        const { messages } = await run("<p>the target</p>", {
            note: { title: "Meeting notes" },
            surroundings: { before: "Before it", after: "" },
            history: [
                { role: "user", content: "Translate to German" },
                { role: "assistant", content: "Guten Tag" }
            ]
        });

        expect(messages[1].content).toContain("Note: Meeting notes");
        expect(messages[3].content).toBe("Fix typos");
    });
});

describe("the conversation", () => {
    const fence = "\u0060\u0060\u0060";

    beforeEach(() => {
        storedProviders = PROVIDER;
    });

    // What the editor records as the assistant's turn, so that a follow-up hands the model back
    // its own Markdown rather than our rendering of it — stripped exactly as the preview shows it.
    it("reports the Markdown each render was made from", async () => {
        responseChunks = [fence + "markdown\n**bo", "ld**\n" + fence];

        const { sources, rendered } = await run();
        expect(sources).toEqual(["**bo", "**bold**\n"]);
        expect(rendered.at(-1)).toContain("<strong>bold</strong>");
    });

    // The instruction behind an answer stays on the record, so "make it shorter" after a
    // translation shortens the translation instead of quietly undoing it.
    it("sends the exchanges so far, with only the opening turn carrying the content", async () => {
        toMarkdownResult = (html) => ({ markdownContent: html + " as markdown" });

        const { messages } = await run("<p>teh</p>", {
            history: [
                { role: "user", content: "Translate to German" },
                { role: "assistant", content: "Guten Tag" }
            ]
        });

        expect(messages.map((message) => message.role)).toEqual(["system", "user", "assistant", "user"]);
        expect(messages[1].content).toBe("Content:\n<p>teh</p> as markdown\n\nTask: Translate to German");
        expect(messages[2].content).toBe("Guten Tag");
        // The new instruction alone: what it applies to is the answer above it.
        expect(messages[3].content).toBe("Fix typos");
    });

    it("leaves the turns bare when the conversation started from scratch", async () => {
        const { messages } = await run("", {
            history: [
                { role: "user", content: "Write a haiku" },
                { role: "assistant", content: "an old silent pond" }
            ]
        });

        expect(messages.slice(1).map((message) => message.content))
            .toEqual(["Write a haiku", "an old silent pond", "Fix typos"]);
    });
});

describe("stripMarkdownFences", () => {
    const fence = "\u0060\u0060\u0060";

    it("returns unfenced content unchanged", () => {
        expect(stripMarkdownFences("plain")).toBe("plain");
    });

    it("strips a complete fence pair", () => {
        expect(stripMarkdownFences(fence + "markdown\nhi\n" + fence)).toBe("hi\n");
        expect(stripMarkdownFences(fence + "\nhi\n" + fence + "\n")).toBe("hi\n");
    });

    it("strips an opening fence whose closing half has not streamed in yet", () => {
        expect(stripMarkdownFences(fence + "markdown\nst")).toBe("st");
    });

    it("leaves a fence that names content alone", () => {
        expect(stripMarkdownFences(fence + "mermaid\nflowchart TD\n" + fence))
            .toBe(fence + "mermaid\nflowchart TD\n" + fence);
        expect(stripMarkdownFences(fence + "js\nconst a = 1;\n" + fence))
            .toBe(fence + "js\nconst a = 1;\n" + fence);
    });

    it("does not treat a fence inside the content as a closing one", () => {
        expect(stripMarkdownFences(fence + "markdown\nuse " + fence + " for fences\nmore"))
            .toBe("use " + fence + " for fences\nmore");
    });
});

describe("buildAiAssistantQuickActions", () => {
    function actions(groupId: string) {
        const group = buildAiAssistantQuickActions().find((candidate) => candidate.id === groupId);
        if (!group) {
            throw new Error(`no quick-action group with id "${groupId}"`);
        }
        return group.actions;
    }

    // A tone or a language means nothing on its own once it is away from its group heading, which
    // is where the `/` palette shows it.
    it("composes a standalone command label for the tones and the languages", () => {
        const direct = actions("tone").find((action) => action.id === "direct");
        expect(direct?.label).toBe("ai_assistant.tone_direct");
        expect(direct?.commandLabel).toBe("ai_assistant.command_tone(tone=ai_assistant.tone_direct)");

        const romanian = actions("translate").find((action) => action.id === "translate:ro");
        expect(romanian?.label).toBe("Română");
        expect(romanian?.commandLabel).toBe("ai_assistant.command_translate(language=Română)");
        // The instruction is not translated: it is addressed to the model, not to the user.
        expect(romanian?.prompt).toBe("Translate the content to Romanian.");
    });

    // The list is the user's own — the languages they enabled as content languages, the same ones a
    // note's language is picked from — rather than a fixed six that suit nobody in particular.
    it("offers the enabled content languages, naming each in itself but to the model in English", () => {
        storedLanguages = ["ja", "cn", "pt_br", "en-GB", "ar"];

        // Ordered as the catalogue is — by native name — so the submenu reads the same way as the
        // language picker the list was configured in.
        expect(actions("translate").map((action) => [action.id, action.label, action.prompt])).toEqual([
            ["translate:en-GB", "English (United Kingdom)", "Translate the content to English (United Kingdom)."],
            ["translate:pt_br", "Português (Brasil)", "Translate the content to Brazilian Portuguese."],
            ["translate:ar", "اَلْعَرَبِيَّةُ", "Translate the content to Arabic."],
            ["translate:ja", "日本語", "Translate the content to Japanese."],
            // `zh-Hans`, not the `zh-CN` the locale maps to elsewhere: the pair differs by script,
            // so "Simplified Chinese" is the name that tells them apart and "Chinese (China)" is not.
            ["translate:cn", "简体中文", "Translate the content to Simplified Chinese."]
        ]);
    });

    // The list is configurable, so what configures it closes the submenu — the same row the status
    // bar and the ribbon end their language pickers with, raising the same modal.
    it("closes the Translate submenu with the row that configures the list", () => {
        const group = buildAiAssistantQuickActions().find((candidate) => candidate.id === "translate");
        expect(group?.footer?.label).toBe("note_language.configure-languages");

        group?.footer?.run?.();
        expect(appContext.triggerCommand).toHaveBeenCalledWith("showContentLanguagesDialog");

        // It is the only group whose contents the user chooses, so the only one with a footer.
        expect(buildAiAssistantQuickActions().filter((candidate) => candidate.footer)).toHaveLength(1);
    });

    // Nothing is enabled on a fresh install, and an empty Translate submenu would say the feature
    // was broken rather than unconfigured.
    it("falls back to the original six when no content language is enabled", () => {
        for (const empty of [null, []]) {
            storedLanguages = empty;
            expect(actions("translate").map((action) => action.id)).toEqual([
                "translate:de", "translate:en", "translate:es", "translate:fr", "translate:ro", "translate:cn"
            ]);
        }
    });

    // "Make shorter" against "Simplify language", "Turn into a table" against "Extract action
    // items": no single phrase composes either pair, so both labels are translated as a pair.
    it("spells out both labels for the adjustments and the reformats", () => {
        expect(actions("adjust").map((action) => [action.label, action.commandLabel])).toEqual([
            ["ai_assistant.adjust_shorter", "ai_assistant.command_make_shorter"],
            ["ai_assistant.adjust_longer", "ai_assistant.command_make_longer"],
            ["ai_assistant.adjust_simpler", "ai_assistant.command_simplify"]
        ]);
        expect(actions("reformat").map((action) => [action.label, action.commandLabel])).toEqual([
            ["ai_assistant.reformat_bullet_list", "ai_assistant.command_bullet_list"],
            ["ai_assistant.reformat_table", "ai_assistant.command_table"],
            ["ai_assistant.reformat_diagram", "ai_assistant.command_diagram"],
            ["ai_assistant.reformat_callout", "ai_assistant.command_callout"],
            ["ai_assistant.reformat_collapsible", "ai_assistant.command_collapsible"],
            ["ai_assistant.reformat_action_items", "ai_assistant.command_action_items"]
        ]);
    });

    // Two entries one click apart must not carry the same instruction, or the menu offers the same
    // rewrite twice under different names.
    it("keeps the length actions and the tones from asking for the same thing", () => {
        const promptOf = (groupId: string, id: string) =>
            actions(groupId).find((action) => action.id === id)?.prompt ?? "";

        // The direct tone is about voice, not length — length belongs to Make shorter.
        expect(promptOf("tone", "direct")).toContain("active voice");
        expect(promptOf("tone", "direct")).not.toMatch(/shorten|essential information|non-essential/i);

        // Improve writing leaves the mechanics to Fix typos and the length to Make shorter.
        expect(promptOf("edit", "improveWriting")).not.toMatch(/mistakes|tighten/i);
        expect(promptOf("adjust", "makeShorter")).toMatch(/shorten/i);
        expect(promptOf("edit", "fixTypos")).toMatch(/spelling, grammar and punctuation/i);
    });

    it("inlines the groups whose actions already read as commands", () => {
        const groups = buildAiAssistantQuickActions();
        expect(groups.filter((group) => group.submenu).map((group) => group.id))
            .toEqual(["adjust", "tone", "reformat", "translate"]);
        expect(groups.filter((group) => !group.submenu).map((group) => group.id))
            .toEqual(["edit", "generate"]);
    });

    // A new action reaching the menu without an icon should fail here rather than ship a gap in
    // the column. Two exemptions, both pinned so they read as decisions: an inlined group has no
    // heading to put an icon on, and the languages share a panel with nothing that has one.
    it("gives every action, and every submenu, an icon from the pack", () => {
        for (const group of buildAiAssistantQuickActions()) {
            if (group.submenu) {
                expect(group.iconClass, group.id).toMatch(/^bx bx-[a-z-]+$/);
            } else {
                expect(group.iconClass, group.id).toBeUndefined();
            }
            for (const action of group.actions) {
                if (group.id === "translate") {
                    expect(action.iconClass, action.id).toBeUndefined();
                } else {
                    expect(action.iconClass, action.id).toMatch(/^bx bx-[a-z-]+$/);
                }
            }
        }
    });

    it("leaves the labels that already read as commands alone", () => {
        for (const action of [ ...actions("edit"), ...actions("generate") ]) {
            expect(action.commandLabel).toBeUndefined();
        }
    });

    // The actions that answer with a replacement rather than an edit open their review on the
    // result; everything else lets the diff of the run decide, which is what an unset view means.
    it("sends the replacements to the result view and leaves the edits to the diff", () => {
        const reviewViews = new Map(buildAiAssistantQuickActions()
            .flatMap((group) => group.actions)
            .map((action) => [action.id, action.reviewView]));

        expect([ ...reviewViews ].filter(([, view]) => view === "result").map(([id]) => id))
            .toEqual([
                "summarize", "explain", "continue", "table", "diagram", "actionItems",
                "translate:de", "translate:en", "translate:es", "translate:fr", "translate:ro", "translate:cn"
            ]);
        for (const id of ["fixTypos", "improveWriting", "makeShorter", "professional", "callout"]) {
            expect(reviewViews.get(id), id).toBeUndefined();
        }
    });
});
