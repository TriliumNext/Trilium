import { beforeEach, describe, expect, it, vi } from "vitest";
import becca from "@triliumnext/server/src/becca/becca";
import BBranch from "@triliumnext/server/src/becca/entities/bbranch";
import { buildNote } from "@triliumnext/server/src/test/becca_easy_mocking";
import {
    parseScriptMeta,
    transpile,
    deployScript,
    codeNoteId,
    renderNoteId,
    SCRIPTS_NOTE_ID,
    type NoteService,
} from "./deploy";

// ── Mocks — only SQL and entity_changes, becca is real ───────────────────────

vi.mock("@triliumnext/server/src/services/sql", () => ({
    default: {
        transactional: (cb: Function) => cb(),
        upsert: () => {},
        execute: () => {},
        replace: () => {},
        getMap: () => {},
        getValue: () => null,
    },
}));

vi.mock("@triliumnext/server/src/services/sql_init", () => ({
    dbReady: () => {},
}));

vi.mock("@triliumnext/server/src/services/entity_changes", () => ({
    default: { putEntityChange: () => {} },
    putEntityChange: () => {},
}));

// ── parseScriptMeta ──────────────────────────────────────────────────────────

describe("parseScriptMeta", () => {
    it("parses a valid @trilium-script block", () => {
        const source = `/**
 * @trilium-script
 *
 * id: my-script
 * type: render
 * title: My Script
 */
export default function() {}`;

        const meta = parseScriptMeta(source, "my-script.jsx");
        expect(meta).toEqual({
            id: "my-script",
            type: "render",
            title: "My Script",
        });
    });

    it("returns null when @trilium-script marker is missing", () => {
        const source = `/** Just a normal comment */\nexport default function() {}`;
        expect(parseScriptMeta(source, "test.jsx")).toBeNull();
    });

    it("returns null and logs error when id is missing", () => {
        const spy = vi.spyOn(console, "error").mockImplementation(() => {});
        const source = `/**
 * @trilium-script
 *
 * type: render
 * title: My Script
 */`;
        expect(parseScriptMeta(source, "test.jsx")).toBeNull();
        expect(spy).toHaveBeenCalledWith(expect.stringContaining("missing required fields: id"));
        spy.mockRestore();
    });

    it("returns null when type is missing", () => {
        const spy = vi.spyOn(console, "error").mockImplementation(() => {});
        const source = `/**
 * @trilium-script
 *
 * id: test
 * title: Test
 */`;
        expect(parseScriptMeta(source, "test.jsx")).toBeNull();
        expect(spy).toHaveBeenCalledWith(expect.stringContaining("missing required fields: type"));
        spy.mockRestore();
    });

    it("returns null when title is missing", () => {
        const spy = vi.spyOn(console, "error").mockImplementation(() => {});
        const source = `/**
 * @trilium-script
 *
 * id: test
 * type: code
 */`;
        expect(parseScriptMeta(source, "test.jsx")).toBeNull();
        expect(spy).toHaveBeenCalledWith(expect.stringContaining("missing required fields: title"));
        spy.mockRestore();
    });

    it("preserves extra metadata fields", () => {
        const source = `/**
 * @trilium-script
 *
 * id: test
 * type: render
 * title: Test
 * icon: bx-rocket
 */`;
        const meta = parseScriptMeta(source, "test.jsx");
        expect(meta).toMatchObject({ icon: "bx-rocket" });
    });
});

// ── transpile ────────────────────────────────────────────────────────────────

describe("transpile", () => {
    it("passes .jsx files through unchanged", () => {
        const source = `const x: number = 1; return <div>{x}</div>;`;
        expect(transpile(source, "test.jsx")).toBe(source);
    });

    it("strips type annotations from .tsx but preserves JSX", () => {
        const source = `const x: number = 1;\nconst el = <div>{x}</div>;`;
        const result = transpile(source, "test.tsx");
        expect(result).not.toContain(": number");
        expect(result).toContain("<div>");
    });

    it("strips type annotations from .ts", () => {
        const source = `const x: number = 1;`;
        const result = transpile(source, "test.ts");
        expect(result).not.toContain(": number");
        expect(result).toContain("const x = 1");
    });

    it("passes .js files through unchanged", () => {
        const source = `const x = 1;`;
        expect(transpile(source, "test.js")).toBe(source);
    });
});

// ── deployScript ─────────────────────────────────────────────────────────────

