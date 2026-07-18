import { describe, expect, it, vi } from "vitest";

import buildExtraCommands from "./extra_slash_commands.js";

// Minimal fake editor that records execute() calls and supports plugin lookup.
function makeFakeEditor() {
    const pluginInstances = new Map<unknown, unknown>();
    const executeSpy = vi.fn();

    const editor = {
        execute: executeSpy,
        plugins: {
            get: (key: unknown) => pluginInstances.get(key)
        },
        _pluginInstances: pluginInstances
    };

    return { editor, executeSpy, pluginInstances };
}

describe("buildExtraCommands", () => {
    const t = (key: string, params?: Record<string, unknown>) => {
        if (params) {
            return `${key}(${JSON.stringify(params)})`;
        }
        return key;
    };

    it("returns an array", () => {
        const commands = buildExtraCommands(t);
        expect(Array.isArray(commands)).toBe(true);
        expect(commands.length).toBeGreaterThan(0);
    });

    it("includes the collapsible command", () => {
        const commands = buildExtraCommands(t);
        const cmd = commands.find((c) => c.id === "collapsible");
        expect(cmd).toBeDefined();
        expect(cmd?.title).toBe("Collapsible block");
        expect(cmd?.commandName).toBe("collapsible");
        expect(cmd?.description).toBe("slash_commands.collapsible_description");
        expect(Array.isArray(cmd?.aliases)).toBe(true);
        expect(cmd?.icon).toBeTruthy();
    });

    it("includes the footnote command", () => {
        const commands = buildExtraCommands(t);
        const cmd = commands.find((c) => c.id === "footnote");
        expect(cmd).toBeDefined();
        expect(cmd?.title).toBe("Footnote");
        expect(cmd?.commandName).toBe("InsertFootnote");
        expect(cmd?.icon).toBeTruthy();
    });

    it("includes the datetime command", () => {
        const commands = buildExtraCommands(t);
        const cmd = commands.find((c) => c.id === "datetime");
        expect(cmd).toBeDefined();
        expect(cmd?.title).toBe("Insert date/time");
        expect(cmd?.icon).toBeTruthy();
    });

    it("includes the internal-link command", () => {
        const commands = buildExtraCommands(t);
        const cmd = commands.find((c) => c.id === "internal-link");
        expect(cmd).toBeDefined();
        expect(cmd?.title).toBe("Internal Trilium link");
        expect(Array.isArray(cmd?.aliases)).toBe(true);
        expect(cmd?.icon).toBeTruthy();
    });

    it("includes the include-note command", () => {
        const commands = buildExtraCommands(t);
        const cmd = commands.find((c) => c.id === "include-note");
        expect(cmd).toBeDefined();
        expect(cmd?.title).toBe("Include note");
        expect(cmd?.icon).toBeTruthy();
    });

    it("includes the page-break command", () => {
        const commands = buildExtraCommands(t);
        const cmd = commands.find((c) => c.id === "page-break");
        expect(cmd).toBeDefined();
        expect(cmd?.title).toBe("Page break");
        expect(cmd?.commandName).toBe("pageBreak");
        expect(cmd?.icon).toBeTruthy();
    });

    it("includes the markdown-import command", () => {
        const commands = buildExtraCommands(t);
        const cmd = commands.find((c) => c.id === "markdown-import");
        expect(cmd).toBeDefined();
        expect(cmd?.title).toBe("Markdown import");
        expect(cmd?.icon).toBeTruthy();
    });

    it("includes the anchor command with execute function", () => {
        const commands = buildExtraCommands(t);
        const cmd = commands.find((c) => c.id === "anchor");
        expect(cmd).toBeDefined();
        expect(cmd?.title).toBe("Anchor");
        expect(Array.isArray(cmd?.aliases)).toBe(true);
        expect(typeof cmd?.execute).toBe("function");
        expect(cmd?.icon).toBeTruthy();
    });

    it("anchor execute defers _showFormView via setTimeout", async () => {
        const commands = buildExtraCommands(t);
        const cmd = commands.find((c) => c.id === "anchor");
        expect(cmd?.execute).toBeDefined();

        vi.useFakeTimers();
        const showFormView = vi.fn();
        const { editor, pluginInstances } = makeFakeEditor();

        // Import BookmarkUI dynamically to get the class reference.
        const { BookmarkUI } = await import("ckeditor5");
        pluginInstances.set(BookmarkUI, { _showFormView: showFormView });

        cmd?.execute?.(editor as unknown as import("ckeditor5").Editor);

        // Should not have been called yet (deferred via setTimeout).
        expect(showFormView).not.toHaveBeenCalled();

        vi.runAllTimers();
        expect(showFormView).toHaveBeenCalledOnce();

        vi.useRealTimers();
    });

    describe("math command", () => {
        it("is present with execute function and icon", async () => {
            const commands = buildExtraCommands(t);
            const cmd = commands.find((c) => c.id === "math");
            expect(cmd).toBeDefined();
            expect(cmd?.title).toBe("Math equation");
            expect(typeof cmd?.execute).toBe("function");
            expect(cmd?.icon).toBeTruthy();
        });

        it("execute calls MathUI._showUI()", async () => {
            const commands = buildExtraCommands(t);
            const cmd = commands.find((c) => c.id === "math");

            const { MathUI } = await import("@triliumnext/ckeditor5-math");
            const showUI = vi.fn();
            const { editor, pluginInstances } = makeFakeEditor();
            pluginInstances.set(MathUI, { _showUI: showUI });

            cmd?.execute?.(editor as unknown as import("ckeditor5").Editor);
            expect(showUI).toHaveBeenCalledOnce();
        });
    });

    describe("list commands", () => {
        it("includes bulletedList with commandName and icon", () => {
            const commands = buildExtraCommands(t);
            const cmd = commands.find((c) => c.id === "bulletedList");
            expect(cmd).toBeDefined();
            expect(cmd?.title).toBe("Bulleted list");
            expect(cmd?.commandName).toBe("bulletedList");
            expect(cmd?.icon).toBeTruthy();
        });

        it("includes numberedList with commandName and icon", () => {
            const commands = buildExtraCommands(t);
            const cmd = commands.find((c) => c.id === "numberedList");
            expect(cmd).toBeDefined();
            expect(cmd?.title).toBe("Numbered list");
            expect(cmd?.commandName).toBe("numberedList");
            expect(cmd?.icon).toBeTruthy();
        });

        it("includes todoList with commandName and icon", () => {
            const commands = buildExtraCommands(t);
            const cmd = commands.find((c) => c.id === "todoList");
            expect(cmd).toBeDefined();
            expect(cmd?.title).toBe("To-do list");
            expect(cmd?.commandName).toBe("todoList");
            expect(cmd?.icon).toBeTruthy();
        });
    });

    describe("alignment commands", () => {
        it("includes align-left with execute function", () => {
            const commands = buildExtraCommands(t);
            const cmd = commands.find((c) => c.id === "align-left");
            expect(cmd).toBeDefined();
            expect(cmd?.title).toBe("Align left");
            expect(typeof cmd?.execute).toBe("function");
            expect(cmd?.icon).toBeTruthy();
        });

        it("align-left execute calls editor.execute with alignment left", () => {
            const commands = buildExtraCommands(t);
            const cmd = commands.find((c) => c.id === "align-left");
            const { editor, executeSpy } = makeFakeEditor();
            cmd?.execute?.(editor as unknown as import("ckeditor5").Editor);
            expect(executeSpy).toHaveBeenCalledWith("alignment", { value: "left" });
        });

        it("includes align-center with execute function", () => {
            const commands = buildExtraCommands(t);
            const cmd = commands.find((c) => c.id === "align-center");
            expect(cmd).toBeDefined();
            expect(cmd?.title).toBe("Align center");
            expect(typeof cmd?.execute).toBe("function");
        });

        it("align-center execute calls editor.execute with alignment center", () => {
            const commands = buildExtraCommands(t);
            const cmd = commands.find((c) => c.id === "align-center");
            const { editor, executeSpy } = makeFakeEditor();
            cmd?.execute?.(editor as unknown as import("ckeditor5").Editor);
            expect(executeSpy).toHaveBeenCalledWith("alignment", { value: "center" });
        });

        it("includes align-right with execute function", () => {
            const commands = buildExtraCommands(t);
            const cmd = commands.find((c) => c.id === "align-right");
            expect(cmd).toBeDefined();
            expect(cmd?.title).toBe("Align right");
            expect(typeof cmd?.execute).toBe("function");
        });

        it("align-right execute calls editor.execute with alignment right", () => {
            const commands = buildExtraCommands(t);
            const cmd = commands.find((c) => c.id === "align-right");
            const { editor, executeSpy } = makeFakeEditor();
            cmd?.execute?.(editor as unknown as import("ckeditor5").Editor);
            expect(executeSpy).toHaveBeenCalledWith("alignment", { value: "right" });
        });

        it("includes align-justify with execute function", () => {
            const commands = buildExtraCommands(t);
            const cmd = commands.find((c) => c.id === "align-justify");
            expect(cmd).toBeDefined();
            expect(cmd?.title).toBe("Justify");
            expect(typeof cmd?.execute).toBe("function");
        });

        it("align-justify execute calls editor.execute with alignment justify", () => {
            const commands = buildExtraCommands(t);
            const cmd = commands.find((c) => c.id === "align-justify");
            const { editor, executeSpy } = makeFakeEditor();
            cmd?.execute?.(editor as unknown as import("ckeditor5").Editor);
            expect(executeSpy).toHaveBeenCalledWith("alignment", { value: "justify" });
        });
    });

    describe("admonition commands", () => {
        it("includes one command per ADMONITION_TYPE with execute function", async () => {
            const { ADMONITION_TYPES } = await import("@triliumnext/ckeditor5-admonition");
            const commands = buildExtraCommands(t);
            for (const keyword of Object.keys(ADMONITION_TYPES)) {
                const cmd = commands.find((c) => c.id === keyword);
                expect(cmd, `admonition command for ${keyword}`).toBeDefined();
                expect(typeof cmd?.execute).toBe("function");
                expect(cmd?.icon).toBeTruthy();
                expect(cmd?.description).toBe("slash_commands.admonition_description");
                expect(cmd?.aliases).toContain("box");
            }
        });

        it("admonition execute calls editor.execute('admonition') with the keyword", async () => {
            const { ADMONITION_TYPES } = await import("@triliumnext/ckeditor5-admonition");
            const commands = buildExtraCommands(t);

            for (const keyword of Object.keys(ADMONITION_TYPES)) {
                const cmd = commands.find((c) => c.id === keyword);
                const { editor, executeSpy } = makeFakeEditor();
                cmd?.execute?.(editor as unknown as import("ckeditor5").Editor);
                expect(executeSpy).toHaveBeenCalledWith("admonition", { forceValue: keyword });
            }
        });
    });

    describe("mermaid commands", () => {
        it("includes a blank mermaid command when no samples given", () => {
            const commands = buildExtraCommands(t);
            const cmd = commands.find((c) => c.id === "mermaid");
            expect(cmd).toBeDefined();
            expect(cmd?.title).toBe("Mermaid diagram");
            expect(cmd?.commandName).toBeTruthy();
            expect(cmd?.icon).toBeTruthy();
            expect(cmd?.description).toBe("mermaid.slash_command_blank_description");
        });

        it("includes no sample commands when mermaidSamples is empty", () => {
            const commands = buildExtraCommands(t, []);
            const sampleCmds = commands.filter((c) => String(c.id).startsWith("mermaid-sample-"));
            expect(sampleCmds).toHaveLength(0);
        });

        it("generates one command per sample with correct id and title", () => {
            const samples = [
                { name: "Flowchart", content: "flowchart LR\n  A --> B" },
                { name: "Sequence", content: "sequenceDiagram\n  A ->> B: hi" }
            ];
            const commands = buildExtraCommands(t, samples);

            const cmd0 = commands.find((c) => c.id === "mermaid-sample-0");
            expect(cmd0).toBeDefined();
            expect(cmd0?.title).toBe("Mermaid diagram: Flowchart");
            expect(cmd0?.description).toBe("mermaid.slash_command_description({\"name\":\"Flowchart\"})");
            expect(cmd0?.aliases).toContain("Flowchart");
            expect(cmd0?.icon).toBeTruthy();

            const cmd1 = commands.find((c) => c.id === "mermaid-sample-1");
            expect(cmd1).toBeDefined();
            expect(cmd1?.title).toBe("Mermaid diagram: Sequence");
        });

        it("sample command execute calls editor.execute with INSERT_MERMAID_COMMAND and source", async () => {
            const { INSERT_MERMAID_COMMAND } = await import("@triliumnext/ckeditor5-mermaid");
            const samples = [
                { name: "Flowchart", content: "flowchart LR\n  A --> B" }
            ];
            const commands = buildExtraCommands(t, samples);
            const cmd = commands.find((c) => c.id === "mermaid-sample-0");
            expect(typeof cmd?.execute).toBe("function");

            const { editor, executeSpy } = makeFakeEditor();
            cmd?.execute?.(editor as unknown as import("ckeditor5").Editor);
            expect(executeSpy).toHaveBeenCalledWith(INSERT_MERMAID_COMMAND, { source: "flowchart LR\n  A --> B" });
        });

        it("translate function is called with sample name for sample commands", () => {
            const tSpy = vi.fn((key: string, params?: Record<string, unknown>) => {
                if (params) {
                    return `${key}(${JSON.stringify(params)})`;
                }
                return key;
            });
            const samples = [{ name: "MyDiagram", content: "graph TD\n  A" }];
            buildExtraCommands(tSpy, samples);
            expect(tSpy).toHaveBeenCalledWith("mermaid.slash_command_description", { name: "MyDiagram" });
        });
    });

    it("passes the translation key to t() for every command description", () => {
        const keys: string[] = [];
        const tRecording = (key: string, params?: Record<string, unknown>) => {
            keys.push(key);
            return key;
        };

        buildExtraCommands(tRecording);
        expect(keys.length).toBeGreaterThan(0);
        // All translation keys should be non-empty strings.
        for (const key of keys) {
            expect(typeof key).toBe("string");
            expect(key.length).toBeGreaterThan(0);
        }
    });
});
