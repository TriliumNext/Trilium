import {
    Alignment,
    BlockQuote,
    BookmarkUI,
    type ClassicEditor,
    ContextualBalloon,
    type Editor,
    Essentials,
    _getModelData as getModelData,
    Heading,
    keyCodes,
    MentionEditing,
    Paragraph,
    _setModelData as setModelData
} from "ckeditor5";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { createTestEditor } from "../../../test/editor-kit.js";
import { COMMAND_NAME as INCLUDE_NOTE_COMMAND } from "../includenote.js";
import { COMMAND_NAME as INSERT_DATE_TIME_COMMAND } from "../insert_date_time.js";
import { COMMAND_NAME as INTERNAL_LINK_COMMAND } from "../internallink.js";
import { COMMAND_NAME as MARKDOWN_IMPORT_COMMAND } from "../markdownimport.js";
import MathUI from "../math/math_ui.js";
import { INSERT_MERMAID_COMMAND } from "../mermaid/insert_mermaid_command.js";
import TriliumSnippets from "../snippets/snippets.js";
import type { SnippetDefinition } from "../snippets/snippetsconfig.js";
import TriliumSlashCommands, {
    buildDefaultSlashCommands,
    buildTriliumSlashCommands,
    isSlashCommandEnabled,
    matchSlashCommands,
    type SlashCommandConfig,
    type SlashCommandDefinition
} from "./slash_commands.js";
import TriliumMentionUI from "./trilium_mention_ui.js";
import type { TriliumMentionFeed } from "./types.js";

/** Longer than the mention UI's 100 ms feed debounce. */
const AFTER_DEBOUNCE = 160;

const HEADING_OPTIONS = [
    { model: "paragraph", title: "Paragraph" },
    { model: "heading2", view: "h2", title: "Heading 2" },
    { model: "heading3", view: "h3", title: "Heading 3" }
];

describe("matchSlashCommands", () => {
    const definitions: SlashCommandDefinition[] = [
        { id: "table", title: "Table", icon: "", aliases: [ "grid" ] },
        { id: "codeBlock", title: "Code block", icon: "", aliases: [ "snippet" ] },
        { id: "toc", title: "Table of contents", icon: "", aliases: [ "outline" ] },
        { id: "quote", title: "Block quote", icon: "" }
    ];

    it("returns the whole catalog, in order, for an empty query", () => {
        expect(matchSlashCommands(definitions, "").map((d) => d.id)).toEqual([ "table", "codeBlock", "toc", "quote" ]);
        expect(matchSlashCommands(definitions, "   ").map((d) => d.id)).toEqual([ "table", "codeBlock", "toc", "quote" ]);
    });

    it("ranks title prefixes above alias prefixes, and both above substring matches", () => {
        // "Table"/"Table of contents" start with it; "Block quote" only contains it.
        expect(matchSlashCommands(definitions, "table").map((d) => d.id)).toEqual([ "table", "toc" ]);

        // `grid` is an alias of Table; `Code block` merely contains "d".
        expect(matchSlashCommands(definitions, "gri").map((d) => d.id)).toEqual([ "table" ]);

        // Title prefix (Code block) beats alias substring (outline).
        expect(matchSlashCommands(definitions, "co").map((d) => d.id)).toEqual([ "codeBlock", "toc" ]);

        // Last resort: only an alias contains it, and not at its start ("outline").
        expect(matchSlashCommands(definitions, "line").map((d) => d.id)).toEqual([ "toc" ]);
    });

    it("matches case-insensitively and ignores surrounding whitespace", () => {
        expect(matchSlashCommands(definitions, "  BLOCK ").map((d) => d.id)).toEqual([ "quote", "codeBlock" ]);
    });

    it("returns nothing when there is no match", () => {
        expect(matchSlashCommands(definitions, "zzz")).toEqual([]);
    });
});