describe("deployScript", () => {
    /**
     * A NoteService backed by buildNote — each createNewNote call
     * populates the real becca cache via becca_easy_mocking.
     */
    const notesService: NoteService = {
        createNewNote(params) {
            const note = buildNote({
                id: params.noteId,
                title: params.title,
                type: params.type as Parameters<typeof buildNote>[0]["type"],
                mime: params.mime ?? "text/html",
                content: params.content,
            });
            // buildNote doesn't create a branch to the parent, so add one.
            new BBranch({
                branchId: `${params.parentNoteId}_${params.noteId}`,
                noteId: params.noteId,
                parentNoteId: params.parentNoteId,
            });
            return { note: { noteId: note.noteId } };
        },
    };

    beforeEach(() => {
        becca.reset();

        // Root + Scripts folder, using buildNote for the tree structure.
        buildNote({
            id: "root",
            title: "root",
            children: [
                { id: SCRIPTS_NOTE_ID, title: "Scripts", type: "doc" },
            ],
        });
    });

    describe("render note with JSX", () => {
        const meta = { id: "xopp-importer", type: "render", title: "XOPP Importer" };
        const jsxContent = `import { h } from "trilium:preact";\nexport default function() { return <div>Hello</div>; }`;
        const mime = "text/jsx";

        it("creates a render note as parent with code note child linked via ~renderNote", () => {
            deployScript(meta, jsxContent, mime, becca, notesService);

            const renderId = renderNoteId(meta.id);
            const codeId = codeNoteId(meta.id);
            const renderNote = becca.notes[renderId];
            const codeNote = becca.notes[codeId];

            // Render note exists with correct type/title
            expect(renderNote).toBeDefined();
            expect(renderNote.type).toBe("render");
            expect(renderNote.title).toBe("XOPP Importer");

            // Code note exists with correct type/title
            expect(codeNote).toBeDefined();
            expect(codeNote.type).toBe("code");
            expect(codeNote.title).toBe("XOPP Importer");

            // Code note is a child of the render note
            expect(codeNote.getParentBranches().some((b) => b.parentNoteId === renderId)).toBe(true);

            // Render note is under scripts folder
            expect(renderNote.getParentBranches().some((b) => b.parentNoteId === SCRIPTS_NOTE_ID)).toBe(true);

            // ~renderNote relation points to the code note
            const relation = renderNote.getRelations().find((a) => a.name === "renderNote");
            expect(relation).toBeDefined();
            expect(relation!.value).toBe(codeId);
        });

        it("returns a 'created' result with both note IDs", () => {
            const result = deployScript(meta, jsxContent, mime, becca, notesService);
            expect(result).toEqual({
                action: "created",
                codeNoteId: codeNoteId(meta.id),
                renderNoteId: renderNoteId(meta.id),
                title: "XOPP Importer",
                type: "render",
            });
        });
    });

    describe("render note with TSX", () => {
        const meta = { id: "tsx-widget", type: "render", title: "TSX Widget" };
        const tsxSource = `const x: number = 1;\nexport default function() { return <div>{x}</div>; }`;
        const transpiledContent = transpile(tsxSource, "tsx-widget.tsx");
        const mime = "text/jsx";

        it("creates the same render+code structure as JSX, with types stripped but JSX preserved", () => {
            // Content was correctly transpiled
            expect(transpiledContent).not.toContain(": number");
            expect(transpiledContent).toContain("<div>");

            deployScript(meta, transpiledContent, mime, becca, notesService);

            const renderId = renderNoteId(meta.id);
            const codeId = codeNoteId(meta.id);

            expect(becca.notes[renderId]).toBeDefined();
            expect(becca.notes[renderId].type).toBe("render");
            expect(becca.notes[codeId]).toBeDefined();
            expect(becca.notes[codeId].type).toBe("code");
        });
    });

    describe("updating an existing script", () => {
        const meta = { id: "existing-script", type: "render", title: "Original" };
        const mime = "text/jsx";

        it("updates content and title of existing code note", () => {
            deployScript(meta, "old content", mime, becca, notesService);

            const codeId = codeNoteId(meta.id);
            const note = becca.notes[codeId];
            const saveSpy = vi.fn();
            const setContentSpy = vi.fn();
            note.save = saveSpy;
            note.setContent = setContentSpy;

            const result = deployScript({ ...meta, title: "New Title" }, "new content", mime, becca, notesService);
            expect(result.action).toBe("updated");
            expect(note.title).toBe("New Title");
            expect(saveSpy).toHaveBeenCalled();
            expect(setContentSpy).toHaveBeenCalledWith("new content");
        });
    });

    describe("plain code note (non-render)", () => {
        const meta = { id: "backend-helper", type: "code", title: "Backend Helper" };
        const content = "module.exports = {};";
        const mime = "application/javascript;env=backend";

        it("creates a single code note under scripts folder, no render note", () => {
            deployScript(meta, content, mime, becca, notesService);

            const codeId = codeNoteId(meta.id);
            const codeNote = becca.notes[codeId];

            expect(codeNote).toBeDefined();
            expect(codeNote.type).toBe("code");
            expect(codeNote.getParentBranches().some((b) => b.parentNoteId === SCRIPTS_NOTE_ID)).toBe(true);

            // No render note was created
            expect(becca.notes[renderNoteId(meta.id)]).toBeUndefined();
        });

        it("returns a 'created' result without renderNoteId", () => {
            const result = deployScript(meta, content, mime, becca, notesService);
            expect(result).toEqual({
                action: "created",
                codeNoteId: codeNoteId(meta.id),
                title: "Backend Helper",
                type: "code",
            });
        });
    });

    describe("backend script", () => {
        const meta = { id: "hello-world", type: "backend", run: "backendStartup", title: "Hello World" };
        const content = `api.log("Hello from script-deployer!");`;
        const mime = "application/javascript;env=backend";

        it("creates a code note with #run label", () => {
            deployScript(meta, content, mime, becca, notesService);

            const codeId = codeNoteId(meta.id);
            const codeNote = becca.notes[codeId];

            expect(codeNote).toBeDefined();
            expect(codeNote.type).toBe("code");

            const runLabel = codeNote.getLabels().find((a) => a.name === "run");
            expect(runLabel).toBeDefined();
            expect(runLabel!.value).toBe("backendStartup");
        });

        it("places the code note under scripts folder, no render note", () => {
            deployScript(meta, content, mime, becca, notesService);

            const codeId = codeNoteId(meta.id);
            const codeNote = becca.notes[codeId];
            expect(codeNote.getParentBranches().some((b) => b.parentNoteId === SCRIPTS_NOTE_ID)).toBe(true);
            expect(becca.notes[renderNoteId(meta.id)]).toBeUndefined();
        });

        it("does not set #run when run field is absent", () => {
            const metaNoRun = { id: "no-run", type: "backend", title: "No Run" };
            deployScript(metaNoRun, content, mime, becca, notesService);

            const codeNote = becca.notes[codeNoteId(metaNoRun.id)];
            expect(codeNote.getLabels().find((a) => a.name === "run")).toBeUndefined();
        });
    });

    describe("execute labels", () => {
        const content = `api.log("test");`;
        const mime = "application/javascript;env=backend";

        it("sets executeButton, executeDescription, and executeTitle on creation", () => {
            const meta = {
                id: "exec-test",
                type: "backend",
                title: "Exec Test",
                executeButton: "true",
                executeDescription: "Does something useful",
                executeTitle: "Run It",
            };
            deployScript(meta, content, mime, becca, notesService);

            const codeNote = becca.notes[codeNoteId(meta.id)];
            const labels = codeNote.getLabels();
            expect(labels.find((a) => a.name === "executeButton")?.value).toBe("true");
            expect(labels.find((a) => a.name === "executeDescription")?.value).toBe("Does something useful");
            expect(labels.find((a) => a.name === "executeTitle")?.value).toBe("Run It");
        });

        it("sets execute labels on update of an existing note", () => {
            const meta = { id: "exec-update", type: "backend", title: "Before" };
            deployScript(meta, content, mime, becca, notesService);

            const updated = { ...meta, title: "After", executeButton: "true", executeDescription: "Now executable" };
            const result = deployScript(updated, content, mime, becca, notesService);

            expect(result.action).toBe("updated");
            const labels = becca.notes[codeNoteId(meta.id)].getLabels();
            expect(labels.find((a) => a.name === "executeButton")?.value).toBe("true");
            expect(labels.find((a) => a.name === "executeDescription")?.value).toBe("Now executable");
        });

        it("does not set execute labels when absent from metadata", () => {
            const meta = { id: "no-exec", type: "backend", title: "Plain" };
            deployScript(meta, content, mime, becca, notesService);

            const labels = becca.notes[codeNoteId(meta.id)].getLabels();
            expect(labels.find((a) => a.name === "executeButton")).toBeUndefined();
            expect(labels.find((a) => a.name === "executeDescription")).toBeUndefined();
        });
    });
});