describe("TriliumSlashCommands", () => {
    let editor: ClassicEditor;

    async function createEditor(slashCommand: SlashCommandConfig = {}) {
        editor = await createTestEditor(
            [ Essentials, Paragraph, Heading, BlockQuote, MentionEditing, TriliumMentionUI, TriliumSlashCommands ],
            { heading: { options: HEADING_OPTIONS }, slashCommand }
        );
        setModelData(editor.model, "<paragraph>[]</paragraph>");
    }

    /** The `/` feed the plugin registered, as the mention UI sees it. */
    function slashFeed(): TriliumMentionFeed {
        const feeds = (editor.config.get("mention.feeds") ?? []) as TriliumMentionFeed[];
        const feed = feeds.find((candidate) => candidate.marker === "/");

        if (!feed) {
            throw new Error("the plugin did not register a `/` feed");
        }

        return feed;
    }

    async function queryPalette(query: string) {
        const feed = slashFeed().feed;

        if (typeof feed !== "function") {
            throw new Error("the `/` feed should be a callback");
        }

        return await feed.call(editor, query);
    }

    function type(text: string) {
        editor.model.change((writer) => {
            editor.model.insertContent(writer.createText(text), editor.model.document.selection.getFirstPosition());
        });
    }

    function pressKey(keyCode: number) {
        editor.editing.view.document.fire("keydown", {
            keyCode,
            preventDefault: () => {},
            stopPropagation: () => {},
            domTarget: editor.editing.view.getDomRoot()
        });
    }

    async function settle() {
        await new Promise((resolve) => setTimeout(resolve, AFTER_DEBOUNCE));
    }

    beforeEach(async () => {
        await createEditor();
    });

    it("registers itself and a `/` feed that opens on the bare marker", () => {
        expect(TriliumSlashCommands.pluginName).toBe("TriliumSlashCommands");
        expect(editor.plugins.get(TriliumSlashCommands)).toBeInstanceOf(TriliumSlashCommands);
        expect(slashFeed().minimumCharacters).toBe(0);
    });

    it("shows the palette unbounded by default, since the query only ever narrows it", async () => {
        // Premium defaulted to `Infinity`; a cap would hide entries no query could then reach.
        expect(slashFeed().dropdownLimit).toBe(Infinity);

        await createEditor({ dropdownLimit: 3 });
        expect(slashFeed().dropdownLimit).toBe(3);
    });

    describe("catalog", () => {
        it("derives heading entries from heading.options, so the palette matches the configured levels", () => {
            const defaults = buildDefaultSlashCommands(editor).map((definition) => definition.id);

            // Trilium reserves heading1 for the note title, so it is absent from the options.
            expect(defaults.slice(0, 3)).toEqual([ "paragraph", "heading2", "heading3" ]);
            expect(defaults).not.toContain("heading1");
        });

        // The configured titles are English message ids, and CKEditor's own catalogs translate them
        // — its heading dropdown does the same. Without this the palette showed English titles
        // beside descriptions that were translated, since those went through `t()` already.
        it("translates the heading titles rather than using the configured English verbatim", async () => {
            editor = await createTestEditor(
                [ Essentials, Paragraph, Heading, BlockQuote, MentionEditing, TriliumMentionUI, TriliumSlashCommands ],
                {
                    heading: { options: HEADING_OPTIONS },
                    translations: [ {}, { en: { dictionary: { "Paragraph": "Paragraf", "Heading 2": "Titlu 2" } } } ]
                }
            );

            const titles = buildDefaultSlashCommands(editor).slice(0, 3).map((definition) => definition.title);

            expect(titles).toEqual([ "Paragraf", "Titlu 2", "Heading 3" ]);
        });

        it("falls back to a heading-free palette in an editor that configures neither headings nor slash commands", async () => {
            editor = await createTestEditor(
                [ Essentials, Paragraph, BlockQuote, MentionEditing, TriliumMentionUI, TriliumSlashCommands ]
            );
            setModelData(editor.model, "<paragraph>[]</paragraph>");

            // No `heading.options` to derive from, so the palette carries no headings at all...
            expect(buildDefaultSlashCommands(editor).map((definition) => definition.id))
                .toEqual([ "blockQuote", "codeBlock", "insertTable", "horizontalLine", "indent", "outdent" ]);

            // ...and of those, only the one whose plugin is actually loaded survives the catalog.
            const ids = (await queryPalette("")).map((item) => (item as { id: string }).id);
            expect(ids).toContain("/blockQuote");
            expect(ids).not.toContain("/codeBlock");
            expect(ids.filter((id) => id.startsWith("/heading"))).toEqual([]);

            // Trilium's own execute-only entries have no command to gate them, so they stay.
            expect(ids).toContain("/align-left");
        });

        it("uses a generic icon for a heading level outside h1-h6", async () => {
            await createEditor();
            editor.config.set("heading.options", [ { model: "headingCustom", title: "Custom heading" } ]);

            const [ custom ] = buildDefaultSlashCommands(editor);
            expect(custom.id).toBe("headingCustom");
            expect(custom.icon).toBeTruthy();
        });

        it("hides entries whose command no plugin registered", async () => {
            const ids = (await queryPalette("")).map((item) => (item as { id: string }).id);

            // BlockQuote is loaded in this editor; CodeBlock and Table are not.
            expect(ids).toContain("/blockQuote");
            expect(ids).not.toContain("/codeBlock");
            expect(ids).not.toContain("/insertTable");
        });

        it("drops entries named by removeCommands", async () => {
            await createEditor({ removeCommands: [ "blockQuote", "heading3" ] });
            const ids = (await queryPalette("")).map((item) => (item as { id: string }).id);

            expect(ids).not.toContain("/blockQuote");
            expect(ids).not.toContain("/heading3");
            expect(ids).toContain("/heading2");
        });

        it("hides an entry whose command is registered but disabled for the current selection", async () => {
            const blockQuote = editor.commands.get("blockQuote");

            if (!blockQuote) {
                throw new Error("the editor should register the blockQuote command");
            }

            expect((await queryPalette("")).map((item) => (item as { id: string }).id)).toContain("/blockQuote");

            // Committing an entry first deletes the `/query`, so an entry whose command would no-op
            // costs the user their input and returns nothing.
            blockQuote.forceDisabled("spec");
            expect((await queryPalette("")).map((item) => (item as { id: string }).id)).not.toContain("/blockQuote");

            blockQuote.clearForceDisabled("spec");
            expect((await queryPalette("")).map((item) => (item as { id: string }).id)).toContain("/blockQuote");
        });

        it("honours an entry's own isEnabled predicate, which is the only gate an execute-only entry has", () => {
            const isEnabled = vi.fn(() => false);
            const definition: SlashCommandDefinition = { id: "custom", title: "Custom thing", icon: "<svg/>", execute: () => {}, isEnabled };

            expect(isSlashCommandEnabled(editor, definition)).toBe(false);
            expect(isEnabled).toHaveBeenCalledWith(editor);

            isEnabled.mockReturnValue(true);
            expect(isSlashCommandEnabled(editor, definition)).toBe(true);
        });

        it("orders the catalog as CKEditor's own entries, then Trilium's, then the snippets", async () => {
            const ids = (await queryPalette("")).map((item) => (item as { id: string }).id);

            // The heading entries lead the defaults; Trilium's own group follows them. Only
            // execute-only entries are compared, since anything naming a command whose plugin this
            // editor does not load is filtered out before ordering matters.
            expect(ids[0]).toBe("/paragraph");
            expect(ids.indexOf("/blockQuote")).toBeLessThan(ids.indexOf("/align-left"));
            expect(ids.indexOf("/align-left")).toBeLessThan(ids.indexOf("/anchor"));
        });
    });

    describe("snippets", () => {
        const SNIPPETS: SnippetDefinition[] = [
            {
                title: "Greeting",
                data: "<p>Hello there</p>",
                description: "A friendly hello",
                iconClass: "tn-icon bx bx-note",
                iconColorClass: "use-note-color"
            },
            { title: "Signature", data: () => "<p>Sincerely, spec</p>" }
        ];

        async function createSnippetEditor(definitions: SnippetDefinition[] = SNIPPETS) {
            editor = await createTestEditor(
                [ Essentials, Paragraph, Heading, BlockQuote, MentionEditing, TriliumMentionUI, TriliumSlashCommands, TriliumSnippets ],
                { heading: { options: HEADING_OPTIONS }, toolbar: [], slashCommand: {}, snippets: { definitions } }
            );
            setModelData(editor.model, "<paragraph>[]</paragraph>");
        }

        it("lists each snippet after the built-ins, found by its title or the generic aliases", async () => {
            await createSnippetEditor();

            const ids = (await queryPalette("")).map((item) => (item as { id: string }).id);
            expect(ids.slice(-2)).toEqual([ "/snippet-0", "/snippet-1" ]);

            expect((await queryPalette("greet")).map((item) => (item as { text: string }).text)).toEqual([ "Greeting" ]);

            const byAlias = (await queryPalette("snippet")).map((item) => (item as { text: string }).text);
            expect(byAlias).toContain("Greeting");
            expect(byAlias).toContain("Signature");
        });

        it("offers no snippet entries in an editor without the snippets plugin", async () => {
            const ids = (await queryPalette("")).map((item) => (item as { id: string }).id);
            expect(ids.some((id) => id.startsWith("/snippet-"))).toBe(false);
        });

        it("inserts the snippet content on commit, for string and callback data alike", async () => {
            await createSnippetEditor();

            type("/greeting");
            await settle();
            pressKey(keyCodes.enter);

            let data = getModelData(editor.model, { withoutSelection: true });
            expect(data).toContain("Hello there");
            expect(data).not.toContain("/greeting");

            // A fresh empty paragraph: right after the inserted content the slash would be
            // mid-word, and a mid-word `/` deliberately never opens the palette.
            setModelData(editor.model, "<paragraph>[]</paragraph>");
            type("/signature");
            await settle();
            pressKey(keyCodes.enter);

            data = getModelData(editor.model, { withoutSelection: true });
            expect(data).toContain("Sincerely, spec");
        });

        it("reflects updateDefinitions() on the next query, since the catalog is rebuilt per keystroke", async () => {
            await createSnippetEditor();

            editor.plugins.get(TriliumSnippets).updateDefinitions([ { title: "Renamed", data: "<p>x</p>" } ]);

            const titles = (await queryPalette("")).map((item) => (item as { text: string }).text);
            expect(titles).toContain("Renamed");
            expect(titles).not.toContain("Greeting");
        });

        it("hides snippets while the insertTemplate command is disabled, like any command-gated entry", async () => {
            await createSnippetEditor();
            const insertTemplate = editor.commands.get("insertTemplate");

            if (!insertTemplate) {
                throw new Error("the snippets plugin should register the insertTemplate command");
            }

            insertTemplate.forceDisabled("spec");
            expect((await queryPalette("")).map((item) => (item as { text: string }).text)).not.toContain("Greeting");
        });
    });

    describe("execution", () => {
        it("runs a commandName entry and removes the trigger text", async () => {
            type("/quo");
            await settle();

            pressKey(keyCodes.enter);

            const data = getModelData(editor.model, { withoutSelection: true });
            expect(data).toContain("<blockQuote>");
            expect(data).not.toContain("/quo");
        });

        // The alignment entries are execute-only — they run `alignment` with an argument rather than
        // naming a command — so committing one exercises the `execute` path end to end.
        it("runs an entry's own execute callback, with the editor as its argument", async () => {
            // Alignment has to be loaded for its command to exist; the entry itself names no
            // command, so it is the `execute` callback that reaches it.
            editor = await createTestEditor(
                [ Essentials, Paragraph, Alignment, MentionEditing, TriliumMentionUI, TriliumSlashCommands ]
            );
            setModelData(editor.model, "<paragraph>[]</paragraph>");
            const execute = vi.spyOn(editor, "execute");

            // One word, since the `/` marker pattern stops at a space.
            type("/Justify");
            await settle();
            pressKey(keyCodes.enter);

            expect(execute).toHaveBeenCalledWith("alignment", { value: "justify" });
        });

        it("passes the level to the heading command rather than executing an id", async () => {
            type("/heading");
            await settle();

            // "Heading 2" is the first configured level, so it is the pre-selected suggestion.
            pressKey(keyCodes.enter);

            expect(getModelData(editor.model, { withoutSelection: true })).toContain("<heading2>");
        });

        it("keeps the trigger text when the selected command goes disabled before Enter", async () => {
            type("/quo");
            await settle();

            // The entry was listed while enabled; committing it deletes the `/quo` first, so a
            // command that no-ops here would silently eat the user's input. Disable it after the
            // panel is populated to reproduce the window the query-time filter cannot see.
            const blockQuote = editor.commands.get("blockQuote");

            if (!blockQuote) {
                throw new Error("the editor should register the blockQuote command");
            }

            blockQuote.forceDisabled("spec");
            pressKey(keyCodes.enter);

            const data = getModelData(editor.model, { withoutSelection: true });
            expect(data).not.toContain("<blockQuote>");
            expect(data).toContain("/quo");
        });
    });

    describe("row rendering", () => {
        function render(query: string, index = 0) {
            const items = matchSlashCommands(buildDefaultSlashCommands(editor), query);
            const renderer = slashFeed().itemRenderer;

            if (!renderer) {
                throw new Error("the `/` feed should provide an itemRenderer");
            }

            return renderer({ id: `/${items[index].id}`, text: items[index].title, definition: items[index] } as never) as HTMLElement;
        }

        it("renders the icon, title and description with premium's class names, so the theme still applies", () => {
            const row = render("block quote");

            expect(row.classList.contains("ck-slash-command-button")).toBe(true);
            // Without this the base button styles hide the label, leaving a title-less row.
            expect(row.classList.contains("ck-button_with-text")).toBe(true);
            expect(row.querySelector(".ck-icon")?.innerHTML).toContain("<svg");
            // Opts into core's `fill: currentColor` rule; without it the glyphs stay black on dark themes.
            expect(row.querySelector(".ck-icon")?.classList.contains("ck-icon_inherit-color")).toBe(true);
            expect(row.querySelector(".ck-button__label")?.textContent).toBe("Block quote");
            expect(row.querySelector(".ck-slash-command-button__description")?.textContent).toBeTruthy();
        });

        it("omits the description element for an entry that has none", () => {
            const renderer = slashFeed().itemRenderer;

            if (!renderer) {
                throw new Error("the `/` feed should provide an itemRenderer");
            }

            const definition: SlashCommandDefinition = { id: "bare", title: "Bare", icon: "<svg/>" };
            const row = renderer({ id: "/bare", text: "Bare", definition } as never) as HTMLElement;

            expect(row.querySelector(".ck-slash-command-button__description")).toBeNull();
        });

        it("renders a font-icon chip from iconClass, with and without a colour class", () => {
            const renderer = slashFeed().itemRenderer;

            if (!renderer) {
                throw new Error("the `/` feed should provide an itemRenderer");
            }

            const coloured: SlashCommandDefinition = {
                id: "snippet-0", title: "Greeting", iconClass: "tn-icon bx bx-note", iconColorClass: "use-note-color"
            };
            const colourless: SlashCommandDefinition = { id: "snippet-1", title: "Plain", iconClass: "bx bx-cube" };

            for (const definition of [ coloured, colourless ]) {
                const row = renderer({ id: `/${definition.id}`, text: definition.title, definition } as never) as HTMLElement;
                const chip = row.querySelector(".ck-icon");

                expect(chip?.classList.contains("ck-slash-command-button__note-icon")).toBe(true);
                expect(chip?.querySelector("svg")).toBeNull();
            }

            const colouredRow = renderer({ id: "/snippet-0", text: "Greeting", definition: coloured } as never) as HTMLElement;
            // The glyph classes go on an inner span, not the chip: the chip's box is sized in em of
            // its own font-size, so carrying the enlarged glyph font itself would inflate the row.
            const glyph = colouredRow.querySelector(".ck-icon > span");
            for (const cls of [ "tn-icon", "bx", "bx-note", "use-note-color" ]) {
                expect(glyph?.classList.contains(cls)).toBe(true);
            }
        });
    });

    it("does not open the palette on a mid-word slash", async () => {
        type("and/or");
        await settle();

        const balloon = editor.plugins.get(ContextualBalloon);
        expect(balloon.visibleView?.element?.classList.contains("ck-mentions") ?? false).toBe(false);
    });
});

/**
 * The palette entries for Trilium's own features. These used to be built by the host and injected
 * through `slashCommand.extraCommands`, and were tested against a bare translator function; they are
 * built from the editor now, so the definitions come from a real one.
 */
describe("buildTriliumSlashCommands", () => {
    let editor: ClassicEditor;

    /** Records `execute()` calls and serves plugin lookups, standing in for the *target* editor. */
    function makeFakeEditor(commands: Record<string, unknown> = {}) {
        const pluginInstances = new Map<unknown, unknown>();
        const executeSpy = vi.fn();
        const fake = {
            execute: executeSpy,
            plugins: { get: (key: unknown) => pluginInstances.get(key) },
            commands: { get: (name: string) => commands[name] }
        } as unknown as Editor;
        return { fake, executeSpy, pluginInstances };
    }

    beforeEach(async () => {
        editor = await createTestEditor(
            [ Essentials, Paragraph, BlockQuote, MentionEditing, TriliumMentionUI, TriliumSlashCommands ],
            { mermaid: { samples: [ { name: "Flowchart", content: "graph TD;" } ] } }
        );
    });

    function definition(id: string) {
        const found = buildTriliumSlashCommands(editor).find((entry) => entry.id === id);
        if (!found) throw new Error(`no palette entry with id "${id}"`);
        return found;
    }

    // One case per entry rather than a test each: the shape is identical, only the data differs.
    it.each([
        [ "collapsible", "Collapsible block", "collapsible" ],
        [ "footnote", "Footnote", "InsertFootnote" ],
        [ "datetime", "Insert date/time", INSERT_DATE_TIME_COMMAND ],
        [ "internal-link", "Internal link", INTERNAL_LINK_COMMAND ],
        [ "include-note", "Include note", INCLUDE_NOTE_COMMAND ],
        [ "page-break", "Page break", "pageBreak" ],
        [ "markdown-import", "Markdown import", MARKDOWN_IMPORT_COMMAND ],
        [ "bulletedList", "Bulleted list", "bulletedList" ],
        [ "numberedList", "Numbered list", "numberedList" ],
        [ "todoList", "To-do list", "todoList" ],
        [ "mermaid", "Mermaid diagram", INSERT_MERMAID_COMMAND ]
    ])("defines %s, running its command with an icon and a description", (id, title, commandName) => {
        const entry = definition(id);

        expect(entry.title).toBe(title);
        expect(entry.commandName).toBe(commandName);
        expect(entry.description).toBeTruthy();
        expect(entry.icon).toContain("<svg");
    });

    it.each([
        [ "align-left", "left" ],
        [ "align-center", "center" ],
        [ "align-right", "right" ],
        [ "align-justify", "justify" ]
    ])("%s runs the alignment command with value %s", (id, value) => {
        const { fake, executeSpy } = makeFakeEditor();

        definition(id).execute?.(fake);

        expect(executeSpy).toHaveBeenCalledWith("alignment", { value });
    });

    it("finds the collapsible block under the names other editors give it", () => {
        const definitions = buildTriliumSlashCommands(editor);

        // "collapse" earns its place among the aliases: the title starts with "collapsi", so
        // a fully typed "collapse" matches neither its prefix nor a substring of it.
        for (const query of [
            "details", "fold", "toggle", "collapse", "expand", "accordion", "spoiler",
            "summary", "disclosure", "hide"
        ]) {
            expect(matchSlashCommands(definitions, query).map((entry) => entry.id))
                .toContain("collapsible");
        }
    });

    it("defines one entry per admonition type, each applying its own type", () => {
        const { fake, executeSpy } = makeFakeEditor();

        for (const type of [ "note", "tip", "important", "caution", "warning" ]) {
            const entry = definition(type);
            expect(entry.icon).toContain("<svg");
            expect(entry.aliases).toContain("box");

            entry.execute?.(fake);
            expect(executeSpy).toHaveBeenCalledWith("admonition", { forceValue: type });
        }
    });

    it("opens the math balloon rather than running a command", () => {
        const { fake, pluginInstances } = makeFakeEditor();
        const showUI = vi.fn();
        pluginInstances.set(MathUI, { _showUI: showUI });

        definition("math").execute?.(fake);

        expect(showUI).toHaveBeenCalledOnce();
    });

    // The balloon needs the view and mapper settled, which they are not until the slash command has
    // finished its own DOM and selection cleanup.
    it("defers the anchor form to the next tick", async () => {
        vi.useFakeTimers();
        try {
            const { fake, pluginInstances } = makeFakeEditor();
            const showFormView = vi.fn();
            pluginInstances.set(BookmarkUI, { _showFormView: showFormView });

            definition("anchor").execute?.(fake);
            expect(showFormView).not.toHaveBeenCalled();

            vi.runAllTimers();
            expect(showFormView).toHaveBeenCalledOnce();
        } finally {
            vi.useRealTimers();
        }
    });

    // The samples come from `mermaid.samples`, which the editor already carries for the Mermaid UI —
    // it was passed to the builder separately back when the host built these definitions.
    it("builds one entry per Mermaid sample, inserting that sample's source", () => {
        const { fake, executeSpy } = makeFakeEditor();
        const sample = definition("mermaid-sample-0");

        expect(sample.title).toBe("Mermaid diagram: Flowchart");
        expect(sample.description).toBe("Insert a \"Flowchart\" Mermaid diagram template");
        expect(sample.aliases).toContain("Flowchart");

        sample.execute?.(fake);
        expect(executeSpy).toHaveBeenCalledWith(INSERT_MERMAID_COMMAND, { source: "graph TD;" });
    });

    it("carries no sample entries when the editor configures none", async () => {
        editor = await createTestEditor(
            [ Essentials, Paragraph, BlockQuote, MentionEditing, TriliumMentionUI, TriliumSlashCommands ]
        );

        const ids = buildTriliumSlashCommands(editor).map((entry) => entry.id);
        expect(ids).toContain("mermaid");
        expect(ids.filter((id) => id.startsWith("mermaid-sample-"))).toEqual([]);
    });

    describe("AI quick actions", () => {
        /** The assistant requires one; nothing here renders a response, so identity will do. */
        const sanitizeHtml = (html: string) => html;
        const GROUPS = [
            {
                id: "edit",
                label: "Edit or review",
                actions: [
                    { id: "fixTypos", label: "Fix typos", prompt: "Fix all mistakes." },
                    { id: "makeShorter", label: "Make shorter", prompt: "Shorten it." }
                ]
            },
            {
                id: "translate",
                label: "Translate",
                // A label that only reads as a command together with its group heading, which is
                // why the host composes one.
                actions: [ { id: "german", label: "German", commandLabel: "Translate to German", prompt: "Translate the content to German." } ]
            }
        ];

        /**
         * The palette only asks the editor whether the assistant is loaded and what it configured,
         * so a stub keeps this spec off the plugin itself — the entries are the palette's own
         * contribution, and the assistant has its own tests for what running one does.
         */
        function withAssistantLoaded(quickActions = GROUPS) {
            editor.config.set("aiAssistant", { quickActions, sanitizeHtml });
            const hasPlugin = editor.plugins.has.bind(editor.plugins);
            vi.spyOn(editor.plugins, "has").mockImplementation(
                (key) => key === "AiAssistantUI" || hasPlugin(key)
            );
            // Answering `has` is not enough: the palette reads the list off the plugin rather than
            // off the config, which only seeded it. Every other key falls through to the real
            // collection, which the rest of `buildTriliumSlashCommands` still asks about.
            const getPlugin = editor.plugins.get.bind(editor.plugins);
            vi.spyOn(editor.plugins, "get").mockImplementation(
                ((key: unknown) => (key === "AiAssistantUI" ? { quickActions } : getPlugin(key as string))) as never
            );
        }

        function aiEntries() {
            return buildTriliumSlashCommands(editor).filter((entry) => entry.id.startsWith("ai-") && entry.id !== "ai-assistant");
        }

        // The prefix marks them out in a palette of insert-a-thing entries, and `commandLabel`
        // wins over the bare label the menu shows under a group heading.
        it("prefixes each configured action and says what it applies to", () => {
            withAssistantLoaded();

            expect(aiEntries().map((entry) => ({ id: entry.id, title: entry.title, description: entry.description }))).toEqual([
                { id: "ai-fixTypos", title: "AI: Fix typos", description: "Applies to the current paragraph." },
                { id: "ai-makeShorter", title: "AI: Make shorter", description: "Applies to the current paragraph." },
                { id: "ai-german", title: "AI: Translate to German", description: "Applies to the current paragraph." }
            ]);
        });

        it("answers to /ai through the prefix, and to its group's name through an alias", () => {
            withAssistantLoaded();

            expect(matchSlashCommands(aiEntries(), "ai").map((entry) => entry.id))
                .toEqual([ "ai-fixTypos", "ai-makeShorter", "ai-german" ]);
            // "Edit or review" is nowhere in "AI: Fix typos", so the group has to come along.
            expect(matchSlashCommands(aiEntries(), "edit or").map((entry) => entry.id))
                .toEqual([ "ai-fixTypos", "ai-makeShorter" ]);
        });

        it("hands the picked action to the assistant", () => {
            withAssistantLoaded();
            const { fake, pluginInstances } = makeFakeEditor();
            const runQuickAction = vi.fn();
            pluginInstances.set("AiAssistantUI", { runQuickAction });

            aiEntries()[0].execute?.(fake);

            expect(runQuickAction).toHaveBeenCalledWith(GROUPS[0].actions[0]);
        });

        it("is offered only while the assistant command is enabled", () => {
            withAssistantLoaded();
            const entry = aiEntries()[0];

            expect(isSlashCommandEnabled(makeFakeEditor({ aiAssistant: { isEnabled: true } }).fake, entry)).toBe(true);
            expect(isSlashCommandEnabled(makeFakeEditor({ aiAssistant: { isEnabled: false } }).fake, entry)).toBe(false);
            // No LLM provider configured at all: the command is never registered.
            expect(isSlashCommandEnabled(makeFakeEditor().fake, entry)).toBe(false);
        });

        it("contributes nothing when the assistant is not loaded", () => {
            editor.config.set("aiAssistant", { quickActions: GROUPS, sanitizeHtml });

            expect(aiEntries()).toEqual([]);
        });

        it("contributes nothing when the host configured no actions", () => {
            withAssistantLoaded([]);

            expect(aiEntries()).toEqual([]);
        });
    });

    // The reason these moved out of the host: the host translator only ever resolved Trilium's own
    // catalog, so strings CKEditor already translates — "Align left", "Page break" — stayed English.
    it("translates through the editor, so CKEditor's own strings resolve too", async () => {
        editor = await createTestEditor(
            [ Essentials, Paragraph, BlockQuote, MentionEditing, TriliumMentionUI, TriliumSlashCommands ],
            { translations: [ {}, { en: { dictionary: { "Align left": "Aliniază la stânga", "Page break": "Întrerupere de pagină" } } } ] }
        );

        expect(definition("align-left").title).toBe("Aliniază la stânga");
        expect(definition("page-break").title).toBe("Întrerupere de pagină");
    });
});
